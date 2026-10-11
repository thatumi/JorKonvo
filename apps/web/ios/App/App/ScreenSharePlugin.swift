import Capacitor
import Foundation
import ReplayKit

/// Bridges JorKonvo's web layer (iosScreenShare.ts) to the ReplayKit
/// broadcast extension (../ScreenShareBroadcast/SampleHandler.swift).
///
/// Starting: iOS only lets an app show RPSystemBroadcastPickerView, a
/// system-owned control whose tap opens Apple's mandatory "Start
/// Broadcasting" sheet. Like Discord, we keep that to one tap on our own
/// "Share screen" button: the picker is added invisibly and its internal
/// button is sendActions()-tapped for the user. If that button can't be
/// found (it's private view structure, which a future iOS could change),
/// the picker is shown visibly on a dimmed backdrop instead, for the user
/// to tap. (An earlier note here claimed the auto-tap was "confirmed dead on
/// a real device" - wrong: in those builds this plugin wasn't compiled into
/// the app at all, so the auto-tap never ran.) There is no callback telling
/// us whether the user confirmed the sheet; iosScreenShare.ts infers it from
/// the extension's own "started" state, with a timeout standing in for a
/// cancel.
///
/// Stopping: there's no RPBroadcastController to call stop() on from here,
/// so stop() posts a Darwin notification that the extension answers by
/// ending the broadcast itself (finishBroadcastWithError) - the in-app
/// "stop sharing" route other ReplayKit apps use too. iOS's own red status
/// bar / Dynamic Island control keeps working as well; either way the
/// extension's "finished" state is how iosScreenShare.ts finds out.
@objc(ScreenSharePlugin)
public class ScreenSharePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ScreenSharePlugin"
    public let jsName = "ScreenShare"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "addListener", returnType: CAPPluginReturnCallback),
        CAPPluginMethod(name: "removeAllListeners", returnType: CAPPluginReturnPromise),
    ]

    static let appGroupID = "group.dev.szabotar.jorkonvo"
    static let extensionBundleID = "dev.szabotar.jorkonvo.ScreenShareBroadcast"
    static let frameNotificationName = "dev.szabotar.jorkonvo.screenshare.frame"
    static let stateNotificationName = "dev.szabotar.jorkonvo.screenshare.state"
    static let stopNotificationName = "dev.szabotar.jorkonvo.screenshare.stop"

    private var backdropView: UIView?
    private var pickerView: RPSystemBroadcastPickerView?
    private var observing = false

    @objc func start(_ call: CAPPluginCall) {
        guard let containerURL = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: Self.appGroupID) else {
            call.reject("App Group container unavailable")
            return
        }
        guard let window = self.bridge?.viewController?.view.window else {
            call.reject("No window to host the system broadcast picker")
            return
        }

        // Clear any stale frame/state from a previous run - otherwise a
        // leftover file could be mistaken for a fresh one before the
        // extension (which may take a moment to actually launch) writes again.
        try? FileManager.default.removeItem(at: containerURL.appendingPathComponent("latest_frame.jpg"))
        try? FileManager.default.removeItem(at: containerURL.appendingPathComponent("broadcast_state.txt"))

        startObserving()

        DispatchQueue.main.async {
            self.presentPicker(in: window)
        }
        call.resolve()
    }

    /// One-tap path: an invisible (but real-sized, in-bounds - a degenerate
    /// frame never builds the internal button) picker, auto-tapped. Falls
    /// back to showing it visibly if its button never turns up.
    private func presentPicker(in window: UIWindow) {
        dismissPicker() // in case a previous picker is still up

        let picker = RPSystemBroadcastPickerView(frame: CGRect(x: 0, y: 0, width: 44, height: 44))
        picker.preferredExtension = Self.extensionBundleID
        picker.showsMicrophoneButton = false
        picker.alpha = 0.011 // hidden from view, still laid out
        // sendActions() reaches the button's targets regardless; this only
        // stops the invisible corner view from eating the user's own taps
        // while it lingers (until "started", stop(), or the next start()).
        picker.isUserInteractionEnabled = false
        window.addSubview(picker)
        picker.layoutIfNeeded()
        self.pickerView = picker
        tapPickerButton(picker, in: window, attemptsLeft: 10)
    }

    private func tapPickerButton(_ picker: RPSystemBroadcastPickerView, in window: UIWindow, attemptsLeft: Int) {
        guard picker === pickerView else { return } // dismissed/replaced meanwhile
        if let button = Self.findButton(in: picker) {
            button.sendActions(for: .touchUpInside)
            return
        }
        guard attemptsLeft > 0 else {
            presentVisiblePicker(in: window)
            return
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
            self.tapPickerButton(picker, in: window, attemptsLeft: attemptsLeft - 1)
        }
    }

    private static func findButton(in view: UIView) -> UIButton? {
        if let button = view as? UIButton { return button }
        for subview in view.subviews {
            if let found = findButton(in: subview) { return found }
        }
        return nil
    }

    /// Fallback: a dimmed backdrop (tap outside to cancel) with the real,
    /// visible system picker button centered on top of it. `emitState()`
    /// dismisses it once the extension reports "started".
    private func presentVisiblePicker(in window: UIWindow) {
        dismissPicker()

        let backdrop = UIView(frame: window.bounds)
        backdrop.backgroundColor = UIColor.black.withAlphaComponent(0.4)
        backdrop.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        backdrop.addGestureRecognizer(
            UITapGestureRecognizer(target: self, action: #selector(cancelPicker))
        )
        window.addSubview(backdrop)

        let size: CGFloat = 72
        let picker = RPSystemBroadcastPickerView(
            frame: CGRect(x: 0, y: 0, width: size, height: size)
        )
        picker.center = CGPoint(x: window.bounds.midX, y: window.bounds.midY)
        picker.autoresizingMask = [
            .flexibleTopMargin, .flexibleBottomMargin, .flexibleLeftMargin, .flexibleRightMargin,
        ]
        picker.preferredExtension = Self.extensionBundleID
        picker.showsMicrophoneButton = false
        picker.backgroundColor = .white
        picker.layer.cornerRadius = size / 2
        picker.clipsToBounds = true
        window.addSubview(picker)

        self.backdropView = backdrop
        self.pickerView = picker
    }

    @objc private func cancelPicker() {
        dismissPicker()
        stopObserving()
        // No CAPPluginCall reference survives to reject here (start() already
        // resolved) - iosScreenShare.ts's own start-timeout is what turns
        // this silence into a normal "the user didn't share" outcome.
    }

    private func dismissPicker() {
        backdropView?.removeFromSuperview()
        backdropView = nil
        pickerView?.removeFromSuperview()
        pickerView = nil
    }

    @objc func stop(_ call: CAPPluginCall) {
        // Ask the extension to end the OS-level broadcast (see
        // SampleHandler.stopRequestedByApp) - harmless if none is running.
        CFNotificationCenterPostNotification(
            CFNotificationCenterGetDarwinNotifyCenter(),
            CFNotificationName(Self.stopNotificationName as CFString),
            nil, nil, true
        )
        stopObserving()
        DispatchQueue.main.async { self.dismissPicker() }
        call.resolve()
    }

    private func startObserving() {
        guard !observing else { return }
        observing = true
        let center = CFNotificationCenterGetDarwinNotifyCenter()
        let observer = Unmanaged.passUnretained(self).toOpaque()
        CFNotificationCenterAddObserver(
            center, observer, screenShareNotificationCallback,
            Self.frameNotificationName as CFString, nil, .deliverImmediately
        )
        CFNotificationCenterAddObserver(
            center, observer, screenShareNotificationCallback,
            Self.stateNotificationName as CFString, nil, .deliverImmediately
        )
    }

    private func stopObserving() {
        guard observing else { return }
        observing = false
        CFNotificationCenterRemoveEveryObserver(
            CFNotificationCenterGetDarwinNotifyCenter(),
            Unmanaged.passUnretained(self).toOpaque()
        )
    }

    func emitLatestFrame() {
        guard let containerURL = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: Self.appGroupID) else { return }
        let url = containerURL.appendingPathComponent("latest_frame.jpg")
        guard let data = try? Data(contentsOf: url) else { return }
        notifyListeners("frame", data: ["base64": data.base64EncodedString()])
    }

    func emitState() {
        guard let containerURL = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: Self.appGroupID) else { return }
        let url = containerURL.appendingPathComponent("broadcast_state.txt")
        let state = (try? String(contentsOf: url, encoding: .utf8)) ?? "unknown"
        notifyListeners("state", data: ["state": state])
        if state == "started" || state == "finished" {
            // "started": the user tapped through - the picker's job is done,
            // and iOS's own recording indicator takes over from here.
            // "finished": belt-and-braces cleanup in case it's somehow still
            // showing (e.g. the user cancelled from a route this plugin
            // didn't catch).
            DispatchQueue.main.async { self.dismissPicker() }
        }
        if state == "finished" {
            stopObserving()
        }
    }
}

/// A free function, not a method: CFNotificationCenterAddObserver needs a
/// plain C function pointer with no captured context, which an instance
/// method's implicit `self` capture can't provide.
private func screenShareNotificationCallback(
    center: CFNotificationCenter?,
    observer: UnsafeMutableRawPointer?,
    name: CFNotificationName?,
    object: UnsafeRawPointer?,
    userInfo: CFDictionary?
) {
    guard let observer, let name else { return }
    let plugin = Unmanaged<ScreenSharePlugin>.fromOpaque(observer).takeUnretainedValue()
    switch name.rawValue as String {
    case ScreenSharePlugin.frameNotificationName:
        plugin.emitLatestFrame()
    case ScreenSharePlugin.stateNotificationName:
        plugin.emitState()
    default:
        break
    }
}
