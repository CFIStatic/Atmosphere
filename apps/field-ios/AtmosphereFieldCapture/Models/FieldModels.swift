import Foundation

enum FieldPhase: Equatable {
    case today
    case recording
    case measuring
    case door
}

enum FieldTab: String, Equatable {
    case today
    case jobs
    case add
}

enum MeasureOffer: String, Equatable, Identifiable, Hashable {
    case beforeRecord
    case afterRecord

    var id: String { rawValue }
}

enum MeasureReturn: Equatable {
    case record
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
    let filmedOn: String?
    let assigned: Bool?
    let role: String?
    let workType: String?

    init(
        id: String,
        number: String,
        name: String,
        address: String,
        at: String,
        placed: Bool,
        status: String? = nil,
        filmed: Bool? = nil,
        filmedOn: String? = nil,
        assigned: Bool? = nil,
        role: String? = nil,
        workType: String? = nil
    ) {
        self.id = id
        self.number = number
        self.name = name
        self.address = address
        self.at = at
        self.status = status
        self.placed = placed
        self.filmed = filmed
        self.filmedOn = filmedOn
        self.assigned = assigned
        self.role = role
        self.workType = workType
    }

    func matches(_ query: String) -> Bool {
        let tokens = query
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .split(whereSeparator: { $0.isWhitespace })
        if tokens.isEmpty { return true }
        let hay = [name, address, number, status ?? "", at, filmedOn ?? "", role ?? "", roleLabel]
            .joined(separator: " ")
            .lowercased()
        return tokens.allSatisfy { hay.contains($0) }
    }

    var roleLabel: String {
        switch (role ?? "").lowercased() {
        case "lead": return "Lead"
        case "crew": return "Crew"
        case "owner": return "Yours"
        case "supervisor": return "Supervisor"
        case "estimator": return "Estimator"
        case "observer": return "Observer"
        default: return "Assigned"
        }
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
