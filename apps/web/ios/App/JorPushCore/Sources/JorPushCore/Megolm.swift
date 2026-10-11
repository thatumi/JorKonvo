import CommonCrypto
import CryptoKit
import Foundation

/// Decrypt-only Megolm (m.megolm.v1.aes-sha2) - the Swift twin of
/// android/.../push/Megolm.java, tested against the same vodozemac vectors.
///
/// Input is what the app exports (matrix-js-sdk exportRoomKeys, see
/// src/lib/push/nativeStore.ts): an "exported session key"
///
///   0x01 | u32 BE message index | R0 R1 R2 R3 (4 x 32 bytes) | Ed25519 key (32)
///
/// and a Megolm message
///
///   0x03 | protobuf{ 0x08 varint index, 0x12 varint len ciphertext } | MAC (8) | Ed25519 signature (64)
///
/// Per the Megolm spec (and libolm's megolm_advance_to): advance the ratchet
/// to the message index, HKDF-SHA256(ratchet, "MEGOLM_KEYS") -> AES-256 key |
/// HMAC key | IV, check the truncated HMAC and the Ed25519 signature (always
/// available here, unlike older Android), AES-256-CBC/PKCS7 decrypt.
public enum Megolm {
    public struct DecryptionError: Error, Equatable, CustomStringConvertible {
        public let description: String
        init(_ description: String) { self.description = description }
    }

    private static let exportedKeyLength = 1 + 4 + 128 + 32
    private static let macLength = 8
    private static let signatureLength = 64

    /// Returns the decrypted plaintext (the event JSON).
    public static func decrypt(exportedSessionKey: String, ciphertext: String) throws -> String {
        let key = try unbase64(exportedSessionKey)
        guard key.count == exportedKeyLength, key[0] == 0x01 else {
            throw DecryptionError("not an exported Megolm session key")
        }
        let firstIndex = readU32(key, 1)
        var ratchet = (0..<4).map { j in Data(key[(5 + 32 * j)..<(5 + 32 * (j + 1))]) }
        let signingKey = Data(key[(5 + 128)..<exportedKeyLength])

        let msg = try unbase64(ciphertext)
        guard msg.count >= 1 + macLength + signatureLength, msg[0] == 0x03 else {
            throw DecryptionError("not a Megolm v3 message")
        }
        let macEnd = msg.count - signatureLength
        let bodyEnd = macEnd - macLength

        // Protobuf body: message index (field 1, varint) + ciphertext (field 2, bytes).
        var index: UInt64?
        var body: Data?
        var pos = 1
        while pos < bodyEnd {
            let tag = try readVarint(msg, &pos, bodyEnd)
            if tag == 0x08 {
                index = try readVarint(msg, &pos, bodyEnd)
            } else if tag == 0x12 {
                let len = try readVarint(msg, &pos, bodyEnd)
                guard len <= UInt64(bodyEnd - pos) else { throw DecryptionError("bad ciphertext length") }
                body = Data(msg[pos..<(pos + Int(len))])
                pos += Int(len)
            } else {
                throw DecryptionError("unexpected protobuf tag \(tag)")
            }
        }
        guard let index, let body, index <= UInt64(UInt32.max) else { throw DecryptionError("incomplete message") }
        guard index >= UInt64(firstIndex) else {
            throw DecryptionError("message index \(index) is before the known index \(firstIndex)")
        }

        advance(&ratchet, from: firstIndex, to: UInt32(index))
        let material = ratchet.reduce(Data(), +)
        let keys = HKDF<SHA256>.deriveKey(
            inputKeyMaterial: SymmetricKey(data: material),
            info: Data("MEGOLM_KEYS".utf8),
            outputByteCount: 80
        ).withUnsafeBytes { Data($0) }
        let aesKey = keys[0..<32]
        let macKey = keys[32..<64]
        let iv = keys[64..<80]

        let mac = Data(HMAC<SHA256>.authenticationCode(for: msg[0..<bodyEnd], using: SymmetricKey(data: macKey)))
        guard constantTimeEqual(mac.prefix(macLength), Data(msg[bodyEnd..<macEnd])) else {
            throw DecryptionError("MAC mismatch")
        }
        let publicKey: Curve25519.Signing.PublicKey
        do {
            publicKey = try Curve25519.Signing.PublicKey(rawRepresentation: signingKey)
        } catch {
            throw DecryptionError("bad signing key")
        }
        guard publicKey.isValidSignature(Data(msg[macEnd...]), for: Data(msg[0..<macEnd])) else {
            throw DecryptionError("bad signature")
        }

        let plain = try aesCbcDecrypt(key: Data(aesKey), iv: Data(iv), data: body)
        guard let text = String(data: plain, encoding: .utf8) else { throw DecryptionError("plaintext is not UTF-8") }
        return text
    }

