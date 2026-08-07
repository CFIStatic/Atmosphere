import Foundation

#if canImport(RoomPlan)
import RoomPlan
import RealityKit
#endif

/**
 * On-device room measurement for the property digital twin.
 *
 * When RoomPlan is unavailable (simulator / older device), returns an empty
 * room list so video evidence can still upload; twin stays needs_review.
 */
@MainActor
final class RoomPlanBridge: ObservableObject {
    @Published private(set) var rooms: [AtmosphereClient.IngestBody.RoomPayload] = []
    @Published private(set) var meshLocalURL: URL?
    @Published private(set) var lidarAvailable: Bool = false

    func detectCapabilities() {
        #if canImport(RoomPlan)
        lidarAvailable = true
        #else
        lidarAvailable = false
        #endif
    }

    /// Run a short RoomPlan pass after (or alongside) the day — product may
    /// later overlap this with filming; foundation keeps it sequential.
    func captureRooms() async {
        detectCapabilities()
        #if canImport(RoomPlan)
        // Integration point: present RoomCaptureViewController from UIKit
        // host and map CapturedRoom → RoomPayload + USDZ export URL.
        // Until the UIKit host is wired in Xcode, leave rooms empty so the
        // upload path still completes with video + hasAudio.
        rooms = []
        meshLocalURL = nil
        #else
        rooms = []
        meshLocalURL = nil
        #endif
    }

    func asIngestRooms() -> [AtmosphereClient.IngestBody.RoomPayload] {
        rooms
    }
}
