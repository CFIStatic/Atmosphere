import Foundation

/**
 * REST client for Atmosphere Field Capture.
 *
 * Auth: bearer access token from the crew's Atmosphere login / device session.
 * Base URL from `ATMOSPHERE_API_BASE` Info.plist / environment.
 */
@MainActor
final class AtmosphereClient: ObservableObject {
    let baseURL: URL
    var accessToken: String?

    init(baseURL: URL, accessToken: String? = nil) {
        self.baseURL = baseURL
        self.accessToken = accessToken
    }

    static func fromEnvironment() -> AtmosphereClient {
        let raw = Bundle.main.object(forInfoDictionaryKey: "ATMOSPHERE_API_BASE") as? String
            ?? ProcessInfo.processInfo.environment["ATMOSPHERE_API_BASE"]
            ?? "https://api.atmosphere.example"
        return AtmosphereClient(baseURL: URL(string: raw)!)
    }

    // MARK: - Media catalog (A/V day film)

    struct BeginUploadBody: Encodable {
        var kind: String = "field_day_video"
        var contentType: String = "video/mp4"
        var durationSeconds: Double?
        var byteSize: Int64?
        var hasAudio: Bool = true
        var preferMultipart: Bool?
        var refType: String?
        var refId: String?
    }

    struct BeginUploadResponse: Decodable {
        struct Media: Decodable {
            let id: String
            let objectKey: String?
            let hasAudio: Bool?
            let state: String?
        }
        struct Session: Decodable {
            let id: String
            let uploadUrl: String?
            let multipart: Multipart?
            struct Multipart: Decodable {
                let uploadId: String
                let partSizeBytes: Int
                let partCount: Int
                let parts: [Part]
                struct Part: Decodable {
                    let partNumber: Int
                    let url: String
                }
            }
        }
        let media: Media
        let session: Session
    }

    func beginDayFilmUpload(
        durationSeconds: Double,
        byteSize: Int64,
        preferMultipart: Bool = true
    ) async throws -> BeginUploadResponse {
        try await post(
            path: "/api/media/catalog/uploads",
            body: BeginUploadBody(
                durationSeconds: durationSeconds,
                byteSize: byteSize,
                hasAudio: true,
                preferMultipart: preferMultipart
            )
        )
    }

    struct CompleteUploadBody: Encodable {
        let sessionId: String
        var byteSize: Int64?
        var contentHash: String?
        var durationSeconds: Double?
        var hasAudio: Bool = true
    }

    struct CompleteUploadResponse: Decodable {
        struct Media: Decodable {
            let id: String
            let state: String?
            let hasAudio: Bool?
            let objectKey: String?
        }
        let media: Media
    }

    func completeDayFilmUpload(
        sessionId: String,
        byteSize: Int64,
        durationSeconds: Double,
        contentHash: String?
    ) async throws -> CompleteUploadResponse {
        try await post(
            path: "/api/media/catalog/uploads/complete",
            body: CompleteUploadBody(
                sessionId: sessionId,
                byteSize: byteSize,
                contentHash: contentHash,
                durationSeconds: durationSeconds,
                hasAudio: true
            )
        )
    }

    // MARK: - Geometry / twin

    struct OpenGeometrySessionBody: Encodable {
        var platform: String = "ios"
        var measureApi: String = "roomplan"
        var lidarAvailable: Bool
        var label: String?
        var videoRef: String?
    }

    struct GeometrySessionResponse: Decodable {
        struct Session: Decodable { let id: String }
        struct Twin: Decodable { let id: String }
        let session: Session
        let twin: Twin
    }

    func openGeometrySession(
        lidarAvailable: Bool,
        label: String?,
        videoRef: String?
    ) async throws -> GeometrySessionResponse {
        try await post(
            path: "/api/geometry/sessions",
            body: OpenGeometrySessionBody(
                lidarAvailable: lidarAvailable,
                label: label,
                videoRef: videoRef
            )
        )
    }

    struct IngestBody: Encodable {
        var source: String
        var rooms: [RoomPayload]
        var mesh: MeshPayload?
        var videoRef: String?
        var work: [WorkPayload]?

        struct RoomPayload: Encodable {
            var name: String
            var lengthFt: Double?
            var widthFt: Double?
            var heightFt: Double?
            var floorAreaSqFt: Double?
            var confidence: Double?
        }
        struct MeshPayload: Encodable {
            var format: String
            var url: String
            var producedBy: String?
        }
        struct WorkPayload: Encodable {
            var label: String
            var status: String
            var scopeTitle: String?
        }
    }

    func ingestGeometry(sessionId: String, body: IngestBody) async throws {
        let _: EmptyJSON = try await post(
            path: "/api/geometry/sessions/\(sessionId)/ingest",
            body: body
        )
    }

    // MARK: - HTTP

    private struct EmptyJSON: Decodable {}

    private func post<Body: Encodable, Response: Decodable>(
        path: String,
        body: Body
    ) async throws -> Response {
        guard let url = URL(string: path, relativeTo: baseURL)?.absoluteURL else {
            throw APIError.http(status: 0, body: "bad url \(path)")
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let accessToken {
            request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        }
        request.httpBody = try JSONEncoder().encode(body)

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200 ... 299).contains(http.statusCode) else {
            let text = String(data: data, encoding: .utf8) ?? ""
            throw APIError.http(status: (response as? HTTPURLResponse)?.statusCode ?? 0, body: text)
        }
        return try JSONDecoder().decode(Response.self, from: data)
    }
}

enum APIError: LocalizedError {
    case http(status: Int, body: String)
    var errorDescription: String? {
        switch self {
        case let .http(status, body):
            return "API \(status): \(body.prefix(240))"
        }
    }
}
