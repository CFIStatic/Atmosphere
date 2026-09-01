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
    let status: String?
    let filmed: Bool?

    init(
        id: String,
        number: String,
        name: String,
        address: String,
        at: String,
        placed: Bool,
        status: String? = nil,
        filmed: Bool? = nil
    ) {
        self.id = id
        self.number = number
        self.name = name
        self.address = address
        self.at = at
        self.placed = placed
        self.status = status
        self.filmed = filmed
    }
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

func formatClipLength(_ seconds: Double) -> String {
    guard seconds.isFinite, seconds > 0 else { return "—" }
    let total = Int(seconds.rounded())
    let hours = total / 3600
    let minutes = (total % 3600) / 60
    let rest = total % 60
    var parts: [String] = []
    if hours > 0 { parts.append(hours == 1 ? "1 hour" : "\(hours) hours") }
    if minutes > 0 { parts.append(minutes == 1 ? "1 minute" : "\(minutes) minutes") }
    if hours == 0 && minutes == 0 {
        parts.append(rest == 1 ? "1 second" : "\(rest) seconds")
    } else if hours == 0 && rest > 0 {
        parts.append(rest == 1 ? "1 second" : "\(rest) seconds")
    }
    return parts.joined(separator: " ")
}
