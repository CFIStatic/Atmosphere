import AVFoundation
import SwiftUI
import UIKit

struct RecordingView: View {
    @EnvironmentObject private var session: FieldDaySession
    @EnvironmentObject private var api: AtmosphereClient
    @State private var holding = false
    @State private var holdTask: Task<Void, Never>?

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
        Text(holding ? "Keep holding…" : "Hold to finish the day")
            .font(.system(size: 16, weight: .bold))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 18)
            .background(holding ? FieldTheme.accent : FieldTheme.ink)
            .foregroundStyle(.white)
            .cornerRadius(12)
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { _ in
                        guard !holding else { return }
                        holding = true
                        holdTask = Task {
                            try? await Task.sleep(nanoseconds: 1_500_000_000)
                            guard !Task.isCancelled else { return }
                            await session.finishDay(api: api)
                        }
                    }
                    .onEnded { _ in
                        holding = false
                        holdTask?.cancel()
                        holdTask = nil
                    }
            )
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
