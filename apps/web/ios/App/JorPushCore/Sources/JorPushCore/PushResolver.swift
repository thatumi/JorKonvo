import Foundation

/// What one notification shows, resolved on the device.
public struct ResolvedPush {
    public let roomId: String
    public let eventId: String
    /// Display name of the sender, "" if unknown.
    public let senderName: String
    /// Matrix id of the sender, "" if unknown.
    public let senderId: String
    /// Room name to show as the conversation title, "" for a DM / unknown.
    public let roomName: String
    public let isGroup: Bool
    public let text: String
    /// The DM partner's or the room's space's avatar, nil if none cached.
    public let conversationAvatar: URL?
    /// The sender's avatar, nil if none cached.
    public let senderAvatar: URL?
}

/// Turns one Sygnal APNs push into what the notification shows - the iOS
/// twin of android/.../push/PushContent.java.
///
/// The pusher is event_id_only (src/lib/push/pusher.ts), so the push itself
/// carries only room_id, event_id, the unread count and `jk_uid` (which of
/// the device's accounts it's for, from the pusher's default_payload).
/// Everything else is resolved here, per the account's preview mode:
///
///   full    fetch the event with the stored access token, decrypt it with
///           the stored Megolm keys if it's encrypted -> sender + text
///   sender  fetch the event for its sender only -> "Sofia: New message"
///   (none)  nothing stored ("hidden" mode) -> "New message"
///
/// Any failure (offline, token expired, key not exported yet) degrades to the
/// next best text, never to no notification.
public enum PushResolver {
    private static let timeout: TimeInterval = 8

    public static func resolve(userInfo: [AnyHashable: Any], store: PushStore?) async -> ResolvedPush {
        let roomId = userInfo["room_id"] as? String ?? ""
        let eventId = userInfo["event_id"] as? String ?? ""
        let texts = PushTexts.current

        var userId = userInfo["jk_uid"] as? String ?? ""
        if userId.isEmpty, let only = store?.listAccounts(), only.count == 1 { userId = only[0] }
        guard let store, !userId.isEmpty, let account = store.account(userId: userId) else {
            // "Hidden" preview: say nothing beyond "new message".
            return ResolvedPush(roomId: roomId, eventId: eventId, senderName: "", senderId: "", roomName: "",
                                isGroup: false, text: texts.newMessage, conversationAvatar: nil, senderAvatar: nil)
        }
        let dir = store.directory(userId: userId)
        let roomInfo = (dir["rooms"] as? [String: Any])?[roomId] as? [String: Any]
        let users = dir["users"] as? [String: Any] ?? [:]

        let mode = account["mode"] as? String ?? PushStore.modeFull
        var hs = account["homeserverUrl"] as? String ?? ""
        while hs.hasSuffix("/") { hs.removeLast() }
        let token = account["accessToken"] as? String ?? ""
        let roomPath = "\(hs)/_matrix/client/v3/rooms/\(enc(roomId))"

        var event: [String: Any]?
        if !roomId.isEmpty, !eventId.isEmpty {
            event = await getJson("\(roomPath)/event/\(enc(eventId))", token: token)
        }
        let sender = event?["sender"] as? String ?? ""
        var senderName = users[sender] as? String ?? ""
        if senderName.isEmpty, !sender.isEmpty {
            let member = await getJson("\(roomPath)/state/m.room.member/\(enc(sender))", token: token)
            senderName = member?["displayname"] as? String ?? ""
            if senderName.isEmpty { senderName = localpart(sender) }
        }
        var roomName = roomInfo?["n"] as? String ?? ""
        if roomName.isEmpty, roomInfo == nil, !roomId.isEmpty {
            roomName = await getJson("\(roomPath)/state/m.room.name/", token: token)?["name"] as? String ?? ""
        }

        var text = texts.newMessage
        if let event, mode == PushStore.modeFull {
            let type = event["type"] as? String ?? ""
            let content = event["content"] as? [String: Any] ?? [:]
            if type == "m.room.encrypted" {
                if let inner = decrypt(store, userId: userId, roomId: roomId, content: content) {
                    text = describe(type: inner["type"] as? String ?? "", content: inner["content"] as? [String: Any] ?? [:],
                                    membership: "", senderName: senderName, texts: texts)
                } else {
                    text = texts.encryptedMessage
                }
            } else {
                let membership = type == "m.room.member" ? content["membership"] as? String ?? "" : ""
                text = describe(type: type, content: content, membership: membership, senderName: senderName, texts: texts)
            }
        }

        let dm = roomInfo?["dm"] as? Bool ?? false
        let group = !dm && !roomName.isEmpty && roomName != senderName
        let space = roomInfo?["s"] as? String ?? ""
        let senderAvatar = sender.isEmpty ? nil : store.avatarFile(userId: userId, key: "u:\(sender)")
        // DM: the other person. Channel: its space's picture, else the room's,
        // else (a room without any picture) the sender's.
        let conversationAvatar = dm
            ? senderAvatar
            : (space.isEmpty ? nil : store.avatarFile(userId: userId, key: "r:\(space)"))
                ?? store.avatarFile(userId: userId, key: "r:\(roomId)")
                ?? senderAvatar
        return ResolvedPush(roomId: roomId, eventId: eventId, senderName: senderName, senderId: sender,
                            roomName: group ? roomName : "", isGroup: group, text: text,
                            conversationAvatar: conversationAvatar, senderAvatar: senderAvatar)
    }

