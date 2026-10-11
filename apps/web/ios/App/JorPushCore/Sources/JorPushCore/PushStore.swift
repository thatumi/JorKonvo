import CryptoKit
import Foundation
import Security

/// What the Notification Service Extension needs to turn an event_id-only
/// push into "Sofia: hi", written by the app while it runs (PushStorePlugin
/// <- src/lib/push/nativeStore.ts) and read by the extension, a separate
/// process - hence the App Group container. The iOS twin of
/// android/.../push/PushStore.java, same layout:
///
///   push/<sha256(userId)>/account.bin    {userId, homeserverUrl, accessToken, mode}
///   push/<sha256(userId)>/keys.bin       {session_id: {r: room_id, k: exported Megolm session key}}
///   push/<sha256(userId)>/directory.bin  {rooms: {id: {n, dm, s}}, users: {id: name}}
///   push/<sha256(userId)>/avatars/*.png  small circular avatars (not secret: room members see them anyway)
///
/// The .bin files are AES-256-GCM sealed with a random key kept in the
/// Keychain under the App Group's access group (so the extension can read
/// it), AfterFirstUnlockThisDeviceOnly: usable while the phone is locked
/// (pushes arrive then), never synced or restored to another device. The
/// directory is excluded from backups, so a backup holds neither the files
/// nor the key. Writes are atomic, the extension never reads a half file.
public final class PushStore {
    public static let appGroupID = "group.dev.szabotar.jorkonvo"
    public static let modeFull = "full"
    public static let modeSender = "sender"

    private static let keychainService = "dev.szabotar.jorkonvo.push"
    private static let keychainAccount = "store-key"
    private static let lock = NSLock()

    private let root: URL

