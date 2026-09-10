import Foundation

/// Same marketing contact form Platform Support opens — Field Capture context, no secrets.
enum SupportLinks {
    static let contactURL = URL(string: "https://atmosphereteam.com/contact.html")!
    static let platformSettingsURL = URL(string: "https://platform.atmosphereteam.com/settings")!
    static let platformOrigin = URL(string: "https://platform.atmosphereteam.com")!
    static let fieldCaptureNote = "I need help with Atmosphere Field Capture."

    static func supportURL(
        email: String?,
        name: String?,
        orgName: String?,
        orgId: String?,
        path: String = "ios/field-capture"
    ) -> URL {
        var comps = URLComponents(url: contactURL, resolvingAgainstBaseURL: false)!
        var items: [URLQueryItem] = [
            URLQueryItem(name: "note", value: supportNote(
                email: email, name: name, orgName: orgName, orgId: orgId, path: path
            )),
        ]
        if let email, !email.isEmpty { items.append(URLQueryItem(name: "email", value: email)) }
        if let name, !name.isEmpty { items.append(URLQueryItem(name: "name", value: name)) }
        if let orgName, !orgName.isEmpty { items.append(URLQueryItem(name: "company", value: orgName)) }
        comps.queryItems = items
        return comps.url ?? contactURL
    }

    static func supportNote(
        email: String?,
        name: String?,
        orgName: String?,
        orgId: String?,
        path: String
    ) -> String {
        var org: String?
        let on = orgName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let oid = orgId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !on.isEmpty, !oid.isEmpty { org = "\(on) (\(oid))" }
        else if !on.isEmpty { org = on }
        else if !oid.isEmpty { org = "(\(oid))" }

        var lines: [String] = []
        if let org { lines.append("Organization: \(org)") }
        if !path.isEmpty { lines.append("Page: \(path)") }
        if let email, !email.isEmpty { lines.append("Email: \(email)") }
        if lines.isEmpty { return fieldCaptureNote }
        return fieldCaptureNote + "\n\n" + lines.joined(separator: "\n")
    }
}
