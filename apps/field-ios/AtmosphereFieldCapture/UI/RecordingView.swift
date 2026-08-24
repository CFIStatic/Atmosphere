import AVFoundation
import SwiftUI
import UIKit

struct RecordingView: View {
    @EnvironmentObject private var session: FieldDaySession
    @EnvironmentObject private var api: AtmosphereClient
    /// GestureState so the label/fill can update without cancelling the press.
    /// `@State holding = true` used to rebuild the button and abort the hold
    /// before the timer fired — the recording never stopped.
    @GestureState private var pressing = false
    @State private var holdTask: Task<Void, Never>?

    private static let holdSeconds: Double = 5
    private static let holdNanos: UInt64 = 5_000_000_000

    var body: some View {
        ZStack {
            PreviewRepresentable(layer: session.recorder.previewLayer)
                .ignoresSafeArea()

            VStack {
                HStack {
                    Circle()
                        .fill(FieldTheme.rec)
                        .frame(width: 8, height: 8)
                    Text("RECORDING THE DAY")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(.white)
                    Spacer()
                    Text(formatClock(session.recorder.elapsedSeconds))
                        .font(FieldTheme.mono)
                        .foregroundStyle(.white)
                }
                .padding(12)
                .background(.black.opacity(0.45))

                Spacer()

                VStack(spacing: 10) {
                    Text(formatClock(session.recorder.elapsedSeconds))
                        .font(.system(size: 44, weight: .semibold, design: .monospaced))
                        .foregroundStyle(.white)
                    Text(session.locator.siteLabel)
                        .font(.system(size: 13))
                        .foregroundStyle(.white.opacity(0.9))
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(.black.opacity(0.4))
                        .cornerRadius(8)

                    Text("ON THE RECORD · video + audio")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(.white.opacity(0.85))
                }
                .padding(.bottom, 24)

                holdToFinish
                    .padding(.horizontal, 18)
                    .padding(.bottom, 28)
            }
        }
        .onReceive(Timer.publish(every: 0.5, on: .main, in: .common).autoconnect()) { _ in
            session.tickFromRecorder()
        }
    }

    private var holdToFinish: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 12)
                .fill(FieldTheme.ink)
            GeometryReader { geo in
                FieldTheme.rec
                    .frame(width: pressing ? geo.size.width : 0, height: geo.size.height)
                    .animation(.linear(duration: pressing ? Self.holdSeconds : 0), value: pressing)
            }
            .clipShape(RoundedRectangle(cornerRadius: 12))
            Text(pressing ? "Keep holding…" : "Hold 5 seconds to finish")
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 18)
        }
        .frame(maxWidth: .infinity)
        .frame(minHeight: 56)
        .contentShape(Rectangle())
        .gesture(
            DragGesture(minimumDistance: 0)
                .updating($pressing) { _, state, _ in
                    state = true
                }
        )
        // iOS 16 onChange(of:perform:) — do not use the iOS 17 two-parameter form.
        .onChange(of: pressing) { isPressing in
            holdTask?.cancel()
            holdTask = nil
            guard isPressing else { return }
            holdTask = Task {
                try? await Task.sleep(nanoseconds: Self.holdNanos)
                guard !Task.isCancelled else { return }
                await session.finishDay(api: api)
            }
        }
        .accessibilityAddTraits(.isButton)
        .accessibilityLabel("Hold 5 seconds to finish the day")
        .accessibilityHint("Keep holding for five seconds to stop recording.")
    }

    private func formatClock(_ sec: Int) -> String {
        let h = sec / 3600
        let m = (sec % 3600) / 60
        let s = sec % 60
        if h > 0 { return String(format: "%d:%02d:%02d", h, m, s) }
        return String(format: "%d:%02d", m, s)
    }
}

private struct PreviewRepresentable: UIViewRepresentable {
    let layer: AVCaptureVideoPreviewLayer?

    func makeUIView(context: Context) -> UIView {
        let view = UIView()
        view.backgroundColor = .black
        return view
    }

    func updateUIView(_ uiView: UIView, context: Context) {
        uiView.layer.sublayers?.filter { $0 is AVCaptureVideoPreviewLayer }.forEach { $0.removeFromSuperlayer() }
        guard let layer else { return }
        layer.frame = uiView.bounds
        uiView.layer.addSublayer(layer)
    }
}