    public init?() {
        guard let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: Self.appGroupID) else {
            return nil
        }
        root = container.appendingPathComponent("push", isDirectory: true)
    }

    // MARK: accounts

    public func setAccount(userId: String, homeserverUrl: String, accessToken: String, mode: String) throws {
        try writeEncrypted(accountFile(userId, "account.bin"), [
            "userId": userId, "homeserverUrl": homeserverUrl, "accessToken": accessToken, "mode": mode,
        ])
    }

    /// nil when nothing is stored for this account (push preview "hidden", or never set).
    public func account(userId: String) -> [String: Any]? {
        readEncrypted(accountFile(userId, "account.bin"))
    }

    /// User ids with a stored account (the push payload names one via jk_uid).
    public func listAccounts() -> [String] {
        let dirs = (try? FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)) ?? []
        return dirs.compactMap { readEncrypted($0.appendingPathComponent("account.bin"))?["userId"] as? String }
    }

    public func clearAccount(userId: String) {
        Self.lock.lock()
        defer { Self.lock.unlock() }
        try? FileManager.default.removeItem(at: accountDir(userId))
    }

    // MARK: Megolm session keys

    /// Merges exported sessions; keeps whichever copy starts at the lower message index. Returns the total count.
    @discardableResult
    public func addRoomKeys(userId: String, sessions: [[String: Any]]) throws -> Int {
        Self.lock.lock()
        defer { Self.lock.unlock() }
        let file = accountFile(userId, "keys.bin")
        var all = readEncrypted(file) ?? [:]
        for s in sessions {
            guard let id = s["session_id"] as? String, let key = s["session_key"] as? String,
                  !id.isEmpty, !key.isEmpty else { continue }
            if let existing = all[id] as? [String: Any], let k = existing["k"] as? String,
               Self.firstIndex(k) <= Self.firstIndex(key) { continue }
            all[id] = ["r": s["room_id"] as? String ?? "", "k": key]
        }
        try writeEncryptedLocked(file, all)
        return all.count
    }

    public func listSessionIds(userId: String) -> [String] {
        Array((readEncrypted(accountFile(userId, "keys.bin")) ?? [:]).keys)
    }

    /// The exported session key for this session in this room, or nil.
    public func sessionKey(userId: String, roomId: String, sessionId: String) -> String? {
        guard let e = readEncrypted(accountFile(userId, "keys.bin"))?[sessionId] as? [String: Any],
              e["r"] as? String == roomId else { return nil }
        return e["k"] as? String
    }

    public func clearRoomKeys(userId: String) {
        Self.lock.lock()
        defer { Self.lock.unlock() }
        try? FileManager.default.removeItem(at: accountFile(userId, "keys.bin"))
    }

    // MARK: room / user names, avatars

    public func setDirectory(userId: String, directory: [String: Any]) throws {
        try writeEncrypted(accountFile(userId, "directory.bin"), directory)
    }

    public func directory(userId: String) -> [String: Any] {
        readEncrypted(accountFile(userId, "directory.bin")) ?? [:]
    }

    public func putAvatar(userId: String, key: String, png: Data) throws {
        let dir = accountDir(userId).appendingPathComponent("avatars", isDirectory: true)
        Self.lock.lock()
        defer { Self.lock.unlock() }
        try prepare(dir)
        try png.write(to: dir.appendingPathComponent(Self.sha256Hex(key) + ".png"), options: .atomic)
    }

    /// "u:@user:server" or "r:!room:server" -> the PNG file, or nil.
    public func avatarFile(userId: String, key: String) -> URL? {
        let f = accountDir(userId).appendingPathComponent("avatars").appendingPathComponent(Self.sha256Hex(key) + ".png")
        return FileManager.default.fileExists(atPath: f.path) ? f : nil
    }

    // MARK: internals

    private func accountDir(_ userId: String) -> URL {
        root.appendingPathComponent(Self.sha256Hex(userId), isDirectory: true)
    }

    private func accountFile(_ userId: String, _ name: String) -> URL {
        accountDir(userId).appendingPathComponent(name)
    }

    static func firstIndex(_ exportedSessionKey: String) -> UInt32 {
        guard let b = try? Megolm.unbase64(exportedSessionKey), b.count >= 5 else { return .max }
        return (UInt32(b[1]) << 24) | (UInt32(b[2]) << 16) | (UInt32(b[3]) << 8) | UInt32(b[4])
    }

    private func writeEncrypted(_ file: URL, _ object: [String: Any]) throws {
        Self.lock.lock()
        defer { Self.lock.unlock() }
        try writeEncryptedLocked(file, object)
    }

    private func writeEncryptedLocked(_ file: URL, _ object: [String: Any]) throws {
        let plain = try JSONSerialization.data(withJSONObject: object)
        guard let sealed = try AES.GCM.seal(plain, using: Self.storeKey()).combined else {
            throw CocoaError(.coderInvalidValue)
        }
        try prepare(file.deletingLastPathComponent())
        #if os(iOS)
        // Readable by the extension while the phone is locked (after the first unlock).
        try sealed.write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        #else
        try sealed.write(to: file, options: .atomic) // macOS: only for `swift test`
        #endif
    }

    private func readEncrypted(_ file: URL) -> [String: Any]? {
        guard let sealed = try? Data(contentsOf: file) else { return nil }
        // Unreadable (e.g. the Keychain item is gone after a restore): treat
        // as absent, the app rewrites it next time it runs.
        guard let key = try? Self.storeKey(createIfMissing: false),
              let box = try? AES.GCM.SealedBox(combined: sealed),
              let plain = try? AES.GCM.open(box, using: key) else { return nil }
        return (try? JSONSerialization.jsonObject(with: plain)) as? [String: Any]
    }

    /// Creates the directory (and the push root, kept out of backups).
    private func prepare(_ dir: URL) throws {
        if !FileManager.default.fileExists(atPath: root.path) {
            try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
            var r = root
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            try? r.setResourceValues(values)
        }
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    }

    private static func keychainQuery() -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAccount,
            // An App Group id is a valid keychain access group on iOS - the
            // extension shares it without a keychain-access-groups entitlement.
            kSecAttrAccessGroup as String: appGroupID,
            kSecUseDataProtectionKeychain as String: true,
        ]
    }

    private static func storeKey(createIfMissing: Bool = true) throws -> SymmetricKey {
        var query = keychainQuery()
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecSuccess, let data = item as? Data, data.count == 32 {
            return SymmetricKey(data: data)
        }
        guard createIfMissing, status == errSecItemNotFound else {
            throw NSError(domain: NSOSStatusErrorDomain, code: Int(status))
        }
        let key = SymmetricKey(size: .bits256)
        var add = keychainQuery()
        add[kSecValueData as String] = key.withUnsafeBytes { Data($0) }
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let addStatus = SecItemAdd(add as CFDictionary, nil)
        guard addStatus == errSecSuccess else { throw NSError(domain: NSOSStatusErrorDomain, code: Int(addStatus)) }
        return key
    }

    static func sha256Hex(_ s: String) -> String {
        SHA256.hash(data: Data(s.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}
