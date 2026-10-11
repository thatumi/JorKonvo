package dev.szabotar.jorkonvo.push;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * What the push service needs to turn an event_id-only push into "Sofia:
 * hi", written by the app while it runs (PushStorePlugin <- src/lib/push/
 * nativeStore.ts) and read by JorKonvoMessagingService while it doesn't.
 *
 * One directory per account under the app-private files dir:
 *   account.bin    {userId, homeserverUrl, accessToken, mode}
 *   keys.bin       {session_id: {r: room_id, k: exported Megolm session key}}
 *   directory.bin  {rooms: {id: {n: name, dm: bool, s: space id}}, users: {id: name}}
 *   avatars/*.png  small circular avatars (not secret: room members see them anyway)
 *
 * The .bin files are AES-256-GCM encrypted with a non-exportable Android
 * Keystore key, so a copy of the files alone is useless. (The WebView's own
 * IndexedDB holds the same token and keys unencrypted; allowBackup=false keeps
 * both out of backups.) Writes go to a temp file + rename, so the service
 * never reads a half-written file.
 */
public final class PushStore {

    public static final String MODE_FULL = "full";
    public static final String MODE_SENDER = "sender";

    private static final String KEY_ALIAS = "jk_push_store";
    private static final Object LOCK = new Object();

    private final File root;

    public PushStore(Context context) {
        this.root = new File(context.getFilesDir(), "push");
    }

    // ---- accounts ----

    public void setAccount(String userId, String homeserverUrl, String accessToken, String mode) throws IOException {
        JSONObject o = new JSONObject();
        try {
            o.put("userId", userId);
            o.put("homeserverUrl", homeserverUrl);
            o.put("accessToken", accessToken);
            o.put("mode", mode);
        } catch (JSONException e) {
            throw new IOException(e);
        }
        writeEncrypted(accountFile(userId, "account.bin"), o);
    }

    /** null when nothing is stored for this account (push preview "hidden", or never set). */
    public JSONObject getAccount(String userId) {
        return readEncrypted(accountFile(userId, "account.bin"));
    }

    /** User ids with a stored account (the push payload names one via jk_uid). */
    public List<String> listAccounts() {
        List<String> ids = new ArrayList<>();
        File[] dirs = root.listFiles();
        if (dirs == null) return ids;
        for (File d : dirs) {
            JSONObject a = readEncrypted(new File(d, "account.bin"));
            if (a != null) ids.add(a.optString("userId"));
        }
        return ids;
    }

    public void clearAccount(String userId) {
        synchronized (LOCK) {
            deleteRecursively(accountDir(userId));
        }
    }

    // ---- Megolm session keys ----

    /** Merges exported sessions; keeps whichever copy starts at the lower message index. Returns the total count. */
    public int addRoomKeys(String userId, List<JSONObject> sessions) throws IOException {
        synchronized (LOCK) {
            File f = accountFile(userId, "keys.bin");
            JSONObject all = readEncrypted(f);
            if (all == null) all = new JSONObject();
            try {
                for (JSONObject s : sessions) {
                    String id = s.optString("session_id");
                    String key = s.optString("session_key");
                    if (id.isEmpty() || key.isEmpty()) continue;
                    JSONObject existing = all.optJSONObject(id);
                    if (existing != null && firstIndex(existing.optString("k")) <= firstIndex(key)) continue;
                    JSONObject entry = new JSONObject();
                    entry.put("r", s.optString("room_id"));
                    entry.put("k", key);
                    all.put(id, entry);
                }
            } catch (JSONException e) {
                throw new IOException(e);
            }
            writeEncrypted(f, all);
            return all.length();
        }
    }

    public List<String> listSessionIds(String userId) {
        List<String> ids = new ArrayList<>();
        JSONObject all = readEncrypted(accountFile(userId, "keys.bin"));
        if (all == null) return ids;
        for (Iterator<String> it = all.keys(); it.hasNext(); ) ids.add(it.next());
        return ids;
    }

    /** The exported session key for this session in this room, or null. */
    public String getSessionKey(String userId, String roomId, String sessionId) {
        JSONObject all = readEncrypted(accountFile(userId, "keys.bin"));
        JSONObject e = all == null ? null : all.optJSONObject(sessionId);
        if (e == null || !roomId.equals(e.optString("r"))) return null;
        return e.optString("k", null);
    }

