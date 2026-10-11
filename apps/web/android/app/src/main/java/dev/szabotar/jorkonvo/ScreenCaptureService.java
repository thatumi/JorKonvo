package dev.szabotar.jorkonvo;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.Point;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.SystemClock;
import android.util.Log;
import android.view.WindowManager;

import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.IntentCompat;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;

/**
 * Foreground service that owns the MediaProjection screen capture pipeline and
 * feeds JPEG frames into the WebView for the getDisplayMedia polyfill
 * (apps/web/src/lib/androidScreenShare.ts).
 *
 * Lifecycle: ScreenCapturePlugin obtains the user's consent
 * (MediaProjectionManager.createScreenCaptureIntent) and hands resultCode +
 * resultData to this service. The service must be foreground BEFORE calling
 * getMediaProjection(): Android 14+ enforces that ordering with a
 * SecurityException, and Android 10 doesn't mind it, so one code path serves
 * both. A visible ongoing notification is a foreground-service requirement
 * anyway, which doubles as the UX signal that sharing is live, with a Stop
 * action that ends the capture without bringing the app forward.
 *
 * Frames: VirtualDisplay mirrors the screen into an ImageReader surface at a
 * downscaled size (the polyfill's canvas doesn't need more than the requested
 * max long side), each paced frame is JPEG-compressed and pushed to the JS
 * side as base64 through ScreenCapturePlugin.notifyFrame. Everything
 * frame-shaped happens on a dedicated handler thread; the only allocations
 * per frame are the JPEG byte[] and its base64 string.
 */
public class ScreenCaptureService extends Service {

    static final String ACTION_START = "dev.szabotar.jorkonvo.screencapture.START";
    static final String ACTION_STOP = "dev.szabotar.jorkonvo.screencapture.STOP";
    static final String EXTRA_RESULT_CODE = "result_code";
    static final String EXTRA_RESULT_DATA = "result_data";
    static final String EXTRA_MAX_LONG_SIDE = "max_long_side";
    static final String EXTRA_FRAME_RATE = "frame_rate";

    private static final String CHANNEL_ID = "screen_capture";
    private static final int NOTIFICATION_ID = 0x5C2E; // "SC"E
    private static final String TAG = "JorKonvoScreenShare";
    private static final int JPEG_QUALITY = 70;
    private static final int MAX_IMAGES = 3;

    /** True between a successful capture start and its teardown; read by the
     * plugin to decide whether a stale projection needs stopping first. */
    static volatile boolean running = false;

    private MediaProjection projection;
    private VirtualDisplay virtualDisplay;
    private ImageReader imageReader;
    private HandlerThread captureThread;
    private Bitmap frameBitmap;
    private ByteBuffer packedPixels;
    private final ByteArrayOutputStream jpegBuffer = new ByteArrayOutputStream();
    private long minFrameIntervalMs;
    private long lastFrameAtMs;
    private long startedAtMs;
    private long pushedFrames;
    private long framesAtLastStats;
    private long lastStatsAtMs;

