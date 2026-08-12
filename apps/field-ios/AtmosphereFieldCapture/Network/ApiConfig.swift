import Foundation

/**
 * Where Field Capture talks to Atmosphere.
 *
 * Auth and today’s jobs use the same Atmosphere project the website uses
 * (Supabase). A local BFF (`http://127.0.0.1:4000`) is only used from the
 * iOS Simulator when that process is actually running — a physical iPhone
 * cannot reach the Mac’s loopback, which is why older builds showed
 * “Could not connect to the server.”
 */
enum ApiConfig {
    /// Atmosphere’s hosted project — same users and jobs as the dashboard.
    static let supabaseURL = URL(string: "https://ccxatzfsvzetciiwsjlj.supabase.co")!
    static let supabaseAnonKey = "sb_publishable_4ppzqtXQPeVPuzP8Ant-pQ_MZIPMcGn"

    static var isSimulator: Bool {
        #if targetEnvironment(simulator)
        true
        #else
        false
        #endif
    }

    /// Optional Express BFF. Nil on a physical device when the plist still
    /// points at localhost — the phone then uses Supabase directly.
    static func bffBaseURL() -> URL? {
        UserDefaults.standard.removeObject(forKey: "atmosphere.apiBase")
        let plist = Bundle.main.object(forInfoDictionaryKey: "ATMOSPHERE_API_BASE") as? String
        let env = ProcessInfo.processInfo.environment["ATMOSPHERE_API_BASE"]
        let raw = (plist?.isEmpty == false ? plist : nil)
            ?? (env?.isEmpty == false ? env : nil)
            ?? (isSimulator ? "http://127.0.0.1:4000" : nil)
        guard let raw, let url = URL(string: stripTrailingSlash(raw)),
              let scheme = url.scheme?.lowercased(),
              scheme == "http" || scheme == "https",
              let host = url.host, !host.isEmpty
        else { return nil }
        if isPlaceholder(host) { return nil }
        if isLoopback(host), !isSimulator { return nil }
        return url
    }

    static func resolvedBaseURL() -> URL {
        bffBaseURL() ?? supabaseURL
    }

    static func isLoopback(_ host: String) -> Bool {
        let h = host.lowercased()
        return h == "127.0.0.1" || h == "localhost" || h == "::1" || h == "0.0.0.0"
    }

    static func isPlaceholder(_ host: String) -> Bool {
        let h = host.lowercased()
        return h.hasSuffix(".example") || h.hasSuffix(".invalid") || h.hasSuffix(".test")
            || h.contains("your-atmosphere")
    }

    private static func stripTrailingSlash(_ s: String) -> String {
        s.hasSuffix("/") ? String(s.dropLast()) : s
    }
}
