import SwiftUI
import UIKit

/// Paper / ink / terracotta — same tokens as web Field Capture + Verifier.
/// Colors resolve from the device light / dark appearance. Do not force a scheme.
enum FieldTheme {
    static let bg = adaptive(
        light: UIColor(red: 0.984, green: 0.980, blue: 0.969, alpha: 1), // #FBFAF7
        dark: UIColor(red: 0.078, green: 0.071, blue: 0.063, alpha: 1) // #141210
    )
    static let panel = adaptive(
        light: .white,
        dark: UIColor(red: 0.145, green: 0.133, blue: 0.122, alpha: 1) // #25201F
    )
    static let ink = adaptive(
        light: UIColor(red: 0.110, green: 0.098, blue: 0.090, alpha: 1), // #1C1917
        dark: UIColor(red: 0.957, green: 0.941, blue: 0.910, alpha: 1) // #F4F0E8
    )
    static let muted = adaptive(
        light: UIColor(red: 0.341, green: 0.325, blue: 0.306, alpha: 1), // #57534E
        dark: UIColor(red: 0.659, green: 0.635, blue: 0.620, alpha: 1) // #A8A29E
    )
    static let faint = adaptive(
        light: UIColor(red: 0.659, green: 0.635, blue: 0.620, alpha: 1), // #A8A29E
        dark: UIColor(red: 0.471, green: 0.443, blue: 0.424, alpha: 1) // #78716C
    )
    static let line = adaptive(
        light: UIColor(red: 0.890, green: 0.871, blue: 0.831, alpha: 1), // #E3DED4
        dark: UIColor(red: 0.267, green: 0.247, blue: 0.227, alpha: 1) // #443F3A
    )
    static let accent = adaptive(
        light: UIColor(red: 0.737, green: 0.271, blue: 0.031, alpha: 1), // #BC4508
        dark: UIColor(red: 0.949, green: 0.431, blue: 0.133, alpha: 1) // #F26E22
    )
    static let pass = adaptive(
        light: UIColor(red: 0.247, green: 0.490, blue: 0.298, alpha: 1), // #3F7D4C
        dark: UIColor(red: 0.486, green: 0.788, blue: 0.553, alpha: 1) // #7CC98D
    )
    static let rec = adaptive(
        light: UIColor(red: 0.851, green: 0.176, blue: 0.125, alpha: 1), // #D92D20
        dark: UIColor(red: 0.941, green: 0.478, blue: 0.384, alpha: 1) // #F07A62
    )
    static let passWash = adaptive(
        light: UIColor(red: 0.941, green: 0.969, blue: 0.945, alpha: 1), // #F0F7F1
        dark: UIColor(red: 0.071, green: 0.149, blue: 0.102, alpha: 1) // #12261A
    )

    /// Five-bar mark: ink ramp + orange base, inverted so it still reads on dark paper.
    static let brandBars: [Color] = [
        adaptive(
            light: UIColor(red: 0.659, green: 0.635, blue: 0.620, alpha: 0.95),
            dark: UIColor(red: 0.471, green: 0.443, blue: 0.424, alpha: 1)
        ),
        adaptive(
            light: UIColor(red: 0.471, green: 0.443, blue: 0.424, alpha: 1),
            dark: UIColor(red: 0.659, green: 0.635, blue: 0.620, alpha: 1)
        ),
        adaptive(
            light: UIColor(red: 0.341, green: 0.325, blue: 0.306, alpha: 1),
            dark: UIColor(red: 0.839, green: 0.827, blue: 0.812, alpha: 1)
        ),
        adaptive(
            light: UIColor(red: 0.161, green: 0.145, blue: 0.141, alpha: 1),
            dark: UIColor(red: 0.929, green: 0.914, blue: 0.890, alpha: 1)
        ),
        adaptive(
            light: UIColor(red: 0.949, green: 0.404, blue: 0.047, alpha: 1),
            dark: UIColor(red: 0.949, green: 0.404, blue: 0.047, alpha: 1)
        ),
    ]

    static let mono = Font.system(.body, design: .monospaced)

    private static func adaptive(light: UIColor, dark: UIColor) -> Color {
        Color(uiColor: UIColor { traits in
            traits.userInterfaceStyle == .dark ? dark : light
        })
    }
}