    private static func decrypt(_ store: PushStore, userId: String, roomId: String, content: [String: Any]) -> [String: Any]? {
        guard content["algorithm"] as? String == "m.megolm.v1.aes-sha2",
              let sessionId = content["session_id"] as? String,
              let ciphertext = content["ciphertext"] as? String,
              // No key: it arrived after the app last ran - documented limitation.
              let key = store.sessionKey(userId: userId, roomId: roomId, sessionId: sessionId),
              let plain = try? Megolm.decrypt(exportedSessionKey: key, ciphertext: ciphertext),
              let inner = (try? JSONSerialization.jsonObject(with: Data(plain.utf8))) as? [String: Any],
              // The plaintext names its room; a mismatch means a replayed message.
              inner["room_id"] as? String == roomId else { return nil }
        return inner
    }

    /// One-line text for an event; mirrors PushContent.describe() and apps/web/public/sw.js.
    public static func describe(type: String, content: [String: Any], membership: String, senderName: String,
                                texts: PushTexts) -> String {
        let msgtype = content["msgtype"] as? String ?? ""
        let body = content["body"] as? String ?? ""
        if type == "m.room.encrypted" { return texts.encryptedMessage }
        if type == "m.room.member", membership == "invite" { return texts.invite }
        if type.contains("call") || type.hasSuffix("rtc.notification") { return texts.call }
        if type == "m.room.message", !body.isEmpty {
            let stripped = stripReplyFallback(body)
            if msgtype == "m.emote" { return "* \(senderName) \(stripped)" }
            if msgtype == "m.image" { return "🖼 \(texts.image)" }
            return stripped
        }
        if type == "m.sticker" { return texts.sticker }
        if type.hasSuffix("poll.start") { return texts.poll }
        return texts.newMessage
    }

    /// Drops a reply's "> <@user> quoted text" fallback block.
    public static func stripReplyFallback(_ body: String) -> String {
        let lines = body.components(separatedBy: "\n")
        var i = 0
        while i < lines.count, lines[i].hasPrefix("> ") { i += 1 }
        if i == 0 { return body }
        while i < lines.count, lines[i].isEmpty { i += 1 }
        let rest = lines[i...].joined(separator: "\n")
        return rest.isEmpty ? body : rest
    }

    private static func getJson(_ url: String, token: String) async -> [String: Any]? {
        guard let u = URL(string: url) else { return nil }
        var req = URLRequest(url: u, timeoutInterval: timeout)
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        guard let (data, response) = try? await URLSession.shared.data(for: req),
              (response as? HTTPURLResponse)?.statusCode == 200 else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }

    private static func enc(_ s: String) -> String {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        return s.addingPercentEncoding(withAllowedCharacters: allowed) ?? s
    }

    private static func localpart(_ userId: String) -> String {
        guard userId.hasPrefix("@"), let colon = userId.firstIndex(of: ":"),
              userId.distance(from: userId.startIndex, to: colon) > 1 else { return userId }
        return String(userId[userId.index(after: userId.startIndex)..<colon])
    }
}
