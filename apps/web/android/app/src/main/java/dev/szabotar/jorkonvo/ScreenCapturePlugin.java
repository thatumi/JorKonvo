package dev.szabotar.jorkonvo;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.media.projection.MediaProjectionManager;

import androidx.activity.result.ActivityResult;
import androidx.core.content.ContextCompat;

import com.getcapacitor.Bridge;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * JavaScript bridge for real screen capture on Android, where the WebView
 * does not implement navigator.mediaDevices.getDisplayMedia at all (verified
 * live on this project's P30 Pro: WebView/Chromium 151 exposes getUserMedia
 * but has no getDisplayMedia). apps/web/src/lib/androidScreenShare.ts
 * replaces getDisplayMedia with calls to this plugin; the actual MediaProjection
 * work happens in ScreenCaptureService, and frames come back to the page as
 * base64 JPEGs via Bridge.eval (window.__jorkonvoScreenShareFrame).
 *
 * Method flow:
 *  - start(maxLongSide, frameRate): raises the system's MediaProjection
 *    consent dialog through Capacitor's ActivityResultLauncher plumbing
 *    (@ActivityCallback below - NOT the deprecated onActivityResult path).
 *    On consent, starts the foreground service; the start() promise resolves
 *    only once the service reports the projection actually running, so the
 *    JS side immediately knows the real frame dimensions for its canvas.
 *  - stop(): tears the projection down (also used by the JS track's stop()).
 *  - "stopped" event: projection ended without JS asking for it (system
 *    stop control, another app took over, OS killed it) - JS turns this into
 *    a MediaStreamTrack 'ended' event so livekit-client unpublishes.
 */
@CapacitorPlugin(name = "ScreenCapture")
public class ScreenCapturePlugin extends Plugin {

    /**
     * Live instance hook for the foreground service. The service can outlive
     * activity re-creation but never the process, and a plugin instance lives
     * exactly as long as the bridge, so this never dangles - it only goes
     * null (and the service's deliveries become no-ops) while the whole app
     * is going away.
     */
    private static volatile ScreenCapturePlugin instance;

    /** The start() call awaiting the service's "capture is live" report. */
    private PluginCall pendingStartCall;

    @Override
    public void load() {
        instance = this;
    }

    @Override
    protected void handleOnDestroy() {
        instance = null;
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (pendingStartCall != null) {
            call.reject("A screen capture start is already pending", "BUSY");
            return;
        }
        Context context = getContext();
        if (ScreenCaptureService.running) {
            // The page lost its previous track (e.g. a WebView reload);
            // end that projection before asking for fresh consent.
            context.startService(new Intent(context, ScreenCaptureService.class)
                .setAction(ScreenCaptureService.ACTION_STOP));
        }
        MediaProjectionManager manager =
            (MediaProjectionManager) context.getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        startActivityForResult(call, manager.createScreenCaptureIntent(), "onConsentResult");
    }

    @ActivityCallback
    private void onConsentResult(PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            call.reject("Screen capture permission denied", "PERMISSION_DENIED");
            getBridge().releaseCall(call);
            return;
        }
        pendingStartCall = call;
        Context context = getContext();
        Intent service = new Intent(context, ScreenCaptureService.class)
            .setAction(ScreenCaptureService.ACTION_START)
            .putExtra(ScreenCaptureService.EXTRA_RESULT_CODE, result.getResultCode())
            .putExtra(ScreenCaptureService.EXTRA_RESULT_DATA, result.getData())
            .putExtra(ScreenCaptureService.EXTRA_MAX_LONG_SIDE, call.getInt("maxLongSide", 1920))
            .putExtra(ScreenCaptureService.EXTRA_FRAME_RATE, call.getInt("frameRate", 15));
        // The app is in the foreground (the user just answered the consent
        // dialog), so starting a foreground service is allowed.
        ContextCompat.startForegroundService(context, service);
        // Resolved by ScreenCaptureService through notifyCaptureStarted /
        // notifyCaptureError below - not here.
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Context context = getContext();
        context.startService(new Intent(context, ScreenCaptureService.class)
            .setAction(ScreenCaptureService.ACTION_STOP));
        call.resolve();
    }

    // ---- invoked by ScreenCaptureService on its own threads ----

    static void notifyCaptureStarted(int width, int height, int frameRate) {
        ScreenCapturePlugin plugin = instance;
        if (plugin == null) {
            return;
        }
        PluginCall call = plugin.pendingStartCall;
        plugin.pendingStartCall = null;
        if (call == null) {
            return;
        }
        JSObject result = new JSObject();
        result.put("width", width);
        result.put("height", height);
        result.put("frameRate", frameRate);
        call.resolve(result);
        plugin.getBridge().releaseCall(call);
    }

    static void notifyCaptureError(String message) {
        ScreenCapturePlugin plugin = instance;
        if (plugin == null) {
            return;
        }
        PluginCall call = plugin.pendingStartCall;
        plugin.pendingStartCall = null;
        if (call != null) {
            call.reject(message, "CAPTURE_FAILED");
            plugin.getBridge().releaseCall(call);
        }
    }

    static void notifyCaptureStopped() {
        ScreenCapturePlugin plugin = instance;
        if (plugin == null) {
            return;
        }
        plugin.notifyListeners("stopped", new JSObject());
    }

    static void notifyFrame(byte[] jpegBytes) {
        ScreenCapturePlugin plugin = instance;
        if (plugin == null) {
            return;
        }
        String base64 = android.util.Base64.encodeToString(jpegBytes, android.util.Base64.NO_WRAP);
        // Base64 output (A-Za-z0-9+/=) can never break out of the string
        // literal, so plain string concatenation is safe here.
        plugin.getBridge().eval(
            "window.__jorkonvoScreenShareFrame&&window.__jorkonvoScreenShareFrame('" + base64 + "')",
            null);
    }
}