    public void clearRoomKeys(String userId) {
        synchronized (LOCK) {
            //noinspection ResultOfMethodCallIgnored
            accountFile(userId, "keys.bin").delete();
        }
    }

    // ---- room / user names, avatars ----

    public void setDirectory(String userId, JSONObject directory) throws IOException {
        writeEncrypted(accountFile(userId, "directory.bin"), directory);
    }

    public JSONObject getDirectory(String userId) {
        JSONObject d = readEncrypted(accountFile(userId, "directory.bin"));
        return d != null ? d : new JSONObject();
    }

    public void putAvatar(String userId, String key, byte[] png) throws IOException {
        File dir = new File(accountDir(userId), "avatars");
        synchronized (LOCK) {
            if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("mkdir " + dir);
            writeAtomically(new File(dir, sha256Hex(key) + ".png"), png);
        }
    }

    /** "u:@user:server" or "r:!room:server" -> the PNG file, or null. */
    public File avatarFile(String userId, String key) {
        File f = new File(new File(accountDir(userId), "avatars"), sha256Hex(key) + ".png");
        return f.isFile() ? f : null;
    }

    // ---- internals ----

    private File accountDir(String userId) {
        return new File(root, sha256Hex(userId));
    }

    private File accountFile(String userId, String name) {
        return new File(accountDir(userId), name);
    }

    static long firstIndex(String exportedSessionKey) {
        try {
            byte[] b = Megolm.unbase64(exportedSessionKey);
            if (b.length < 5) return Long.MAX_VALUE;
            return ((b[1] & 0xFFL) << 24) | ((b[2] & 0xFFL) << 16) | ((b[3] & 0xFFL) << 8) | (b[4] & 0xFFL);
        } catch (Megolm.DecryptionException e) {
            return Long.MAX_VALUE;
        }
    }

    private void writeEncrypted(File f, JSONObject o) throws IOException {
        try {
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.ENCRYPT_MODE, key());
            byte[] iv = c.getIV();
            byte[] ct = c.doFinal(o.toString().getBytes(StandardCharsets.UTF_8));
            byte[] out = new byte[1 + iv.length + ct.length];
            out[0] = (byte) iv.length;
            System.arraycopy(iv, 0, out, 1, iv.length);
            System.arraycopy(ct, 0, out, 1 + iv.length, ct.length);
            synchronized (LOCK) {
                File dir = f.getParentFile();
                if (dir != null && !dir.isDirectory() && !dir.mkdirs()) throw new IOException("mkdir " + dir);
                writeAtomically(f, out);
            }
        } catch (GeneralSecurityException e) {
            throw new IOException("encrypt failed", e);
        }
    }

    private JSONObject readEncrypted(File f) {
        if (!f.isFile()) return null;
        try {
            byte[] in = readAll(f);
            int ivLen = in[0] & 0xFF;
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, in, 1, ivLen));
            byte[] plain = c.doFinal(in, 1 + ivLen, in.length - 1 - ivLen);
            return new JSONObject(new String(plain, StandardCharsets.UTF_8));
        } catch (Exception e) {
            // Unreadable (e.g. the Keystore key was wiped): treat as absent, the app rewrites it.
            return null;
        }
    }

    private static SecretKey key() throws GeneralSecurityException, IOException {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (ks.containsAlias(KEY_ALIAS)) return (SecretKey) ks.getKey(KEY_ALIAS, null);
        KeyGenerator gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        gen.init(
            new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        );
        return gen.generateKey();
    }

    private static void writeAtomically(File f, byte[] data) throws IOException {
        File tmp = new File(f.getPath() + ".tmp");
        try (FileOutputStream out = new FileOutputStream(tmp)) {
            out.write(data);
            out.getFD().sync();
        }
        if (!tmp.renameTo(f)) throw new IOException("rename " + tmp);
    }

    private static byte[] readAll(File f) throws IOException {
        try (InputStream in = new FileInputStream(f); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return out.toByteArray();
        }
    }

    private static void deleteRecursively(File f) {
        File[] children = f.listFiles();
        if (children != null) for (File c : children) deleteRecursively(c);
        //noinspection ResultOfMethodCallIgnored
        f.delete();
    }

    static String sha256Hex(String s) {
        try {
            byte[] d = MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            for (byte b : d) sb.append(String.format("%02x", b));
            return sb.toString();
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }
}
