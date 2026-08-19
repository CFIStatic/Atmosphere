import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

/**
 * Connect → Today. Bars slam up from the orange ground, sit four seconds
 * on paper or night (system light / dark), then ease into Today.
 * Same motion as Field Capture on the web.
 */
struct ElevateSplashView: View {
    var onFinished: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var barOn = [false, false, false, false, false]
    @State private var wordOn = false
    @State private var subOn = false
    @State private var lift = false
    @State private var bloom: Double = 0
    @State private var bloomScale: CGFloat = 0.15
    @State private var whooshY: CGFloat = 70
    @State private var whooshOpacity: Double = 0
    @State private var veil: Double = 1
    @State private var groundGlow: Double = 0
    @State private var lockupOut: Double = 0

    private let ember = Color(red: 0.949, green: 0.404, blue: 0.047)
    private let paper = Color(red: 0.984, green: 0.980, blue: 0.969) // #FBFAF7
    private let night = Color(red: 0.078, green: 0.075, blue: 0.067) // #141311
    private let paperInk = Color(red: 0.110, green: 0.098, blue: 0.090)
    private let nightInk = Color(red: 0.945, green: 0.937, blue: 0.922)
    private let paperFaint = Color(red: 0.659, green: 0.635, blue: 0.620)
    private let nightFaint = Color(red: 0.420, green: 0.404, blue: 0.373)

    /// System appearance, not the app’s forced light scheme.
    private var isDark: Bool {
        #if canImport(UIKit)
        if UserDefaults.standard.string(forKey: "AppleInterfaceStyle") == "Dark" {
            return true
        }
        return UIScreen.main.traitCollection.userInterfaceStyle == .dark
        #else
        return false
        #endif
    }

    private var ground: Color { isDark ? night : paper }
    private var wordColor: Color { isDark ? nightInk : paperInk }
    private var subColor: Color { isDark ? nightFaint : paperFaint }

    private var barColors: [Color] {
        [
            Color(red: 0.769, green: 0.749, blue: 0.718),
            Color(red: 0.612, green: 0.584, blue: 0.549),
            Color(red: 0.435, green: 0.412, blue: 0.384),
            wordColor,
            ember,
        ]
    }

    var body: some View {
        ZStack {
            ground.ignoresSafeArea()

            Circle()
                .fill(
                    RadialGradient(
                        colors: [ember.opacity(0.75), ember.opacity(0.2), .clear],
                        center: .center,
                        startRadius: 4,
                        endRadius: 140
                    )
                )
                .frame(width: 320, height: 320)
                .blur(radius: 18)
                .scaleEffect(bloomScale)
                .opacity(bloom)
                .offset(y: 18)
                .allowsHitTesting(false)

            whooshStreak(width: 28, height: 340, blur: 14, x: 0)
            whooshStreak(width: 14, height: 280, blur: 7, x: -8)
            whooshStreak(width: 8, height: 220, blur: 5, x: 12)

            VStack(spacing: 14) {
                VStack(spacing: 120 * 2 / 22) {
                    ForEach(0 ..< 5, id: \.self) { index in
                        RoundedRectangle(cornerRadius: 2)
                            .fill(barColors[index])
                            .frame(width: 120, height: 120 * 2.8 / 22)
                            .shadow(
                                color: index == 4 ? ember.opacity(groundGlow) : .clear,
                                radius: index == 4 ? 18 : 0,
                                y: index == 4 ? 6 : 0
                            )
                            .scaleEffect(x: barOn[index] ? 1 : 0.06, y: 1, anchor: .bottom)
                            .opacity(barOn[index] ? 1 : 0)
                            .offset(y: barOn[index] ? 0 : 56)
                    }
                }
                .frame(width: 120, height: 120)

                Text("Atmosphere")
                    .font(.system(size: 30, weight: .bold))
                    .tracking(wordOn ? -0.4 : 6)
                    .foregroundStyle(wordColor)
                    .opacity(wordOn ? 1 : 0)
                    .offset(y: wordOn ? 0 : 14)

                Text("FIELD CAPTURE")
                    .font(.system(size: 12, weight: .semibold))
                    .tracking(3.2)
                    .foregroundStyle(subColor)
                    .opacity(subOn ? 1 : 0)
                    .offset(y: subOn ? 0 : 8)
            }
            .scaleEffect(lift ? 1 : 0.84)
            .offset(y: lift ? -18 : 28)
            .opacity(1 - lockupOut)
        }
        .opacity(veil)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Connected")
        .onAppear { run() }
    }

    private func whooshStreak(width: CGFloat, height: CGFloat, blur: CGFloat, x: CGFloat) -> some View {
        LinearGradient(
            colors: [.clear, ember, wordColor, .clear],
            startPoint: .bottom,
            endPoint: .top
        )
        .frame(width: width, height: height)
        .blur(radius: blur)
        .offset(x: x, y: whooshY)
        .opacity(whooshOpacity)
        .allowsHitTesting(false)
    }

    private func run() {
        Task { @MainActor in
            if reduceMotion {
                barOn = Array(repeating: true, count: 5)
                wordOn = true
                subOn = true
                lift = true
                try? await Task.sleep(nanoseconds: 4_000_000_000)
                withAnimation(.easeInOut(duration: 0.7)) {
                    lockupOut = 1
                }
                try? await Task.sleep(nanoseconds: 700_000_000)
                veil = 0
                onFinished()
                return
            }

            let started = Date()

            withAnimation(.easeOut(duration: 0.45)) {
                bloom = 0.9
                bloomScale = 0.7
                groundGlow = 0.7
            }
            withAnimation(.easeOut(duration: 1.55)) {
                bloomScale = 1.85
                bloom = 0
            }

            let slam = Animation.timingCurve(0.16, 1.35, 0.3, 1, duration: 0.72)
            for (step, index) in [4, 3, 2, 1, 0].enumerated() {
                try? await Task.sleep(nanoseconds: UInt64(step == 0 ? 30_000_000 : 160_000_000))
                withAnimation(slam) {
                    barOn[index] = true
                }
            }

            withAnimation(.easeOut(duration: 0.2)) {
                whooshOpacity = 0.85
            }
            withAnimation(.easeOut(duration: 1.0)) {
                whooshY = -160
                whooshOpacity = 0
            }
            withAnimation(.timingCurve(0.16, 1.15, 0.3, 1, duration: 1.4)) {
                lift = true
            }

            try? await Task.sleep(nanoseconds: 220_000_000)
            withAnimation(.timingCurve(0.16, 1, 0.3, 1, duration: 0.7)) {
                wordOn = true
            }
            withAnimation(.easeInOut(duration: 0.6)) {
                groundGlow = 0.25
            }
            try? await Task.sleep(nanoseconds: 260_000_000)
            withAnimation(.easeOut(duration: 0.55)) {
                subOn = true
            }

            let remaining = max(0, 4.0 - Date().timeIntervalSince(started))
            try? await Task.sleep(nanoseconds: UInt64(remaining * 1_000_000_000))
            withAnimation(.timingCurve(0.4, 0, 0.2, 1, duration: 1.8)) {
                lockupOut = 1
                groundGlow = 0
            }
            try? await Task.sleep(nanoseconds: 700_000_000)
            withAnimation(.timingCurve(0.4, 0, 0.2, 1, duration: 1.4)) {
                veil = 0
            }
            try? await Task.sleep(nanoseconds: 1_400_000_000)
            onFinished()
        }
    }
}
