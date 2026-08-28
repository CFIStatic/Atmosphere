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
            CameraPreview(session: session.recorder.captureSession)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .ignoresSafeArea()
                .accessibilityLabel("Live camera — what is being recorded")

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
                }
                .padding(.bottom, 24)

                holdToFinish
                    .padding(.horizontal, 18)
                    .padding(.bottom, 28)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.black.ignoresSafeArea())
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

/// Live rear-camera finder. The preview *is* this view's layer so SwiftUI
/// layout always sizes it — the old path added a zero-frame sublayer and
/// ripped it out on every clock tick, which left a black rectangle.
struct CameraPreview: UIViewRepresentable {
    let session: AVCaptureSession

    func makeUIView(context: Context) -> CameraPreviewView {
        let view = CameraPreviewView()
        view.session = session
        return view
    }

    func updateUIView(_ uiView: CameraPreviewView, context: Context) {
        if uiView.previewLayer.session !== session {
            uiView.session = session
        } else {
            uiView.syncVideoOrientation()
        }
    }
}

final class CameraPreviewView: UIView {
    override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }

    var previewLayer: AVCaptureVideoPreviewLayer {
        layer as! AVCaptureVideoPreviewLayer
    }

    var session: AVCaptureSession? {
        get { previewLayer.session }
        set {
            previewLayer.session = newValue
            previewLayer.videoGravity = .resizeAspectFill
            syncVideoOrientation()
        }
    }

    override init(frame: CGRect) {
        super.init(frame: frame)
        isOpaque = true
        backgroundColor = .black
        clipsToBounds = true
        previewLayer.videoGravity = .resizeAspectFill
        previewLayer.masksToBounds = true
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        isOpaque = true
        backgroundColor = .black
        clipsToBounds = true
        previewLayer.videoGravity = .resizeAspectFill
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        syncVideoOrientation()
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        syncVideoOrientation()
    }

    func syncVideoOrientation() {
        guard let connection = previewLayer.connection else { return }
        let orientation = window?.windowScene?.interfaceOrientation ?? .portrait
        if #available(iOS 17.0, *) {
            let angle = Self.rotationAngle(for: orientation)
            if connection.isVideoRotationAngleSupported(angle) {
                connection.videoRotationAngle = angle
            }
        } else if connection.isVideoOrientationSupported {
            connection.videoOrientation = Self.videoOrientation(for: orientation)
        }
    }

    static func rotationAngle(for orientation: UIInterfaceOrientation) -> CGFloat {
        switch orientation {
        case .landscapeLeft: return 0
        case .landscapeRight: return 180
        case .portraitUpsideDown: return 270
        default: return 90
        }
    }

    static func videoOrientation(for orientation: UIInterfaceOrientation) -> AVCaptureVideoOrientation {
        switch orientation {
        case .landscapeLeft: return .landscapeLeft
        case .landscapeRight: return .landscapeRight
        case .portraitUpsideDown: return .portraitUpsideDown
        default: return .portrait
        }
    }
}
