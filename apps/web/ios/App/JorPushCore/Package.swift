// swift-tools-version: 5.9
import PackageDescription

// Push phase 2 on iOS: what both the app (JorPushStore plugin, writes) and
// the Notification Service Extension (reads, fetches, decrypts) need.
// Hand-written, unlike CapApp-SPM next to it - `cap sync` never touches it.
// `swift test` runs the Megolm vectors on a Mac (codemagic.yaml build-unsigned).
let package = Package(
    name: "JorPushCore",
    platforms: [.iOS(.v15), .macOS(.v12)],
    products: [
        .library(name: "JorPushCore", targets: ["JorPushCore"])
    ],
    targets: [
        .target(name: "JorPushCore"),
        .testTarget(name: "JorPushCoreTests", dependencies: ["JorPushCore"]),
    ]
)
