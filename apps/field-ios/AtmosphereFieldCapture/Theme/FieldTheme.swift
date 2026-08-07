import SwiftUI

/// Paper / ink / terracotta — same tokens as web Field Capture + Verifier.
enum FieldTheme {
    static let bg = Color(red: 0.984, green: 0.980, blue: 0.969) // #FBFAF7
    static let panel = Color.white
    static let ink = Color(red: 0.110, green: 0.098, blue: 0.090)
    static let muted = Color(red: 0.341, green: 0.325, blue: 0.306)
    static let faint = Color(red: 0.659, green: 0.635, blue: 0.620)
    static let line = Color(red: 0.890, green: 0.871, blue: 0.831)
    static let accent = Color(red: 0.737, green: 0.271, blue: 0.031) // #BC4508
    static let pass = Color(red: 0.247, green: 0.490, blue: 0.298)
    static let rec = Color(red: 0.851, green: 0.176, blue: 0.125)

    static let mono = Font.system(.body, design: .monospaced)
}