    /// libolm megolm_advance_to: R(j) rehashes R(j..3) whenever its byte of the counter changes.
    static func advance(_ r: inout [Data], from start: UInt32, to target: UInt32) {
        var counter = start
        for j in 0..<4 {
            let shift = UInt32((3 - j) * 8)
            let mask = ~UInt32(0) << shift
            var steps = ((target >> shift) &- (counter >> shift)) & 0xFF
            // Only a wrap-around (target < counter) would need a full lap;
            // never the case here because target >= counter is checked.
            if steps == 0 { continue }
            // All but the last step only bump R(j) itself...
            while steps > 1 {
                r[j] = hmac(r[j], UInt8(j))
                steps -= 1
            }
            // ...the last one also re-seeds R(j+1)..R(3) from it (R(j) last).
            let seed = r[j]
            for k in stride(from: 3, through: j, by: -1) { r[k] = hmac(seed, UInt8(k)) }
            counter = target & mask
        }
    }

    private static func hmac(_ key: Data, _ byte: UInt8) -> Data {
        Data(HMAC<SHA256>.authenticationCode(for: Data([byte]), using: SymmetricKey(data: key)))
    }

    private static func aesCbcDecrypt(key: Data, iv: Data, data: Data) throws -> Data {
        var out = Data(count: data.count + kCCBlockSizeAES128)
        var written = 0
        let outCapacity = out.count
        let status = out.withUnsafeMutableBytes { outPtr in
            data.withUnsafeBytes { inPtr in
                key.withUnsafeBytes { keyPtr in
                    iv.withUnsafeBytes { ivPtr in
                        CCCrypt(
                            CCOperation(kCCDecrypt), CCAlgorithm(kCCAlgorithmAES), CCOptions(kCCOptionPKCS7Padding),
                            keyPtr.baseAddress, key.count, ivPtr.baseAddress,
                            inPtr.baseAddress, data.count,
                            outPtr.baseAddress, outCapacity, &written
                        )
                    }
                }
            }
        }
        guard status == kCCSuccess else { throw DecryptionError("AES failure \(status)") }
        return out.prefix(written)
    }

    private static func constantTimeEqual(_ a: Data, _ b: Data) -> Bool {
        guard a.count == b.count else { return false }
        return zip(a, b).reduce(UInt8(0)) { $0 | ($1.0 ^ $1.1) } == 0
    }

    private static func readU32(_ b: Data, _ off: Int) -> UInt32 {
        (UInt32(b[off]) << 24) | (UInt32(b[off + 1]) << 16) | (UInt32(b[off + 2]) << 8) | UInt32(b[off + 3])
    }

    private static func readVarint(_ b: Data, _ pos: inout Int, _ end: Int) throws -> UInt64 {
        var result: UInt64 = 0
        var shift: UInt64 = 0
        while shift < 64 {
            guard pos < end else { throw DecryptionError("truncated varint") }
            let x = b[pos]
            pos += 1
            result |= UInt64(x & 0x7F) << shift
            if x & 0x80 == 0 { return result }
            shift += 7
        }
        throw DecryptionError("varint too long")
    }

    /// Standard or URL-safe base64, padding optional (Matrix sends it unpadded).
    /// The result is re-based to index 0, so byte offsets above are absolute.
    public static func unbase64(_ s: String) throws -> Data {
        var t = s.trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        while t.hasSuffix("=") { t.removeLast() }
        if t.count % 4 == 1 { throw DecryptionError("bad base64 length") }
        t += String(repeating: "=", count: (4 - t.count % 4) % 4)
        guard let d = Data(base64Encoded: t) else { throw DecryptionError("bad base64") }
        return Data(d)
    }
}
