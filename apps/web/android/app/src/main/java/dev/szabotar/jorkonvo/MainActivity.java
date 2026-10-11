package dev.szabotar.jorkonvo;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;
import dev.szabotar.jorkonvo.push.PushStorePlugin;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Must be registered before super.onCreate(): BridgeActivity.onCreate
        // builds the bridge (and every plugin registration happens inside
        // that), so a post-super registerPlugin() would never take effect.
        registerPlugin(ScreenCapturePlugin.class);
        registerPlugin(PushStorePlugin.class);
        super.onCreate(savedInstanceState);
        // Create the "Messages" channel up front so it shows in the system
        // notification settings before the first push arrives.
        JorKonvoMessagingService.ensureChannel(this);
    }

    // While the app is on screen the WebView notifies in-app
    // (NotificationManager.tsx), so the push service stays quiet.
    @Override
    public void onResume() {
        super.onResume();
        JorKonvoMessagingService.appInForeground = true;
    }

    @Override
    public void onPause() {
        JorKonvoMessagingService.appInForeground = false;
        super.onPause();
    }
}
