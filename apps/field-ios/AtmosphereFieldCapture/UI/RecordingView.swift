import AVFoundation
import SwiftUI
import UIKit

struct RecordingView: View {
    @EnvironmentObject private var session: FieldDaySession
    @EnvironmentObject private var api: AtmosphereClient
    @State private var holding = false
    @State private var finishing = false

    var body: some View {
        ZStack {
            CameraPreviewHost(layer: session.recorder.previewLayer)
                .equatable()
                .ignoresSafeArea()

            RecordingOverlay(
                elapsedSeconds: session.recorder.elapsedSeconds,
                siteLabel: session.locator.siteLabel,
                holding: holding,
                finishing: finishing,
                onHoldChanged: handleHoldChanged,
                onFinish: finishRecording
            )
        }
        .onReceive(Timer.publish(every: 0.5, on: .main, in: .common).autoconnect()) { _ in
            session.tickFromRecorder()
        }
    }

    private func handleHoldChanged(_ pressing: Bool) {
        guard !finishing else { return }
        holding = pressing
    }

    private func finishRecording() {
        guard !finishing, session.recorder.isRecording else { return }
        finishing = true
        Task {
            await session.finishDay(api: api)
            finishing = false
            holding = false
        }
    }
}

/// Timer and controls live here so the camera preview view does not re-render every tick.
private struct RecordingOverlay: View {
    let elapsedSeconds: Int
    let siteLabel: String
    let holding: Bool
    let finishing: Bool
    let onHoldChanged: (Bool) -> Void
    let onFinish: () -> Void

    var body: some View {
        VStack {
            HStack {
                Circle()
                    .fill(FieldTheme.rec)
                    .frame(width: 8, height: 8)
                Text("RECORDING THE DAY")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(.white)
                Spacer()
                Text(formatClock(elapsedSeconds))
                    .font(FieldTheme.mono)
                    .foregroundStyle(.white)
            }
            .padding(12)
            .background(.black.opacity(0.45))

            Spacer()

            VStack(spacing: 10) {
                Text(formatClock(elapsedSeconds))
                    .font(.system(size: 44, weight: .semibold, design: .monospaced))
                    .foregroundStyle(.white)
                Text(siteLabel)
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

    private var holdToFinish: some View {
        Text(buttonLabel)
            .font(.system(size: 16, weight: .bold))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 18)
            .background(holding || finishing ? FieldTheme.accent : FieldTheme.ink)
            .foregroundStyle(.white)
            .cornerRadius(12)
            .contentShape(Rectangle())
            .onLongPressGesture(
                minimumDuration: 1.2,
                maximumDistance: 60,
                pressing: { pressing in
                    onHoldChanged(pressing)
                },
                perform: {
                    onFinish()
                }
            )
    }

    private var buttonLabel: String {
        if finishing { return "Finishing the day…" }
        if holding { return "Keep holding…" }
        return "Hold to finish the day"
    }

    private func formatClock(_ sec: Int) -> String {
        let h = sec / 3600
        let m = (sec % 3600) / 60
        let s = sec % 60
        if h > 0 { return String(format: "%d:%02d:%02d", h, m, s) }
        return String(format: "%d:%02d", m, s)
    }
}

/// Isolates the preview from timer-driven overlay updates.
private struct CameraPreviewHost: View, Equatable {
    let layer: AVCaptureVideoPreviewLayer?

    static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.layer === rhs.layer
    }

    var body: some View {
        CameraPreviewRepresentable(layer: layer)
    }
}

/// Stable camera preview that keeps the layer attached and sizes it on layout.
private struct CameraPreviewRepresentable: UIViewRepresentable, Equatable {
    let layer: AVCaptureVideoPreviewLayer?

    static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.layer === rhs.layer
    }

    func makeUIView(context: Context) -> CameraPreviewUIView {
        let view = CameraPreviewUIView()
        view.previewLayer = layer
        return view
    }

    func updateUIView(_ uiView: CameraPreviewUIView, context: Context) {
        if uiView.previewLayer !== layer {
            uiView.previewLayer = layer
        }
    }
}

private final class CameraPreviewUIView: UIView {
    var previewLayer: AVCaptureVideoPreviewLayer? {
        didSet {
            guard previewLayer !== oldValue else { return }
            oldValue?.removeFromSuperlayer()
            if let previewLayer {
                previewLayer.videoGravity = .resizeAspectFill
                if let connection = previewLayer.connection, connection.isVideoOrientationSupported {
                    connection.videoOrientation = .portrait
                }
                layer.insertSublayer(previewLayer, at: 0)
            }
            setNeedsLayout()
        }
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        previewLayer?.frame = bounds
    }
}
