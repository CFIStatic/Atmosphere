import AVFoundation
import CoreLocation

enum CapturePermissions {
    static func requestCamera() async throws -> Bool {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: return true
        case .notDetermined:
            return await AVCaptureDevice.requestAccess(for: .video)
        default: return false
        }
    }

    static func requestMicrophone() async throws -> Bool {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: return true
        case .notDetermined:
            return await AVCaptureDevice.requestAccess(for: .audio)
        default: return false
        }
    }

    /// Prompts for location when needed; recording can continue if the user declines.
    static func requestLocation() async -> Bool {
        let status = CLLocationManager.authorizationStatus()
        switch status {
        case .authorizedAlways, .authorizedWhenInUse:
            return true
        case .notDetermined:
            return await withCheckedContinuation { cont in
                LocationPermissionRequester.shared.request { granted in
                    cont.resume(returning: granted)
                }
            }
        default:
            return false
        }
    }

    static func missingPermissionsMessage(camera: Bool, microphone: Bool) -> String? {
        switch (camera, microphone) {
        case (false, false):
            return "Camera and microphone access are required. Open Settings → Field Capture and allow both."
        case (false, true):
            return "Camera access is required. Open Settings → Field Capture and allow Camera."
        case (true, false):
            return "Microphone access is required. Open Settings → Field Capture and allow Microphone."
        case (true, true):
            return nil
        }
    }
}

/// One-shot helper so we can await the location permission dialog.
private final class LocationPermissionRequester: NSObject, CLLocationManagerDelegate {
    static let shared = LocationPermissionRequester()

    private let manager = CLLocationManager()
    private var completion: ((Bool) -> Void)?

    private override init() {
        super.init()
        manager.delegate = self
    }

    func request(completion: @escaping (Bool) -> Void) {
        let status = manager.authorizationStatus
        if status != .notDetermined {
            completion(status == .authorizedAlways || status == .authorizedWhenInUse)
            return
        }
        self.completion = completion
        manager.requestWhenInUseAuthorization()
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        guard let completion else { return }
        let status = manager.authorizationStatus
        guard status != .notDetermined else { return }
        self.completion = nil
        switch status {
        case .authorizedAlways, .authorizedWhenInUse:
            completion(true)
        default:
            completion(false)
        }
    }

    // iOS 16 delegate name
    func locationManager(
        _ manager: CLLocationManager,
        didChangeAuthorization status: CLAuthorizationStatus
    ) {
        locationManagerDidChangeAuthorization(manager)
    }
}