    private final MediaProjection.Callback projectionCallback = new MediaProjection.Callback() {
        @Override
        public void onStop() {
            // The system ended the projection: the user tapped the system's
            // stop control, another app took the projection over, or the OS
            // killed it (e.g. on some OEMs when the app loses foreground).
            // The JS side must learn about this so it can end its track.
            Log.i(TAG, "MediaProjection stopped by system/user");
            stopCapture();
        }
    };

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;
        if (ACTION_STOP.equals(action)) {
            // stopCapture early-returns (without its own stopSelf) when
            // nothing was running, so stop here in every case.
            stopCapture();
            stopSelf();
            return START_NOT_STICKY;
        }
        if (ACTION_START.equals(action)) {
            Intent resultData = IntentCompat.getParcelableExtra(
                intent, EXTRA_RESULT_DATA, Intent.class);
            int resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, 0);
            int maxLongSide = Math.max(640, intent.getIntExtra(EXTRA_MAX_LONG_SIDE, 1920));
            int frameRate = Math.max(1, Math.min(30, intent.getIntExtra(EXTRA_FRAME_RATE, 15)));
            if (resultData == null || resultCode == 0) {
                ScreenCapturePlugin.notifyCaptureError("Missing MediaProjection consent result");
                stopSelf();
                return START_NOT_STICKY;
            }
            // A fresh consent while an old projection is somehow still alive
            // (e.g. WebView reloaded after a crash) would leak it.
            if (running) {
                stopCapture();
            }
            startCapture(resultCode, resultData, maxLongSide, frameRate);
            return START_NOT_STICKY;
        }
        stopSelf();
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        stopCapture();
    }

    private void startCapture(int resultCode, Intent resultData, int maxLongSide, int frameRate) {
        startAsForeground();

        MediaProjectionManager manager =
            (MediaProjectionManager) getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        try {
            projection = manager.getMediaProjection(resultCode, resultData);
        } catch (SecurityException | IllegalStateException e) {
            // E.g. Android 14+ reusing a consumed consent, or the foreground
            // service type not being up yet on an OEM that checks eagerly.
            Log.e(TAG, "getMediaProjection failed", e);
            ScreenCapturePlugin.notifyCaptureError("MediaProjection rejected: " + e.getMessage());
            stopSelf();
            return;
        }

        Point real = getRealDisplaySize();
        double scale = Math.min(1.0, (double) maxLongSide / Math.max(real.x, real.y));
        int width = Math.max(2, ((int) Math.round(real.x * scale / 2.0)) * 2);
        int height = Math.max(2, ((int) Math.round(real.y * scale / 2.0)) * 2);
        minFrameIntervalMs = 1000L / frameRate;

        imageReader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, MAX_IMAGES);
        captureThread = new HandlerThread("JorKonvoScreenCapture");
        captureThread.start();
        imageReader.setOnImageAvailableListener(
            new ImageReader.OnImageAvailableListener() {
                @Override
                public void onImageAvailable(ImageReader reader) {
                    ScreenCaptureService.this.onImageAvailable(reader);
                }
            },
            new Handler(captureThread.getLooper()));

        // Registered before createVirtualDisplay(), which Android 14+
        // requires; delivery on the main looper keeps teardown ordering
        // deterministic against onStartCommand.
        projection.registerCallback(projectionCallback, new Handler(getMainLooper()));

        virtualDisplay = projection.createVirtualDisplay(
            "JorKonvoScreenShare", width, height,
            getResources().getDisplayMetrics().densityDpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            imageReader.getSurface(), null, null);

        frameBitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
        packedPixels = ByteBuffer.allocate(width * height * 4);
        minFrameIntervalMs = 1000L / frameRate;
        lastFrameAtMs = 0;
        startedAtMs = SystemClock.elapsedRealtime();
        pushedFrames = 0;
        framesAtLastStats = 0;
        lastStatsAtMs = startedAtMs;
        running = true;

        Log.i(TAG, "Capture started " + width + "x" + height + " @" + frameRate + "fps"
            + " (real " + real.x + "x" + real.y + ", maxLongSide " + maxLongSide + ")");
        ScreenCapturePlugin.notifyCaptureStarted(width, height, frameRate);
    }

    /** Idempotent; safe from any thread (system callback, onStartCommand,
     * onDestroy all race the capture thread during teardown). */
    private synchronized void stopCapture() {
        if (!running && projection == null && virtualDisplay == null && imageReader == null) {
            return;
        }
        boolean wasRunning = running;
        running = false;
        Log.i(TAG, "Stopping capture, " + pushedFrames + " frames pushed in "
            + (SystemClock.elapsedRealtime() - startedAtMs) + "ms");

        if (virtualDisplay != null) {
            try { virtualDisplay.release(); } catch (Exception e) { Log.w(TAG, "release display", e); }
            virtualDisplay = null;
        }
        if (imageReader != null) {
            try { imageReader.close(); } catch (Exception e) { Log.w(TAG, "close reader", e); }
            imageReader = null;
        }
        if (captureThread != null) {
            captureThread.quitSafely();
            captureThread = null;
        }
        if (projection != null) {
            try { projection.unregisterCallback(projectionCallback); } catch (Exception ignored) { }
            try { projection.stop(); } catch (Exception e) { Log.w(TAG, "stop projection", e); }
            projection = null;
        }
        if (frameBitmap != null) {
            frameBitmap.recycle();
            frameBitmap = null;
        }
        packedPixels = null;

        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
        if (wasRunning) {
            // Always tell JS: either it already knows (it initiated the stop)
            // and ignores the event, or this is a system/user-initiated stop
            // it must react to by ending the shared track.
            ScreenCapturePlugin.notifyCaptureStopped();
        }
    }

    private void onImageAvailable(ImageReader reader) {
        Image image = reader.acquireLatestImage();
        if (image == null) {
            return;
        }
        try {
            long now = SystemClock.elapsedRealtime();
            if (now - lastFrameAtMs < minFrameIntervalMs) {
                return; // pacing: plenty of frames come from the compositor
            }
            lastFrameAtMs = now;

            Bitmap bitmap = frameBitmap;
            ByteBuffer pixels = packedPixels;
            if (bitmap == null || pixels == null) {
                return; // torn down mid-frame
            }

            Image.Plane plane = image.getPlanes()[0];
            ByteBuffer buffer = plane.getBuffer();
            int rowStride = plane.getRowStride();
            int rowBytes = bitmap.getWidth() * 4;
            if (rowStride == rowBytes) {
                buffer.position(0);
                bitmap.copyPixelsFromBuffer(buffer);
            } else {
                // ImageReader may pad rows; copy into a packed buffer so
                // copyPixelsFromBuffer (which assumes a tightly packed
                // RGBA_8888 bitmap layout) sees contiguous rows.
                byte[] packed = pixels.array();
                for (int row = 0; row < bitmap.getHeight(); row++) {
                    buffer.position(row * rowStride);
                    buffer.get(packed, row * rowBytes, rowBytes);
                }
                pixels.rewind();
                bitmap.copyPixelsFromBuffer(pixels);
            }

            jpegBuffer.reset();
            bitmap.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, jpegBuffer);
            ScreenCapturePlugin.notifyFrame(jpegBuffer.toByteArray());

            pushedFrames++;
            if (now - lastStatsAtMs >= 10000) {
                long windowFrames = pushedFrames - framesAtLastStats;
                Log.i(TAG, "avg " + (windowFrames * 10000 / (now - lastStatsAtMs)) / 10.0
                    + " fps, jpeg " + (jpegBuffer.size() / 1024) + " KiB");
                framesAtLastStats = pushedFrames;
                lastStatsAtMs = now;
            }
        } catch (Exception e) {
            // Most likely a release/close race during teardown - the image is
            // closed below either way; anything else is worth a log line.
            Log.w(TAG, "frame conversion failed", e);
        } finally {
            image.close();
        }
    }

    private void startAsForeground() {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            getString(R.string.screen_capture_channel_name),
            NotificationManager.IMPORTANCE_LOW);
        channel.setDescription(getString(R.string.screen_capture_channel_desc));
        nm.createNotificationChannel(channel);

        Intent contentIntent = new Intent(this, MainActivity.class);
        contentIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent contentPi = PendingIntent.getActivity(
            this, 1, contentIntent, PendingIntent.FLAG_IMMUTABLE);

        Intent stopIntent = new Intent(this, ScreenCaptureService.class).setAction(ACTION_STOP);
        PendingIntent stopPi = PendingIntent.getService(
            this, 2, stopIntent, PendingIntent.FLAG_IMMUTABLE);

        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(getString(R.string.screen_capture_notification_title))
            .setContentText(getString(R.string.screen_capture_notification_text))
            .setOngoing(true)
            .setContentIntent(contentPi)
            .addAction(new NotificationCompat.Action(
                0, getString(R.string.screen_capture_stop), stopPi))
            .build();

        // FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION on Q+; on the pre-Q
        // floor (API 24-28) ServiceCompat falls back to the typeless call.
        ServiceCompat.startForeground(this, NOTIFICATION_ID, notification,
            Build.VERSION.SDK_INT >= 29 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION : 0);
    }

    private Point getRealDisplaySize() {
        WindowManager wm = (WindowManager) getSystemService(Context.WINDOW_SERVICE);
        Point size = new Point();
        if (Build.VERSION.SDK_INT >= 30) {
            Rect bounds = wm.getMaximumWindowMetrics().getBounds();
            size.set(bounds.width(), bounds.height());
        } else {
            wm.getDefaultDisplay().getRealSize(size);
        }
        return size;
    }
}
