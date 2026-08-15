import SwiftUI

/**
 * The ONLY Atmosphere brand mark: five bars (four ink, one orange base).
 * Same geometry as web Logo.tsx / marketing site favicon.
 */
struct AtmosphereBarsMark: View {
    var size: CGFloat = 22
    @Environment(\.colorScheme) private var colorScheme

    private let barHeightRatio: CGFloat = 2.8 / 22
    private let stepRatio: CGFloat = 4.8 / 22

    var body: some View {
        Canvas { context, canvasSize in
            let w = canvasSize.width
            let barH = canvasSize.height * barHeightRatio
            let step = canvasSize.height * stepRatio
            for (index, color) in FieldTheme.brandBars.enumerated() {
                let y = CGFloat(index) * step
                let rect = CGRect(x: 0, y: y, width: w, height: barH)
                context.fill(Path(rect), with: .color(color))
            }
        }
        .id(colorScheme)
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}
