import AVFoundation
import CoreLocation
import CoreMotion
import Foundation
import Network
import UIKit

/// Collects every Apple-allowed operational signal Field Capture can attest
/// while the day film rolls — organized into the same bundles the office portal shows.
@MainActor
final class FieldContextCollector: NSObject, ObservableObject {
    struct LocationSample: Encodable, Equatable {
        let recordedAt: String
        let lat: Double
        let lon: Double
        let accuracyM: Double?
        let altitudeM: Double?
        let altitudeAccuracyM: Double?
        let speedMps: Double?
        let courseDeg: Double?
        let floor: Int?
    }

    struct MotionSample: Encodable, Equatable {
        let recordedAt: String
        let activity: String?
        let confidence: Double?
        let pitchDeg: Double?
        let rollDeg: Double?
        let yawDeg: Double?
        let pressureHpa: Double?
        let relativeAltitudeM: Double?
        let stepCount: Int?
    }

    @Published private(set) var sessionId: String?
    @Published private(set) var lastAccuracyM: Double?

    private let iso = ISO8601DateFormatter()
    private let motionManager = CMMotionManager()
    private let altimeter = CMAltimeter()
    private let activityManager = CMMotionActivityManager()
    private let pedometer = CMPedometer()
    private let pathMonitor = NWPathMonitor()
    private let pathQueue = DispatchQueue(label: "com.atmosphere.field.path")

    private var pendingLocations: [LocationSample] = []
    private var pendingMotion: [MotionSample] = []
    private var networkType: String = "unknown"
    private var networkExpensive = false
    private var lastActivity: String?
    private var lastActivityConfidence: Double?
    private var lastPressureHpa: Double?
    private var lastRelativeAltitudeM: Double?
    private var stepCount: Int?
    private var heartbeatTask: Task<Void, Never>?
    private var recordingStartedAt: Date?

    func startCollecting() {
        UIDevice.current.isBatteryMonitoringEnabled = true
        pathMonitor.pathUpdateHandler = { [weak self] path in
            Task { @MainActor in
                self?.networkType = Self.describe(path: path)
                self?.networkExpensive = path.isExpensive
            }
        }
        pathMonitor.start(queue: pathQueue)

        if motionManager.isDeviceMotionAvailable {
            motionManager.deviceMotionUpdateInterval = 5
            motionManager.startDeviceMotionUpdates(using: .xMagneticNorthZVertical)
        }

        if CMAltimeter.isRelativeAltitudeAvailable() {
            altimeter.startRelativeAltitudeUpdates(to: .main) { [weak self] data, _ in
                guard let data else { return }
                Task { @MainActor in
                    self?.lastPressureHpa = data.pressure.doubleValue
                    self?.lastRelativeAltitudeM = data.relativeAltitude.doubleValue
                }
            }
        }

        if CMMotionActivityManager.isActivityAvailable() {
            activityManager.startActivityUpdates(to: .main) { [weak self] activity in
                guard let activity else { return }
                Task { @MainActor in
                    self?.lastActivity = Self.describe(activity: activity)
                    self?.lastActivityConfidence = Self.confidence(activity.confidence)
                }
            }
        }

        if CMPedometer.isStepCountingAvailable() {
            let start = Date()
            recordingStartedAt = start
            pedometer.startUpdates(from: start) { [weak self] data, _ in
                guard let data else { return }
                Task { @MainActor in
                    self?.stepCount = data.numberOfSteps.intValue
                }
            }
        }
    }

    func stopCollecting() {
        heartbeatTask?.cancel()
        heartbeatTask = nil
        pathMonitor.cancel()
        motionManager.stopDeviceMotionUpdates()
        altimeter.stopRelativeAltitudeUpdates()
        activityManager.stopActivityUpdates()
        pedometer.stopUpdates()
    }

