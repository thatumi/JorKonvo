import Capacitor
import Foundation
import JorPushCore

/// JS side: src/lib/push/nativeStore.ts ("JorPushStore"). Hands the
/// Notification Service Extension what it needs while the app is closed -
/// see JorPushCore.PushStore. Same methods as Android's PushStorePlugin.java;
/// all work runs off the main thread (key export batches can be large).
@objc(PushStorePlugin)
public class PushStorePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PushStorePlugin"
    public let jsName = "JorPushStore"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setAccount", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearAccount", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "listAccounts", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "addRoomKeys", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "listSessionIds", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearRoomKeys", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setDirectory", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "putAvatar", returnType: CAPPluginReturnPromise),
    ]

    private let queue = DispatchQueue(label: "dev.szabotar.jorkonvo.pushstore")

    private struct MissingArgument: Error, CustomStringConvertible {
        let description: String
    }

    private func background(_ call: CAPPluginCall, _ work: @escaping (PushStore) throws -> Void) {
        queue.async {
            guard let store = PushStore() else {
                call.reject("App Group container unavailable")
                return
            }
            do {
                try work(store)
            } catch {
                call.reject("\(type(of: error)): \(error)")
            }
        }
    }

    private func required(_ call: CAPPluginCall, _ key: String) throws -> String {
        guard let v = call.getString(key), !v.isEmpty else { throw MissingArgument(description: "\(key) is required") }
        return v
    }

    @objc func setAccount(_ call: CAPPluginCall) {
        background(call) { store in
            try store.setAccount(
                userId: try self.required(call, "userId"),
                homeserverUrl: try self.required(call, "homeserverUrl"),
                accessToken: try self.required(call, "accessToken"),
                mode: try self.required(call, "mode")
            )
            call.resolve()
        }
    }

    @objc func clearAccount(_ call: CAPPluginCall) {
        background(call) { store in
            store.clearAccount(userId: try self.required(call, "userId"))
            call.resolve()
        }
    }

    @objc func listAccounts(_ call: CAPPluginCall) {
        background(call) { store in
            call.resolve(["userIds": store.listAccounts()])
        }
    }

    @objc func addRoomKeys(_ call: CAPPluginCall) {
        background(call) { store in
            let sessions: [[String: Any]] = (call.getArray("sessions") ?? []).compactMap { $0 as? JSObject }
            let count = try store.addRoomKeys(userId: try self.required(call, "userId"), sessions: sessions)
            call.resolve(["count": count])
        }
    }

    @objc func listSessionIds(_ call: CAPPluginCall) {
        background(call) { store in
            call.resolve(["sessionIds": store.listSessionIds(userId: try self.required(call, "userId"))])
        }
    }

    @objc func clearRoomKeys(_ call: CAPPluginCall) {
        background(call) { store in
            store.clearRoomKeys(userId: try self.required(call, "userId"))
            call.resolve()
        }
    }

    @objc func setDirectory(_ call: CAPPluginCall) {
        background(call) { store in
            let directory: [String: Any] = call.getObject("directory") ?? [:]
            try store.setDirectory(userId: try self.required(call, "userId"), directory: directory)
            call.resolve()
        }
    }

    @objc func putAvatar(_ call: CAPPluginCall) {
        background(call) { store in
            let png = try Megolm.unbase64(try self.required(call, "pngBase64"))
            try store.putAvatar(userId: try self.required(call, "userId"), key: try self.required(call, "key"), png: png)
            call.resolve()
        }
    }
}
