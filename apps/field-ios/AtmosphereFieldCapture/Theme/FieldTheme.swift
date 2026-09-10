import SwiftUI
import UIKit

/// Paper / ink / terracotta — same tokens as web Field Capture (+ dark parity).
enum FieldTheme {
    private static func adaptive(light: String, dark: String) -> Color {
        Color(uiColor: UIColor { traits in
            let hex = traits.userInterfaceStyle == .dark ? dark : light
            return UIColor(hex: hex) ?? .label
        })
    }

    static let bg = adaptive(light: "#FBFAF7", dark: "#141311")
    static let panel = adaptive(light: "#FFFFFF", dark: "#1D1B18")
    static let ink = adaptive(light: "#1C1917", dark: "#F1EFEB")
    static let muted = adaptive(light: "#57534E", dark: "#A09C93")
    static let faint = adaptive(light: "#A8A29E", dark: "#6B675F")
    static let line = adaptive(light: "#E3DED4", dark: "#2A2825")
    static let accent = Color(red: 0.737, green: 0.271, blue: 0.031) // #BC4508
    static let pass = Color(red: 0.247, green: 0.490, blue: 0.298)
    static let rec = Color(red: 0.851, green: 0.176, blue: 0.125)

    static let mono = Font.system(.body, design: .monospaced)
}

/// Matches web `atmosphere.theme` / `atm-theme` (`light` | `dark`).
enum AppearancePreference: String, CaseIterable, Identifiable {
    case light
    case dark

    var id: String { rawValue }

    var colorScheme: ColorScheme {
        switch self {
        case .light: return .light
        case .dark: return .dark
        }
    }

    var menuLabel: String {
        switch self {
        case .light: return "Appearance: Light"
        case .dark: return "Appearance: Dark"
        }
    }

    var toggleLabel: String {
        switch self {
        case .light: return "Switch to dark mode"
        case .dark: return "Switch to light mode"
        }
    }

    mutating func toggle() {
        self = self == .light ? .dark : .light
    }
}

private extension UIColor {
    convenience init?(hex: String) {
        var s = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.hasPrefix("#") { s.removeFirst() }
        guard s.count == 6, let v = UInt64(s, radix: 16) else { return nil }
        let r = CGFloat((v >> 16) & 0xff) / 255
        let g = CGFloat((v >> 8) & 0xff) / 255
        let b = CGFloat(v & 0xff) / 255
        self.init(red: r, green: g, blue: b, alpha: 1)
    }
}
