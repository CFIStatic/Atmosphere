import SwiftUI

/**
 * The ONLY Atmosphere brand mark: five bars (four ink, one orange base).
 * Same geometry as web Logo.tsx / marketing site favicon.
 */
struct AtmosphereBarsMark: View {
    var size: CGFloat = 22

    private let barHeightRatio: CGFloat = 2.8 / 22
    private let stepRatio: CGFloat = 4.8 / 22
    private let colors: [Color] = [
        Color(red: 0.659, green: 0.635, blue: 0.620).opacity(0.95), // #A8A29E
        Color(red: 0.471, green: 0.443, blue: 0.424),               // #78716C
        Color(red: 0.341, green: 0.325, blue: 0.306),               // #57534E
        Color(red: 0.161, green: 0.145, blue: 0.141),               // #292524
        Color(red: 0.949, green: 0.404, blue: 0.047),               // #F2670C
    ]

    var body: some View {
        Canvas { context, canvasSize in
            let w = canvasSize.width
            let barH = canvasSize.height * barHeightRatio
            let step = canvasSize.height * stepRatio
            for (index, color) in colors.enumerated() {
                let y = CGFloat(index) * step
                let rect = CGRect(x: 0, y: y, width: w, height: barH)
                context.fill(Path(rect), with: .color(color))
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}
