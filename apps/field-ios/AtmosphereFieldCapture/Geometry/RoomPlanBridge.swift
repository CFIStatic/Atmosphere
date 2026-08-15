import Combine
import Foundation

#if canImport(RoomPlan)
import RoomPlan
import RealityKit
#endif

/**
 * On-device room measurement for the property digital twin.
 *
 * LiDAR iPhones present `RoomCaptureViewController` for a short, explicit
 * walk. This does **not** run in the background or under the day film —
 * RoomPlan needs the camera on screen and cannot share it with the MP4.
 * Simulator / older devices skip the pass so the day film still files.
 */
@MainActor
final class RoomPlanBridge: ObservableObject {
    @Published private(set) var rooms: [AtmosphereClient.IngestBody.RoomPayload] = []
    @Published private(set) var meshLocalURL: URL?
    @Published private(set) var lidarAvailable: Bool = false
    @Published var isPresentingCapture = false

    func detectCapabilities() {
        #if canImport(RoomPlan)
        if #available(iOS 16.0, *) {
            lidarAvailable = true
            return
        }
        #endif
        lidarAvailable = false
    }

    func beginCapture() {
        detectCapabilities()
        guard lidarAvailable else { return }
        isPresentingCapture = true
    }

    func applyCapture(rooms captured: [AtmosphereClient.IngestBody.RoomPayload], meshURL: URL?) {
        rooms = captured
        meshLocalURL = meshURL
        isPresentingCapture = false
    }

    func cancelCapture() {
        isPresentingCapture = false
    }

    func asIngestRooms() -> [AtmosphereClient.IngestBody.RoomPayload] {
        rooms
    }

    #if canImport(RoomPlan)
    @available(iOS 16.0, *)
    static func payloads(from room: CapturedRoom) -> [AtmosphereClient.IngestBody.RoomPayload] {
        let ft = 3.280839895
        let width = Double(room.dimensions.x) * ft
        let height = Double(room.dimensions.y) * ft
        let length = Double(room.dimensions.z) * ft
        return [
            AtmosphereClient.IngestBody.RoomPayload(
                name: "Scanned space",
                lengthFt: length,
                widthFt: width,
                heightFt: height,
                floorAreaSqFt: width * length,
                confidence: 0.8
            ),
        ]
    }
    #endif
}