    func noteLocation(_ location: CLLocation) {
        lastAccuracyM = location.horizontalAccuracy >= 0 ? location.horizontalAccuracy : nil
        let sample = LocationSample(
            recordedAt: iso.string(from: location.timestamp),
            lat: location.coordinate.latitude,
            lon: location.coordinate.longitude,
            accuracyM: location.horizontalAccuracy >= 0 ? location.horizontalAccuracy : nil,
            altitudeM: location.verticalAccuracy >= 0 ? location.altitude : nil,
            altitudeAccuracyM: location.verticalAccuracy >= 0 ? location.verticalAccuracy : nil,
            speedMps: location.speed >= 0 ? location.speed : nil,
            courseDeg: location.course >= 0 ? location.course : nil,
            floor: location.floor?.level
        )
        pendingLocations.append(sample)
        // Keep a short buffer if the network is down; heartbeat drains it.
        if pendingLocations.count > 180 {
            pendingLocations.removeFirst(pendingLocations.count - 180)
        }
        captureMotionSnapshot()
    }

    func snapshotBundles() -> (
        device: [String: Any],
        permissions: [String: Any],
        capabilities: [String: Any],
        environment: [String: Any]
    ) {
        (
            device: deviceBundle(),
            permissions: permissionsBundle(),
            capabilities: capabilitiesBundle(),
            environment: environmentBundle()
        )
    }

    func openSession(api: AtmosphereClient, jobId: String, workDate: String) async throws {
        let bundles = snapshotBundles()
        let response = try await api.startContextSession(
            jobId: jobId,
            workDate: workDate,
            appVersion: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String,
            device: bundles.device,
            permissions: bundles.permissions,
            capabilities: bundles.capabilities,
            environment: bundles.environment
        )
        sessionId = response.session.id
        startHeartbeatLoop(api: api)
    }

    func completeSession(
        api: AtmosphereClient,
        proofId: String?,
        capture: [String: Any]
    ) async {
        guard let sessionId else { return }
        heartbeatTask?.cancel()
        do {
            _ = try await flushHeartbeat(api: api)
            let locSummary = Self.summarize(locations: pendingLocations)
            let motionSummary = Self.summarize(motion: pendingMotion)
            let bundles = snapshotBundles()
            _ = try await api.completeContextSession(
                sessionId: sessionId,
                proofId: proofId,
                capture: capture,
                locationSummary: locSummary,
                motionSummary: motionSummary,
                device: bundles.device,
                permissions: bundles.permissions,
                capabilities: bundles.capabilities,
                environment: bundles.environment
            )
        } catch {
            /* best-effort — day film already filed */
        }
        stopCollecting()
    }

    func organizedDeviceContext(capture: [String: Any]) -> [String: Any] {
        let bundles = snapshotBundles()
        return [
            "platform": "ios",
            "contextSessionId": sessionId as Any,
            "device": bundles.device,
            "permissions": bundles.permissions,
            "capabilities": bundles.capabilities,
            "environment": bundles.environment,
            "capture": capture,
            "locationSummary": Self.summarize(locations: pendingLocations),
            "motionSummary": Self.summarize(motion: pendingMotion),
        ]
    }

    // MARK: - Heartbeat

