import Foundation

/**
 * Where Field Capture talks to Atmosphere.
 *
 * Baked in at build time (`ATMOSPHERE_API_BASE` in Info.plist / the Xcode
 * scheme). Crew never pick a host — they sign in with the same email and
 * password as the website.
 */
enum ApiConfig {
    static func resolvedBaseString() -> String {
        // Older builds let crew type a host; that override is gone.
        UserDefaults.standard.removeObject(forKey: "atmosphere.apiBase")
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

    private static func stripTrailingSlash(_ s: String) -> String {
        if s.hasSuffix("/") { return String(s.dropLast()) }
        return s
    }
}
