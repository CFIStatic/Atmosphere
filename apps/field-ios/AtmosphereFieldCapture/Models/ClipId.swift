import Foundation

/// One id per recording — lowercase base36, matches web `FieldCaptureCore.newClipId`
/// and server `CLIP_ID` (`^[a-z0-9]{6,32}$`). Sent on upload-url / upload-part-url so
/// same-day multi-film never shares a storage stem.
enum ClipId {
    static func isValid(_ value: String) -> Bool {
        let count = value.count
        guard (6 ... 32).contains(count) else { return false }
        return value.unicodeScalars.allSatisfy { scalar in
            (scalar >= "a" && scalar <= "z") || (scalar >= "0" && scalar <= "9")
        }
    }

    /// Mint a fresh clip id (web charset rules). Always prefer sending this from
    /// the phone even though the server also mints when omitted.
    static func mint() -> String {
        let stamp = String(Int(Date().timeIntervalSince1970 * 1000), radix: 36)
        var rand = ""
        for _ in 0 ..< 8 {
            rand.append(String(UInt8.random(in: 0 ..< 36), radix: 36))
        }
        let raw = (stamp + rand)
            .lowercased()
            .filter { ($0 >= "a" && $0 <= "z") || ($0 >= "0" && $0 <= "9") }
        let clipped = String(raw.prefix(32))
        if clipped.count >= 6 { return clipped }
        var pad = clipped
        while pad.count < 8 {
            pad.append(String(UInt8.random(in: 0 ..< 36), radix: 36))
        }
        return String(pad.prefix(32))
    }

    static func resolve(_ value: String?) -> String {
        if let value, isValid(value) { return value }
        return mint()
    }
}
