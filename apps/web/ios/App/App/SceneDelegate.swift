import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        // Cold start from a tapped push: UIKit hands the tap to the scene
        // here, before the Capacitor bridge (and with it the notification
        // delegate) exists, so the delegate callback never fires for it.
        // MainViewController replays it into the bridge once plugins load.
        MainViewController.pendingNotificationResponse = connectionOptions.notificationResponse

        window = UIWindow(windowScene: windowScene)
        // MainViewController, not the stock CAPBridgeViewController: it registers
        // the app-local ScreenSharePlugin (see MainViewController.swift). This
        // line - not Main.storyboard - is what actually builds the root view.
        window?.rootViewController = MainViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
