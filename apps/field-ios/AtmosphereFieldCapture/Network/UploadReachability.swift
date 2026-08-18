import Foundation
import Network

/// Watches for a path so queued day films can file when the phone is back online.
@MainActor
final class UploadReachability: ObservableObject {
    @Published private(set) var isOnline = true

    private let monitor = NWPathMonitor()
    private let queue = DispatchQueue(label: "atmosphere.field.reachability")
    var onOnline: (() -> Void)?

    func start() {
        monitor.pathUpdateHandler = { [weak self] path in
            Task { @MainActor in
                guard let self else { return }
                let online = path.status == .satisfied
                let becameOnline = online && !self.isOnline
                self.isOnline = online
                if becameOnline {
                    self.onOnline?()
                }
            }
        }
        monitor.start(queue: queue)
    }
}
