import Foundation

/**
 * Where Field Capture talks to Atmosphere.
 *
 * Physical iPhones and the simulator file day films directly through the
 * public BFF. That is what queues internal AI action-reading and avoids
 * depending on an office nginx proxy for native traffic. Set
 * `ATMOSPHERE_API_BASE` in the Xcode scheme when intentionally testing a local
 * BFF. Direct Supabase is only a fallback if the BFF is unreachable, so
 * a crew can still upload when the API is down — those films will not be
 * read until they are filed through `/api/field-app`.
 */
enum ApiConfig {
    /// Atmosphere’s hosted project — same users and jobs as the dashboard.
    static let supabaseURL = URL(string: "https://ccxatzfsvzetciiwsjlj.supabase.co")!
    static let supabaseAnonKey = "sb_publishable_4ppzqtXQPeVPuzP8Ant-pQ_MZIPMcGn"

    /// Production Express BFF origin.
    static let productionBffURL = URL(string: "https://atmosphere-production.up.railway.app")!

    static var isSimulator: Bool {
        #if targetEnvironment(simulator)
        true
        #else
        false
        #endif
    }

    /// Optional Express BFF. Nil only when no usable origin can be resolved.
    static func bffBaseURL() -> URL? {
        UserDefaults.standard.removeObject(forKey: "atmosphere.apiBase")
        let env = ProcessInfo.processInfo.environment["ATMOSPHERE_API_BASE"]
        let plist = Bundle.main.object(forInfoDictionaryKey: "ATMOSPHERE_API_BASE") as? String
        let raw = (env?.isEmpty == false ? env : nil)
            ?? (plist?.isEmpty == false ? plist : nil)
            ?? productionBffURL.absoluteString
        guard let raw, let url = URL(string: stripTrailingSlash(raw)),
              let scheme = url.scheme?.lowercased(),
              scheme == "http" || scheme == "https",
              let host = url.host, !host.isEmpty
        else {
            return isSimulator ? nil : productionBffURL
        }
        if isPlaceholder(host) { return isSimulator ? nil : productionBffURL }
        if isLoopback(host), !isSimulator { return productionBffURL }
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
