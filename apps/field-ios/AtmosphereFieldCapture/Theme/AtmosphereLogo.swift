import SwiftUI

/**
 * The real Atmosphere lockup: five-bar mark **beside** the wordmark.
 *
 * Matches website `.wordmark` / frontend `Logo.tsx` — never stack the bars
 * above the name.
 */
struct AtmosphereLogo: View {
    var markSize: CGFloat = 28
    var titleSize: CGFloat = 28
    /// Optional product line under the lockup (e.g. "Field Capture").
    var subtitle: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: subtitle == nil ? 0 : 4) {
            HStack(alignment: .center, spacing: 10) {
                AtmosphereBarsMark(size: markSize)
                Text("Atmosphere")
                    .font(.system(size: titleSize, weight: .bold))
                    .foregroundStyle(FieldTheme.ink)
                    .tracking(-0.4)
                    .lineLimit(1)
                    .minimumScaleFactor(0.85)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Atmosphere")

            if let subtitle {
                Text(subtitle)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(FieldTheme.muted)
            }
        }
    }
}
