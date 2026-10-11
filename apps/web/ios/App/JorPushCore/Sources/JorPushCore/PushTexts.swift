import Foundation

/// The notification's own words (the event text itself comes from the
/// message). Kept in code rather than in the extension's Localizable.strings
/// so the package tests can see them; same wording as Android's push_*
/// strings (values/strings.xml, values-en/strings.xml). Hungarian is the
/// app's reference language, everything else gets English.
public struct PushTexts: Equatable {
    public let newMessage: String
    public let encryptedMessage: String
    public let invite: String
    public let call: String
    public let image: String
    public let sticker: String
    public let poll: String

    public static let hu = PushTexts(
        newMessage: "Új üzenet",
        encryptedMessage: "Titkosított üzenet",
        invite: "meghívott",
        call: "Bejövő hívás",
        image: "Kép",
        sticker: "Matrica",
        poll: "📊 Szavazás"
    )

    public static let en = PushTexts(
        newMessage: "New message",
        encryptedMessage: "Encrypted message",
        invite: "invited you",
        call: "Incoming call",
        image: "Image",
        sticker: "Sticker",
        poll: "📊 Poll"
    )

    public static func forLanguage(_ code: String?) -> PushTexts {
        code?.lowercased().hasPrefix("hu") == true ? .hu : .en
    }

    /// Follows the device's preferred language, like the loc-key strings do.
    public static var current: PushTexts {
        forLanguage(Locale.preferredLanguages.first)
    }
}
