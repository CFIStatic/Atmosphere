import Foundation

/**
 * REST client for Atmosphere Field Capture.
 *
 * Auth: bearer access token from the same Atmosphere login as the dashboard.
 * Base URL from `ATMOSPHERE_API_BASE` Info.plist / environment (build-time).
 */
@MainActor
final class AtmosphereClient: ObservableObject {
    /// Same Atmosphere API origin the website/dashboard uses.
    @Published private(set) var baseURL: URL
    var accessToken: String?
    var refreshToken: String?
    /// Optional hook so AuthSession can rotate tokens on 401 without a cycle.
    var onUnauthorized: (() async throws -> Void)?

    init(baseURL: URL, accessToken: String? = nil) {
        self.baseURL = baseURL
        self.accessToken = accessToken
    }

    static func fromEnvironment() -> AtmosphereClient {
        AtmosphereClient(baseURL: ApiConfig.resolvedBaseURL())
    }

    // MARK: - Auth (same account as dashboard)

    struct SessionTokens: Decodable {
        let accessToken: String
        let refreshToken: String
        let expiresIn: Int?
        let expiresAt: Int?
    }

    struct PublicUser: Decodable {
        let id: String
        let email: String?
    }

    struct AuthResponse: Decodable {
        let user: PublicUser
        let session: SessionTokens?
    }

    private struct PasswordLoginBody: Encodable {
        let email: String
        let password: String
    }

    private struct RefreshBody: Encodable {
        let refreshToken: String
    }

    func login(email: String, password: String) async throws -> AuthResponse {
        try await post(
            path: "/api/auth/login",
            body: PasswordLoginBody(email: email, password: password),
            authed: false
        )
    }

    func refresh(refreshToken: String) async throws -> AuthResponse {
        try await post(
            path: "/api/auth/refresh",
            body: RefreshBody(refreshToken: refreshToken),
            authed: false
        )
    }

    func logout() async {
        struct Ok: Decodable { let ok: Bool? }
        do {
            let _: Ok = try await post(
                path: "/api/auth/logout",
                body: RefreshBody(refreshToken: refreshToken ?? ""),
                authed: false
            )
        } catch {
            /* best-effort */
        }
    }

    // MARK: - Field app bridge

    struct FieldMe: Decodable {
        struct User: Decodable {
            let id: String
            let email: String?
            let fullName: String?
        }
        struct Org: Decodable {
            let id: String
            let name: String
            let role: String?
        }
        let user: User
        let org: Org
    }

    func fieldMe() async throws -> FieldMe {
        try await get(path: "/api/field-app/me")
    }

    struct TodayResponse: Decodable {
        let jobs: [ExpectedJob]
    }

    func todayJobs() async throws -> [ExpectedJob] {
        let res: TodayResponse = try await get(path: "/api/field-app/today")
        return res.jobs
    }

    struct ProofUploadUrlResponse: Decodable {
        let path: String
        let token: String?
        let uploadUrl: String
    }

    func beginJobProofUpload(
        jobId: String,
        workDate: String,
        phase: String = "after",
        fileExtension: String = "mp4"
    ) async throws -> ProofUploadUrlResponse {
        struct Body: Encodable {
            let workDate: String
            let phase: String
            let `extension`: String
        }
        return try await post(
            path: "/api/field-app/jobs/\(jobId)/proof/upload-url",
            body: Body(workDate: workDate, phase: phase, extension: fileExtension)
        )
    }

    struct ProofRecordBody: Encodable {
        var workDate: String
        var phase: String
        var storagePath: String
        var byteSize: Int64?
        var durationSeconds: Double?
        var contentHash: String?
        var capturedAt: String?
        var lat: Double?
        var lon: Double?
        var accuracyM: Double?
    }

    struct ProofRecordResponse: Decodable {
        struct Proof: Decodable {
            let id: String?
        }
        let proof: Proof?
    }

    func completeJobProof(jobId: String, body: ProofRecordBody) async throws -> ProofRecordResponse {
        try await post(path: "/api/field-app/jobs/\(jobId)/proof", body: body)
    }

    // MARK: - Geometry / twin (org-authenticated)

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
        let _: Ack = try await post(
            path: "/api/geometry/sessions/\(sessionId)/ingest",
            body: body
        )
    }

    // MARK: - HTTP

    /// Decodable stand-in when the API returns `{}` or a body we ignore.
    private struct Ack: Decodable {}

    private func get<Response: Decodable>(path: String) async throws -> Response {
        try await send(path: path, method: "GET", bodyData: nil, authed: true)
    }

    private func post<Body: Encodable, Response: Decodable>(
        path: String,
        body: Body,
        authed: Bool = true
    ) async throws -> Response {
        let data = try JSONEncoder().encode(body)
        return try await send(path: path, method: "POST", bodyData: data, authed: authed)
    }

    private func send<Response: Decodable>(
        path: String,
        method: String,
        bodyData: Data?,
        authed: Bool,
        isRetry: Bool = false
    ) async throws -> Response {
        guard let url = URL(string: path, relativeTo: baseURL)?.absoluteURL else {
            throw APIError.http(status: 0, body: "bad url \(path)")
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        if let bodyData {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = bodyData
        }
        if authed, let accessToken {
            request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        }

        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if authed, status == 401, !isRetry, let onUnauthorized {
            try await onUnauthorized()
            return try await send(
                path: path,
                method: method,
                bodyData: bodyData,
                authed: authed,
                isRetry: true
            )
        }
        guard (200 ... 299).contains(status) else {
            let text = Self.apiErrorMessage(from: data) ?? String(data: data, encoding: .utf8) ?? ""
            throw APIError.http(status: status, body: text)
        }
        return try JSONDecoder().decode(Response.self, from: data)
    }

    /// Prefer the BFF's `{ error }` field over a raw JSON blob.
    private static func apiErrorMessage(from data: Data) -> String? {
        guard
            let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let error = obj["error"] as? String
        else { return nil }
        let trimmed = error.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
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