    private func startHeartbeatLoop(api: AtmosphereClient) {
        heartbeatTask?.cancel()
        heartbeatTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 25_000_000_000)
                guard let self, !Task.isCancelled else { return }
                _ = try? await self.flushHeartbeat(api: api)
            }
        }
    }

    @discardableResult
    private func flushHeartbeat(api: AtmosphereClient) async throws -> Bool {
        guard let sessionId else { return false }
        captureMotionSnapshot()
        let locations = pendingLocations
        let motion = pendingMotion
        pendingLocations.removeAll()
        pendingMotion.removeAll()
        let bundles = snapshotBundles()
        _ = try await api.contextHeartbeat(
            sessionId: sessionId,
            device: bundles.device,
            permissions: bundles.permissions,
            capabilities: bundles.capabilities,
            environment: bundles.environment,
            locations: locations,
            motion: motion
        )
        return true
    }

    private func captureMotionSnapshot() {
        var pitch: Double?
        var roll: Double?
        var yaw: Double?
        if let attitude = motionManager.deviceMotion?.attitude {
            pitch = attitude.pitch * 180 / .pi
            roll = attitude.roll * 180 / .pi
            yaw = attitude.yaw * 180 / .pi
        }
        let sample = MotionSample(
            recordedAt: iso.string(from: Date()),
            activity: lastActivity,
            confidence: lastActivityConfidence,
            pitchDeg: pitch,
            rollDeg: roll,
            yawDeg: yaw,
            pressureHpa: lastPressureHpa,
            relativeAltitudeM: lastRelativeAltitudeM,
            stepCount: stepCount
        )
        // Only keep meaningful ticks (activity or sensors present).
        if sample.activity != nil
            || sample.pressureHpa != nil
            || sample.pitchDeg != nil
            || sample.stepCount != nil
        {
            pendingMotion.append(sample)
            if pendingMotion.count > 180 {
                pendingMotion.removeFirst(pendingMotion.count - 180)
            }
        }
    }

    // MARK: - Bundles

    private func deviceBundle() -> [String: Any] {
        let device = UIDevice.current
        let screen = UIScreen.main.bounds
        var out: [String: Any] = [
            "model": device.model,
            "modelIdentifier": Self.modelIdentifier(),
            "systemName": device.systemName,
            "systemVersion": device.systemVersion,
            "appVersion": Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "",
            "buildNumber": Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "",
            "bundleId": Bundle.main.bundleIdentifier ?? "",
            "locale": Locale.current.identifier,
            "region": Locale.current.region?.identifier ?? "",
            "timeZone": TimeZone.current.identifier,
            "screenWidth": Int(screen.width),
            "screenHeight": Int(screen.height),
            "screenScale": UIScreen.main.scale,
        ]
        if let idfv = device.identifierForVendor?.uuidString {
            out["identifierForVendor"] = idfv
        }
        return out
    }

    private func permissionsBundle() -> [String: Any] {
        [
            "camera": Self.authLabel(AVCaptureDevice.authorizationStatus(for: .video)),
            "microphone": Self.authLabel(AVCaptureDevice.authorizationStatus(for: .audio)),
            "locationWhenInUse": Self.locationLabel(CLLocationManager().authorizationStatus),
            "motion": CMMotionActivityManager.isActivityAvailable() ? "available" : "unavailable",
        ]
    }

    private func capabilitiesBundle() -> [String: Any] {
        let devices = AVCaptureDevice.DiscoverySession(
            deviceTypes: [.builtInWideAngleCamera, .builtInUltraWideCamera, .builtInTelephotoCamera, .builtInLiDARDepthCamera],
            mediaType: .video,
            position: .unspecified
        ).devices.map { device -> [String: Any] in
            [
                "position": Self.positionLabel(device.position),
                "uniqueId": device.uniqueID,
                "localizedName": device.localizedName,
                "hasTorch": device.hasTorch,
            ]
        }
        return [
            "lidarAvailable": AVCaptureDevice.default(.builtInLiDARDepthCamera, for: .video, position: .back) != nil,
            "roomPlanAvailable": true,
            "barometerAvailable": CMAltimeter.isRelativeAltitudeAvailable(),
            "pedometerAvailable": CMPedometer.isStepCountingAvailable(),
            "activityAvailable": CMMotionActivityManager.isActivityAvailable(),
            "cameraDevices": devices,
        ]
    }

    private func environmentBundle() -> [String: Any] {
        let device = UIDevice.current
        let battery = device.batteryLevel
        var diskFree: Int64?
        var diskTotal: Int64?
        if let attrs = try? FileManager.default.attributesOfFileSystem(
            forPath: NSHomeDirectory()
        ) {
            diskFree = (attrs[.systemFreeSize] as? NSNumber)?.int64Value
            diskTotal = (attrs[.systemSize] as? NSNumber)?.int64Value
        }
        var out: [String: Any] = [
            "batteryState": Self.batteryLabel(device.batteryState),
            "lowPowerMode": ProcessInfo.processInfo.isLowPowerModeEnabled,
            "thermalState": Self.thermalLabel(ProcessInfo.processInfo.thermalState),
            "networkType": networkType,
            "networkExpensive": networkExpensive,
        ]
        if battery >= 0 { out["batteryLevel"] = Double(battery) }
        if let diskFree { out["diskFreeBytes"] = diskFree }
        if let diskTotal { out["diskTotalBytes"] = diskTotal }
        return out
    }

    // MARK: - Helpers

    private static func summarize(locations: [LocationSample]) -> [String: Any] {
        guard let first = locations.first, let last = locations.last else {
            return ["sampleCount": 0]
        }
        let accuracies = locations.compactMap(\.accuracyM)
        var out: [String: Any] = [
            "sampleCount": locations.count,
            "firstAt": first.recordedAt,
            "lastAt": last.recordedAt,
            "startLat": first.lat,
            "startLon": first.lon,
            "endLat": last.lat,
            "endLon": last.lon,
        ]
        if let best = accuracies.min() { out["bestAccuracyM"] = best }
        if let worst = accuracies.max() { out["worstAccuracyM"] = worst }
        return out
    }

    private static func summarize(motion: [MotionSample]) -> [String: Any] {
        guard !motion.isEmpty else { return ["sampleCount": 0] }
        var counts: [String: Int] = [:]
        var steps: Int?
        var pressures: [Double] = []
        for sample in motion {
            if let activity = sample.activity {
                counts[activity, default: 0] += 1
            }
            if let stepCount = sample.stepCount {
                steps = max(steps ?? 0, stepCount)
            }
            if let pressure = sample.pressureHpa {
                pressures.append(pressure)
            }
        }
        var out: [String: Any] = ["sampleCount": motion.count]
        if let dominant = counts.max(by: { $0.value < $1.value })?.key {
            out["dominantActivity"] = dominant
        }
        if let steps { out["stepCount"] = steps }
        if let minP = pressures.min() { out["pressureMinHpa"] = minP }
        if let maxP = pressures.max() { out["pressureMaxHpa"] = maxP }
        return out
    }

    private static func modelIdentifier() -> String {
        var systemInfo = utsname()
        uname(&systemInfo)
        return withUnsafePointer(to: &systemInfo.machine) {
            $0.withMemoryRebound(to: CChar.self, capacity: 1) {
                String(validatingUTF8: $0) ?? "unknown"
            }
        }
    }

    private static func authLabel(_ status: AVAuthorizationStatus) -> String {
        switch status {
        case .authorized: return "authorized"
        case .denied: return "denied"
        case .restricted: return "restricted"
        case .notDetermined: return "notDetermined"
        @unknown default: return "unknown"
        }
    }

    private static func locationLabel(_ status: CLAuthorizationStatus) -> String {
        switch status {
        case .authorizedAlways: return "authorizedAlways"
        case .authorizedWhenInUse: return "authorizedWhenInUse"
        case .denied: return "denied"
        case .restricted: return "restricted"
        case .notDetermined: return "notDetermined"
        @unknown default: return "unknown"
        }
    }

    private static func batteryLabel(_ state: UIDevice.BatteryState) -> String {
        switch state {
        case .charging: return "charging"
        case .full: return "full"
        case .unplugged: return "unplugged"
        case .unknown: return "unknown"
        @unknown default: return "unknown"
        }
    }

    private static func thermalLabel(_ state: ProcessInfo.ThermalState) -> String {
        switch state {
        case .nominal: return "nominal"
        case .fair: return "fair"
        case .serious: return "serious"
        case .critical: return "critical"
        @unknown default: return "unknown"
        }
    }

    private static func positionLabel(_ position: AVCaptureDevice.Position) -> String {
        switch position {
        case .back: return "back"
        case .front: return "front"
        case .unspecified: return "unspecified"
        @unknown default: return "unknown"
        }
    }

    private static func describe(path: NWPath) -> String {
        if path.usesInterfaceType(.wifi) { return "wifi" }
        if path.usesInterfaceType(.cellular) { return "cellular" }
        if path.usesInterfaceType(.wiredEthernet) { return "ethernet" }
        if path.status == .satisfied { return "other" }
        return "offline"
    }

    private static func describe(activity: CMMotionActivity) -> String {
        if activity.walking { return "walking" }
        if activity.running { return "running" }
        if activity.automotive { return "automotive" }
        if activity.cycling { return "cycling" }
        if activity.stationary { return "stationary" }
        return "unknown"
    }

    private static func confidence(_ value: CMMotionActivityConfidence) -> Double {
        switch value {
        case .low: return 0.33
        case .medium: return 0.66
        case .high: return 1.0
        @unknown default: return 0
        }
    }
}
