import Foundation

/**
 * Where Field Capture talks to Atmosphere.
 *
 * Same backend the website / dashboard uses (`/api/auth/login`). Saved once
 * on the phone so crew are not typing a server URL every day.
 *
 * Defaults:
 * - Simulator → `http://127.0.0.1:4000` (Mac loopback)
 * - Physical device → empty until set (127.0.0.1 is the phone itself)
 *
 * Legacy builds shipped `https://api.atmosphere.example`, which DNS-fails with
 * “A server with the specified hostname could not be found.” Those values are
 * stripped on resolve so connect can recover after an upgrade.
 */
enum ApiConfig {
    static let defaultsKey = "atmosphere.apiBase"
    static let simulatorDefault = "http://127.0.0.1:4000"

    /// Info.plist / env default, then any saved override from first connect.
    static func resolvedBaseString() -> String {
        migrateLegacyPlaceholderIfNeeded()

        if let saved = UserDefaults.standard.string(forKey: defaultsKey)?
            .trimmingCharacters(in: .whitespacesAndNewlines),
           !saved.isEmpty,
           !isUnusableHost(saved)
        {
            return stripTrailingSlash(saved)
        }

        let plist = Bundle.main.object(forInfoDictionaryKey: "ATMOSPHERE_API_BASE") as? String
        let env = ProcessInfo.processInfo.environment["ATMOSPHERE_API_BASE"]
        let candidate = (plist?.isEmpty == false ? plist : nil)
            ?? (env?.isEmpty == false ? env : nil)
            ?? builtInDefault()

        guard let candidate, !candidate.isEmpty, !isUnusableHost(candidate) else {
            return builtInDefault()
        }
        return stripTrailingSlash(candidate)
    }

    static func resolvedBaseURL() -> URL {
        let raw = resolvedBaseString()
        if let url = URL(string: raw), url.scheme == "http" || url.scheme == "https" {
            return url
        }
        return URL(string: simulatorDefault)!
    }

    static func saveBaseString(_ raw: String) {
        let trimmed = stripTrailingSlash(raw.trimmingCharacters(in: .whitespacesAndNewlines))
        guard !trimmed.isEmpty else { return }
        UserDefaults.standard.set(trimmed, forKey: defaultsKey)
    }

    static func clearSavedBase() {
        UserDefaults.standard.removeObject(forKey: defaultsKey)
    }

    /// True when this URL can never work from the current device.
    static func validationError(for raw: String) -> String? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: trimmed),
              let scheme = url.scheme?.lowercased(),
              scheme == "http" || scheme == "https",
              let host = url.host, !host.isEmpty
        else {
            return "Enter a valid API URL, like http://192.168.1.20:4000 or https://your-atmosphere-host"
        }
        if isPlaceholderHost(host) {
            return "That API host is a placeholder and does not exist. Use your Mac’s LAN IP or your real Atmosphere API URL."
        }
        if isLoopbackHost(host), !isSimulator {
            return "This phone can’t reach \(host) — that address is the phone itself. Enter your Mac’s LAN IP (System Settings → Network), e.g. http://192.168.1.20:4000, or your deployed Atmosphere API URL."
        }
        return nil
    }

    static var isSimulator: Bool {
        #if targetEnvironment(simulator)
        true
        #else
        false
        #endif
    }

    static func isLoopbackHost(_ host: String) -> Bool {
        let h = host.lowercased()
        return h == "127.0.0.1" || h == "localhost" || h == "::1" || h == "0.0.0.0"
    }

    static func isPlaceholderHost(_ host: String) -> Bool {
        let h = host.lowercased()
        if h.hasSuffix(".example") || h.hasSuffix(".invalid") || h.hasSuffix(".test") {
            return true
        }
        if h.contains("your-atmosphere") || h == "example.com" {
            return true
        }
        return false
    }

    static func isUnusableHost(_ raw: String) -> Bool {
        guard let url = URL(string: raw.trimmingCharacters(in: .whitespacesAndNewlines)),
              let host = url.host
        else {
            return true
        }
        if isPlaceholderHost(host) { return true }
        if isLoopbackHost(host), !isSimulator { return true }
        return false
    }

    private static func builtInDefault() -> String {
        isSimulator ? simulatorDefault : ""
    }

    /// Drop saved / plist values from early builds that pointed at a fake DNS name.
    private static func migrateLegacyPlaceholderIfNeeded() {
        if let saved = UserDefaults.standard.string(forKey: defaultsKey),
           isUnusableHost(saved) || (URL(string: saved)?.host).map(isPlaceholderHost) == true
        {
            UserDefaults.standard.removeObject(forKey: defaultsKey)
        }
    }

    private static func stripTrailingSlash(_ s: String) -> String {
        if s.hasSuffix("/") { return String(s.dropLast()) }
        return s
    }
}
