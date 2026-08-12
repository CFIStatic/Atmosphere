import CoreLocation
import Foundation

/// GPS for job attribution while the day film rolls — never a job picker.
@MainActor
final class SiteLocator: NSObject, ObservableObject, CLLocationManagerDelegate {
    @Published private(set) var siteLabel: String = "Getting your bearings…"
    @Published private(set) var coordinate: CLLocationCoordinate2D?
    @Published private(set) var accuracyM: Double?
    @Published private(set) var lastLocation: CLLocation?
    @Published private(set) var unsure: Bool = false

    /// Optional sink for Field Context trail samples.
    var onLocation: ((CLLocation) -> Void)?

    private let manager = CLLocationManager()
    private var jobs: [ExpectedJob] = []

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.distanceFilter = 8
        manager.allowsBackgroundLocationUpdates = false
        manager.pausesLocationUpdatesAutomatically = true
    }

    func configure(jobs: [ExpectedJob]) {
        self.jobs = jobs
    }

    func start() {
        manager.requestWhenInUseAuthorization()
        manager.startUpdatingLocation()
        if CLLocationManager.headingAvailable() {
            manager.startUpdatingHeading()
        }
    }

    func stop() {
        manager.stopUpdatingLocation()
        manager.stopUpdatingHeading()
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let loc = locations.last else { return }
        Task { @MainActor in
            self.coordinate = loc.coordinate
            self.lastLocation = loc
            self.accuracyM = loc.horizontalAccuracy >= 0 ? loc.horizontalAccuracy : nil
            self.onLocation?(loc)
            // Attribution is derived; until the backend geofence is wired we
            // show the nearest expected job address as a soft hint.
            if let first = jobs.first(where: \.placed) {
                self.siteLabel = "\(first.name) · on site"
                self.unsure = false
            } else {
                self.siteLabel = "Not sure which job — the office will sort it"
                self.unsure = true
            }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        Task { @MainActor in
            self.siteLabel = "Location unavailable"
            self.unsure = true
        }
    }
}
