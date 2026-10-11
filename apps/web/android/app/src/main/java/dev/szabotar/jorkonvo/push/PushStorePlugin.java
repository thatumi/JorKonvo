package dev.szabotar.jorkonvo.push;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * JS side: src/lib/push/nativeStore.ts ("JorPushStore"). Hands the push
 * service what it needs while the app is closed - see PushStore. All work
 * runs off the main thread (key export batches can be large).
 */
@CapacitorPlugin(name = "JorPushStore")
public class PushStorePlugin extends Plugin {

    private PushStore store;

    @Override
    public void load() {
        store = new PushStore(getContext());
    }

    private interface Work {
        void run(PluginCall call) throws Exception;
    }

    private void background(PluginCall call, Work work) {
        getBridge().execute(() -> {
            try {
                work.run(call);
            } catch (Exception e) {
                call.reject(e.getClass().getSimpleName() + ": " + e.getMessage(), e);
            }
        });
    }

    private static String required(PluginCall call, String key) {
        String v = call.getString(key);
        if (v == null || v.isEmpty()) throw new IllegalArgumentException(key + " is required");
        return v;
    }

    @PluginMethod
    public void setAccount(PluginCall call) {
        background(call, c -> {
            store.setAccount(required(c, "userId"), required(c, "homeserverUrl"), required(c, "accessToken"), required(c, "mode"));
            c.resolve();
        });
    }

    @PluginMethod
    public void clearAccount(PluginCall call) {
        background(call, c -> {
            store.clearAccount(required(c, "userId"));
            c.resolve();
        });
    }

    @PluginMethod
    public void listAccounts(PluginCall call) {
        background(call, c -> {
            JSObject r = new JSObject();
            r.put("userIds", new JSArray(store.listAccounts()));
            c.resolve(r);
        });
    }

    @PluginMethod
    public void addRoomKeys(PluginCall call) {
        background(call, c -> {
            JSONArray arr = c.getArray("sessions");
            List<JSONObject> sessions = new ArrayList<>();
            for (int i = 0; arr != null && i < arr.length(); i++) {
                JSONObject s = arr.optJSONObject(i);
                if (s != null) sessions.add(s);
            }
            JSObject r = new JSObject();
            r.put("count", store.addRoomKeys(required(c, "userId"), sessions));
            c.resolve(r);
        });
    }

    @PluginMethod
    public void listSessionIds(PluginCall call) {
        background(call, c -> {
            JSObject r = new JSObject();
            r.put("sessionIds", new JSArray(store.listSessionIds(required(c, "userId"))));
            c.resolve(r);
        });
    }

    @PluginMethod
    public void clearRoomKeys(PluginCall call) {
        background(call, c -> {
            store.clearRoomKeys(required(c, "userId"));
            c.resolve();
        });
    }

    @PluginMethod
    public void setDirectory(PluginCall call) {
        background(call, c -> {
            JSObject dir = c.getObject("directory");
            store.setDirectory(required(c, "userId"), dir != null ? dir : new JSObject());
            c.resolve();
        });
    }

    @PluginMethod
    public void putAvatar(PluginCall call) {
        background(call, c -> {
            byte[] png = Megolm.unbase64(required(c, "pngBase64"));
            store.putAvatar(required(c, "userId"), required(c, "key"), png);
            c.resolve();
        });
    }
}
