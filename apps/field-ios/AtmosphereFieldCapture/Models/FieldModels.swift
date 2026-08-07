import Foundation

enum FieldPhase: Equatable {
    case today
    case recording
    case door
}

struct ExpectedJob: Identifiable, Equatable, Codable {
    let id: String
    let number: String
    let name: String
    let address: String
    let at: String
    let placed: Bool
}

struct TwinRoomSummary: Identifiable, Equatable {
    let id: String
    let name: String
    let detail: String
}

struct DoorCheck: Identifiable, Equatable {
    let id: String
    let label: String
    let detail: String
    let ok: Bool
}

/// Catalog attestation: day film is always audiovisual.
struct DayFilmManifest: Codable, Equatable {
    var mediaId: String?
    var sessionId: String?
    var twinId: String?
    var geometrySessionId: String?
    var videoRef: String?
    var durationSeconds: Double
    var byteSize: Int64?
    var contentType: String
    var hasAudio: Bool
    var hasVideo: Bool
    var capturedAt: Date
}
