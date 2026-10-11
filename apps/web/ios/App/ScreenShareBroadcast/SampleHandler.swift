import ReplayKit
import CoreImage
import UIKit

/// JorKonvo's screen-share broadcast extension.
///
/// This is the iOS counterpart to Android's ScreenCaptureService
/// (apps/web/android/.../ScreenCaptureService.java): the piece that
/// actually receives raw screen frames. Unlike Android, it does not run
/// inside the app's own process - ReplayKit launches it as a wholly
/// separate, short-lived, memory-constrained (historically ~50MB) process
/// once the user confirms the system "Start Broadcasting" sheet (raised via
/// RPSystemBroadcastPickerView in App/ScreenSharePlugin.swift). The only way
/// back to the app is the shared App Group container (group.dev.szabotar.jorkonvo)
/// plus a Darwin notification to say "something changed" - there is no
/// in-process callback, delegate, or shared Swift object across that
/// boundary.
///
/// Each accepted video frame is downscaled and JPEG-encoded (mirroring
/// Android's ImageReader → JPEG pipeline) and written to
/// `latest_frame.jpg` in the App Group container; broadcast lifecycle
/// changes are written to `broadcast_state.txt`. Both writes are followed
/// by a Darwin notification so ScreenSharePlugin.swift, on the app side,
/// knows to read the file back out - see its header comment for the full
/// round trip into the web layer (iosScreenShare.ts).
final class SampleHandler: RPBroadcastSampleHandler {
    private static let appGroupID = "group.dev.szabotar.jorkonvo"
    private static let frameFileName = "latest_frame.jpg"
    private static let stateFileName = "broadcast_state.txt"
    private static let frameNotificationName = "dev.szabotar.jorkonvo.screenshare.frame" as CFString
    private static let stateNotificationName = "dev.szabotar.jorkonvo.screenshare.state" as CFString

    // ~12 fps ceiling matches the real-world ceiling Android's own bridge
    // settled on (docs/ANDROID_SCREENSHARE.md) - screen content doesn't need
    // more, and this extension's memory/CPU budget is tight.
    private let minFrameInterval: CFAbsoluteTime = 1.0 / 12.0
    private let maxLongSide: CGFloat = 1280
    private var lastFrameTime: CFAbsoluteTime = 0
    private lazy var ciContext = CIContext(options: [.useSoftwareRenderer: false])

    /// The app can't stop a system broadcast itself (RPSystemBroadcastPickerView
    /// hands it no RPBroadcastController), but it can ask this extension to:
    /// ScreenSharePlugin.stop() posts this Darwin notification and we end the
    /// broadcast from inside with finishBroadcastWithError - the same route
    /// Discord/Zoom/Jitsi use for an in-app "stop sharing" button. iOS then
    /// shows its own short alert with the error's description; there is no
    /// silent variant, so the description is written as a plain "stopped".
    static let stopNotificationName = "dev.szabotar.jorkonvo.screenshare.stop" as CFString
    fileprivate static weak var current: SampleHandler?

    override func broadcastStarted(withSetupInfo setupInfo: [String: NSObject]?) {
        Self.current = self
        CFNotificationCenterAddObserver(
            CFNotificationCenterGetDarwinNotifyCenter(), nil,
            { _, _, _, _, _ in
                DispatchQueue.main.async { SampleHandler.current?.stopRequestedByApp() }
            },
            Self.stopNotificationName, nil, .deliverImmediately
        )
        writeState("started")
    }

    fileprivate func stopRequestedByApp() {
        let hungarian = Locale.preferredLanguages.first?.hasPrefix("hu") ?? false
        let message = hungarian ? "Képernyőmegosztás leállítva." : "Screen sharing stopped."
        writeState("finished")
        finishBroadcastWithError(NSError(
            domain: "dev.szabotar.jorkonvo.screenshare", code: 0,
            userInfo: [NSLocalizedDescriptionKey: message]
        ))
    }

    override func broadcastPaused() {
        writeState("paused")
    }

    override func broadcastResumed() {
        writeState("resumed")
    }

    override func broadcastFinished() {
        writeState("finished")
    }

    override func processSampleBuffer(_ sampleBuffer: CMSampleBuffer, with sampleBufferType: RPSampleBufferType) {
        // Audio sample types (.audioApp, .audioMic) are deliberately ignored -
        // like Android's MediaProjection path, this bridges video only.
        guard sampleBufferType == .video else { return }
        let now = CFAbsoluteTimeGetCurrent()
        guard now - lastFrameTime >= minFrameInterval else { return }
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }

        autoreleasepool {
            guard let jpeg = jpegData(from: pixelBuffer) else { return }
            guard writeFrame(jpeg) else { return }
            lastFrameTime = now
            postNotification(Self.frameNotificationName)
        }
    }

    private func jpegData(from pixelBuffer: CVPixelBuffer) -> Data? {
        let ciImage = CIImage(cvPixelBuffer: pixelBuffer)
        let extent = ciImage.extent
        let longSide = max(extent.width, extent.height)
        let scale = longSide > maxLongSide ? maxLongSide / longSide : 1
        let scaled = scale < 1 ? ciImage.transformed(by: CGAffineTransform(scaleX: scale, y: scale)) : ciImage
        guard let cgImage = ciContext.createCGImage(scaled, from: scaled.extent) else { return nil }
        return UIImage(cgImage: cgImage).jpegData(compressionQuality: 0.6)
    }

    private func writeFrame(_ data: Data) -> Bool {
        guard let containerURL = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: Self.appGroupID) else {
            return false
        }
        // .atomic already writes to a temp file and renames it into place, so
        // the app side never reads a half-written frame. (A hand-rolled tmp +
        // replaceItemAt was used first; replaceItemAt can fail when the target
        // doesn't exist yet - i.e. on the very first frame, every broadcast.)
        do {
            try data.write(to: containerURL.appendingPathComponent(Self.frameFileName), options: .atomic)
            return true
        } catch {
            return false
        }
    }

    private func writeState(_ state: String) {
        if let containerURL = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: Self.appGroupID) {
            let url = containerURL.appendingPathComponent(Self.stateFileName)
            try? state.write(to: url, atomically: true, encoding: .utf8)
        }
        postNotification(Self.stateNotificationName)
    }

    private func postNotification(_ name: CFString) {
        CFNotificationCenterPostNotification(
            CFNotificationCenterGetDarwinNotifyCenter(),
            CFNotificationName(name),
            nil, nil, true
        )
    }
}
