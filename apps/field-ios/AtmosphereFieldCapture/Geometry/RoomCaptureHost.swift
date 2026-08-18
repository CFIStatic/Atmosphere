import SwiftUI
import UIKit

#if canImport(RoomPlan)
import RoomPlan
import RealityKit
#endif

/// UIKit host for `RoomCaptureViewController` (LiDAR iPhone, iOS 16+).
struct RoomCaptureHost: UIViewControllerRepresentable {
    var onComplete: ([AtmosphereClient.IngestBody.RoomPayload], URL?) -> Void
    var onCancel: () -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onComplete: onComplete, onCancel: onCancel)
    }

    func makeUIViewController(context: Context) -> UIViewController {
        #if canImport(RoomPlan)
        if #available(iOS 16.0, *) {
            let controller = RoomCaptureViewController()
            controller.delegate = context.coordinator
            return controller
        }
        #endif
        return UnavailableMeasureController(onCancel: onCancel)
    }

    func updateUIViewController(_ uiViewController: UIViewController, context: Context) {}

    final class Coordinator: NSObject {
        let onComplete: ([AtmosphereClient.IngestBody.RoomPayload], URL?) -> Void
        let onCancel: () -> Void

        init(
            onComplete: @escaping ([AtmosphereClient.IngestBody.RoomPayload], URL?) -> Void,
            onCancel: @escaping () -> Void
        ) {
            self.onComplete = onComplete
            self.onCancel = onCancel
        }
    }
}

#if canImport(RoomPlan)
@available(iOS 16.0, *)
extension RoomCaptureHost.Coordinator: RoomCaptureViewControllerDelegate {
    func captureViewController(
        _ viewController: RoomCaptureViewController,
        didPresent roomData: CapturedRoomData,
        error: Error?
    ) {
        if error != nil {
            onCancel()
            return
        }
        let room = roomData.room
        let payloads = RoomPlanBridge.payloads(from: room)
        let dest = FileManager.default.temporaryDirectory
            .appendingPathComponent("twin-\(UUID().uuidString).usdz")
        var meshURL: URL?
        do {
            try room.export(to: dest)
            meshURL = dest
        } catch {
            meshURL = nil
        }
        onComplete(payloads, meshURL)
    }
}
#endif

private final class UnavailableMeasureController: UIViewController {
    let onCancel: () -> Void

    init(onCancel: @escaping () -> Void) {
        self.onCancel = onCancel
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { nil }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        let button = UIButton(type: .system)
        button.setTitle("Measuring needs a LiDAR iPhone", for: .normal)
        button.addTarget(self, action: #selector(cancel), for: .touchUpInside)
        button.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(button)
        NSLayoutConstraint.activate([
            button.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            button.centerYAnchor.constraint(equalTo: view.centerYAnchor),
        ])
    }

    @objc private func cancel() { onCancel() }
}
