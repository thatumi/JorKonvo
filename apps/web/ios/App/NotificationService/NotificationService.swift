import Intents
import JorPushCore
import UserNotifications

/// Push phase 2 on iOS: runs for every push carrying `mutable-content: 1` -
/// ours are event_id_only (src/lib/push/pusher.ts), so what arrives is
/// "New message" (aps.alert loc-key JK_NEW_MESSAGE) plus room_id, event_id,
/// unread_count and jk_uid. The resolving itself (fetch the event with the
/// token the app left in the App Group store, decrypt it with the exported
/// Megolm keys) is JorPushCore.PushResolver, shared with the tests.
///
/// The result is then turned into a Communication Notification
/// (INSendMessageIntent): the sender's / space's picture instead of the app
/// icon, like Android's MessagingStyle. If iOS kills us first (~30 s), or
/// anything fails, the original "New message" alert is shown - never nothing.
final class NotificationService: UNNotificationServiceExtension {
    private let lock = NSLock()
    private var contentHandler: ((UNNotificationContent) -> Void)?
    private var bestAttempt: UNMutableNotificationContent?
    private var work: Task<Void, Never>?

    override func didReceive(
        _ request: UNNotificationRequest,
        withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
    ) {
        guard let content = request.content.mutableCopy() as? UNMutableNotificationContent else {
            contentHandler(request.content)
            return
        }
        let userInfo = content.userInfo
        if let unread = userInfo["unread_count"] as? Int { content.badge = NSNumber(value: unread) }
        if let roomId = userInfo["room_id"] as? String, !roomId.isEmpty { content.threadIdentifier = roomId }
        lock.lock()
        self.contentHandler = contentHandler
        bestAttempt = content
        lock.unlock()

        work = Task {
            let resolved = await PushResolver.resolve(userInfo: userInfo, store: PushStore())
            deliver(await Self.present(resolved, in: content))
        }
    }

    override func serviceExtensionTimeWillExpire() {
        work?.cancel()
        lock.lock()
        let fallback = bestAttempt
        lock.unlock()
        if let fallback { deliver(fallback) }
    }

    /// Hands the content to iOS exactly once (the resolver and the timeout race).
    private func deliver(_ content: UNNotificationContent) {
        lock.lock()
        let handler = contentHandler
        contentHandler = nil
        lock.unlock()
        handler?(content)
    }

    private static func present(_ r: ResolvedPush, in content: UNMutableNotificationContent) async -> UNNotificationContent {
        // Plain layout first - also what's shown if the intent below is refused.
        content.body = r.text
        if r.senderName.isEmpty {
            // "Hidden" preview (or the event couldn't be fetched): keep "New message".
            return content
        }
        content.title = r.isGroup ? r.roomName : r.senderName
        content.subtitle = r.isGroup ? r.senderName : ""

        let sender = INPerson(
            personHandle: INPersonHandle(value: r.senderId, type: .unknown),
            nameComponents: nil,
            displayName: r.senderName,
            image: image(r.senderAvatar),
            contactIdentifier: nil,
            customIdentifier: r.senderId
        )
        // iOS only treats it as a group conversation with more than one recipient.
        let me = INPerson(
            personHandle: INPersonHandle(value: nil, type: .unknown),
            nameComponents: nil, displayName: nil, image: nil, contactIdentifier: nil, customIdentifier: nil,
            isMe: true
        )
        let intent = INSendMessageIntent(
            recipients: r.isGroup ? [me, sender] : [me],
            outgoingMessageType: .outgoingMessageText,
            content: r.text,
            speakableGroupName: r.isGroup ? INSpeakableString(spokenPhrase: r.roomName) : nil,
            conversationIdentifier: r.roomId,
            serviceName: nil,
            sender: sender,
            attachments: nil
        )
        if r.isGroup, let groupImage = image(r.conversationAvatar) {
            intent.setImage(groupImage, forParameterNamed: \.speakableGroupName)
        }
        let interaction = INInteraction(intent: intent, response: nil)
        interaction.direction = .incoming
        try? await interaction.donate()
        return (try? content.updating(from: intent)) ?? content
    }

    private static func image(_ file: URL?) -> INImage? {
        guard let file, let data = try? Data(contentsOf: file) else { return nil }
        return INImage(imageData: data)
    }
}
