import Capacitor
import UIKit
import UserNotifications

/// The app's bridge view controller (Main.storyboard's initial scene).
///
/// Capacitor iOS only auto-registers plugins listed in capacitor.config.json's
/// `packageClassList`, which `cap sync` fills from npm packages alone - a
/// plugin living in this app target (ScreenSharePlugin.swift,
/// PushStorePlugin.swift) is never on it,
/// so without this the JS side's registerPlugin("ScreenShare") calls just
/// reject as unimplemented. The iOS counterpart of Android's MainActivity
/// registerPlugin(ScreenCapturePlugin.class).
class MainViewController: CAPBridgeViewController {
    /// A push tapped while the app wasn't running (set by SceneDelegate).
    static var pendingNotificationResponse: UNNotificationResponse?

    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(ScreenSharePlugin())
        bridge?.registerPluginInstance(PushStorePlugin())
        replayLaunchNotification()
    }

    /// Feeds a cold-start push tap to Capacitor's NotificationRouter, which
    /// passes it to the push plugin -> JS `pushNotificationActionPerformed`
    /// (retained until the JS listener attaches) -> the room opens. If iOS
    /// also delivers it to the delegate later, opening the room twice is
    /// harmless.
    private func replayLaunchNotification() {
        guard let response = Self.pendingNotificationResponse, let bridge = bridge else { return }
        Self.pendingNotificationResponse = nil
        bridge.notificationRouter.userNotificationCenter(
            UNUserNotificationCenter.current(),
            didReceive: response,
            withCompletionHandler: {}
        )
    }
}
