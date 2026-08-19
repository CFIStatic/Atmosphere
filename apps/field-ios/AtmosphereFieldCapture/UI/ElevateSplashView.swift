import SwiftUI

/**
 * Connect → Today. Orange ground first, the four ink bars stack upward
 * like atmosphere, a short whoosh lifts the mark, then the veil drops
 * onto Today. Same motion as Field Capture on the web.
 */
struct ElevateSplashView: View {
    var onFinished: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var barOn = [false, false, false, false, false]
    @State private var wordOn = false
    @State private var lift = false
    @State private var whooshY: CGFloat = 36
    @State private var whooshOpacity: Double = 0
    @State private var veil: Double = 1

    private let colors: [Color] = [
        Color(red: 0.659, green: 0.635, blue: 0.620),
        Color(red: 0.471, green: 0.443, blue: 0.424),
        Color(red: 0.341, green: 0.325, blue: 0.306),
        Color(red: 0.161, green: 0.145, blue: 0.141),
        Color(red: 0.949, green: 0.404, blue: 0.047),
    ]

    var body: some View {
        ZStack {
            FieldTheme.bg.ignoresSafeArea()

            LinearGradient(
                colors: [
                    .clear,
                    Color(red: 0.949, green: 0.404, blue: 0.047).opacity(0.7),
                    .clear,
                ],
                startPoint: .bottom,
                endPoint: .top
            )
            .frame(width: 12, height: 140)
            .blur(radius: 6)
            .offset(y: whooshY)
            .opacity(whooshOpacity)
            .allowsHitTesting(false)

            VStack(spacing: 16) {
                VStack(spacing: 64 * 2 / 22) {
                    ForEach(0 ..< 5, id: \.self) { index in
                        RoundedRectangle(cornerRadius: 1)
                            .fill(colors[index])
                            .frame(width: 64, height: 64 * 2.8 / 22)
                            .scaleEffect(x: barOn[index] ? 1 : 0.22, y: 1, anchor: .bottom)
                            .opacity(barOn[index] ? 1 : 0)
                            .offset(y: barOn[index] ? 0 : 16)
                    }
                }
                .frame(width: 64, height: 64)

                Text("Atmosphere")
                    .font(.system(size: 22, weight: .bold))
                    .tracking(-0.4)
                    .foregroundStyle(FieldTheme.ink)
                    .opacity(wordOn ? 1 : 0)
                    .offset(y: wordOn ? 0 : 8)
            }
            .offset(y: lift ? -10 : 8)
        }
        .opacity(veil)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Connected")
        .onAppear { run() }
    }

    private func run() {
        Task { @MainActor in
            if reduceMotion {
                barOn = Array(repeating: true, count: 5)
                wordOn = true
                lift = true
                try? await Task.sleep(nanoseconds: 280_000_000)
                veil = 0
                try? await Task.sleep(nanoseconds: 200_000_000)
                onFinished()
                return
            }

            let spring = Animation.timingCurve(0.16, 1, 0.3, 1, duration: 0.52)
            // Orange ground first (index 4), then up the stack.
            for (step, index) in [4, 3, 2, 1, 0].enumerated() {
                try? await Task.sleep(nanoseconds: UInt64(step == 0 ? 40_000_000 : 90_000_000))
                withAnimation(spring) {
                    barOn[index] = true
                }
            }

            try? await Task.sleep(nanoseconds: 80_000_000)
            withAnimation(.easeOut(duration: 0.18)) {
                whooshOpacity = 0.5
            }
            withAnimation(.easeOut(duration: 0.7)) {
                whooshY = -88
                whooshOpacity = 0
            }
            withAnimation(.easeOut(duration: 0.5)) {
                wordOn = true
            }
            withAnimation(.timingCurve(0.16, 1, 0.3, 1, duration: 1.15)) {
                lift = true
            }

            try? await Task.sleep(nanoseconds: 900_000_000)
            withAnimation(.easeInOut(duration: 0.42)) {
                veil = 0
            }
            try? await Task.sleep(nanoseconds: 420_000_000)
            onFinished()
        }
    }
}
