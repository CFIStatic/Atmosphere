import Foundation

/**
 * Where Field Capture talks to Atmosphere.
 *
 * Same backend the website / dashboard uses (`/api/auth/login`). Saved once
 * on the phone so crew are not typing a server URL every day.
 */
enum ApiConfig {
    static let defaultsKey = "atmosphere.apiBase"

    /// Info.plist / env default, then any saved override from first connect.
    static func resolvedBaseString() -> String {
        if let saved = UserDefaults.standard.string(forKey: defaultsKey)?
            .trimmingCharacters(in: .whitespacesAndNewlines),
           !saved.isEmpty
        {
            return stripTrailingSlash(saved)
        }
        let plist = Bundle.main.object(forInfoDictionaryKey: "ATMOSPHERE_API_BASE") as? String
        let env = ProcessInfo.processInfo.environment["ATMOSPHERE_API_BASE"]
        let raw = (plist?.isEmpty == false ? plist : nil)
            ?? (env?.isEmpty == false ? env : nil)
            ?? "http://127.0.0.1:4000"
        return stripTrailingSlash(raw!)
    }

    static func resolvedBaseURL() -> URL {
        URL(string: resolvedBaseString())!
    }

    static func saveBaseString(_ raw: String) {
        let trimmed = stripTrailingSlash(raw.trimmingCharacters(in: .whitespacesAndNewlines))
        guard !trimmed.isEmpty else { return }
        UserDefaults.standard.set(trimmed, forKey: defaultsKey)
    }

    private static func stripTrailingSlash(_ s: String) -> String {
        if s.hasSuffix("/") { return String(s.dropLast()) }
        return s
    }
}
