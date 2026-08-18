import Foundation

/// Pull a job-share token out of an invite URL or a pasted path.
enum ShareLink {
    static func token(from raw: String) -> String? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return nil }
        if let url = URL(string: trimmed) {
            if let found = token(from: url) { return found }
        }
        if trimmed.range(of: "^[A-Za-z0-9+/=_-]{8,200}$", options: .regularExpression) != nil {
            return trimmed
        }
        return nil
    }

    static func token(from url: URL) -> String? {
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems
        if let value = items?.first(where: { $0.name == "token" || $0.name == "share" })?.value,
           value.count >= 6
        {
            return value
        }

        let parts = url.path.split(separator: "/").map(String.init)
        if let idx = parts.firstIndex(where: { $0.lowercased() == "shared" }),
           idx + 1 < parts.count
        {
            return parts[idx + 1].removingPercentEncoding ?? parts[idx + 1]
        }

        let host = (url.host ?? url.path).lowercased()
        if url.scheme?.lowercased() == "atmosphere-field" {
            if host == "share" || host.hasPrefix("share") || host == "shared" {
                if let value = items?.first(where: { $0.name == "token" })?.value, value.count >= 6 {
                    return value
                }
                let rest = url.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
                if rest.count >= 6 { return rest.removingPercentEncoding ?? rest }
            }
        }
        return nil
    }

    static func encode(_ token: String) -> String {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-_.~")
        return token.addingPercentEncoding(withAllowedCharacters: allowed) ?? token
    }
}
