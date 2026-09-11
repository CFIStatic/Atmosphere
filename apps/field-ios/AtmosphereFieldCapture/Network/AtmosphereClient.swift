import Foundation

/**
 * REST client for Atmosphere Field Capture.
 *
 * Crew sign in with the same email + password as the office Platform
 * (`/api/auth/login`). Invite-code join remains available as a fallback.
 * A dashboard email/password login still works. Today’s jobs are loaded
 * from that office. A local Express BFF is used when one is actually
 * reachable (Xcode simulator + `npm run dev`).
 */
@MainActor
final class AtmosphereClient: ObservableObject {
    /// BFF origin when one is configured and usable; otherwise the Supabase project.
    @Published private(set) var baseURL: URL
    var accessToken: String?
    var refreshToken: String?
    /// Optional hook so AuthSession can rotate tokens on 401 without a cycle.
    var onUnauthorized: (() async throws -> Void)?

    private let bffURL: URL?
    private let supabaseURL: URL
    private let supabaseAnonKey: String
    private let decoder = JSONDecoder()
    private let encoder = JSONEncoder()

    init(baseURL: URL, accessToken: String? = nil) {
        self.bffURL = ApiConfig.bffBaseURL()
        self.supabaseURL = ApiConfig.supabaseURL
        self.supabaseAnonKey = ApiConfig.supabaseAnonKey
        self.baseURL = baseURL
        self.accessToken = accessToken
    }

    static func fromEnvironment() -> AtmosphereClient {
        AtmosphereClient(baseURL: ApiConfig.resolvedBaseURL())
    }

    private var usesBFF: Bool { bffURL != nil }

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
        let user: PublicUser?
        let session: SessionTokens?
        let needsEmailConfirmation: Bool?
        let message: String?
        let org: FieldOrg?
        let orgError: String?
    }

    struct FieldOrg: Decodable {
        let id: String
        let name: String
        let joinCode: String?
        let role: String?
    }

    private struct PasswordLoginBody: Encodable {
        let email: String
        let password: String
    }

    private struct RefreshBody: Encodable {
        let refreshToken: String
    }

    func login(email: String, password: String) async throws -> AuthResponse {
        let body = PasswordLoginBody(email: email, password: password)
        if usesBFF {
            do {
                return try await post(path: "/api/auth/login", body: body, authed: false)
            } catch {
                if Self.isUnreachable(error) {
                    return try await loginViaSupabase(email: email, password: password)
                }
                throw error
            }
        }
        return try await loginViaSupabase(email: email, password: password)
    }

    static let currentTermsVersion = "2026-09-10"
    static let termsURL = URL(string: "https://atmosphereteam.com/terms")!
    static let privacyURL = URL(string: "https://atmosphereteam.com/privacy")!

    struct TermsStatus: Decodable {
        let required: Bool
        let currentVersion: String
        let acceptedVersion: String?
        let url: String?
    }

    struct AuthMe: Decodable {
        let user: PublicUser
        let terms: TermsStatus?
    }

    private struct RegisterBody: Encodable {
        let email: String
        let password: String
        let fullName: String?
        let orgName: String?
        let acceptedTermsVersion: String
    }

    /// Create the same Atmosphere account the website uses, then join by invite.
    func registerAccount(
        email: String,
        password: String,
        fullName: String?,
        orgName: String? = nil
    ) async throws -> AuthResponse {
        let body = RegisterBody(
            email: email,
            password: password,
            fullName: fullName,
            orgName: orgName,
            acceptedTermsVersion: Self.currentTermsVersion
        )
        if usesBFF {
            do {
                return try await post(path: "/api/field-app/register", body: body, authed: false)
            } catch {
                if Self.isUnreachable(error) {
                    return try await registerViaSupabase(
                        email: email,
                        password: password,
                        fullName: fullName,
                        orgName: orgName
                    )
                }
                if case let APIError.http(status, _) = error, status == 404 {
                    return try await registerViaLegacyBFF(
                        email: email,
                        password: password,
                        fullName: fullName,
                        orgName: orgName
                    )
                }
                throw error
            }
        }
        return try await registerViaSupabase(
            email: email,
            password: password,
            fullName: fullName,
            orgName: orgName
        )
    }

    func authMe() async throws -> AuthMe {
        try await get(path: "/api/auth/me")
    }

    func acceptTerms(version: String = AtmosphereClient.currentTermsVersion) async throws -> TermsStatus {
        struct Body: Encodable { let acceptedTermsVersion: String }
        struct Res: Decodable { let terms: TermsStatus }
        let res: Res = try await post(
            path: "/api/auth/terms/accept",
            body: Body(acceptedTermsVersion: version)
        )
        return res.terms
    }

    /// Join an office by pending email invite, or start one when `orgName` is set.
    func linkOffice(orgName: String?, fullName: String? = nil) async throws -> FieldOrg {
        struct Body: Encodable {
            let orgName: String?
            let fullName: String?
        }
        let body = Body(orgName: orgName, fullName: fullName)
        if usesBFF {
            do {
                let res: OfficeResponse = try await post(path: "/api/field-app/office", body: body)
                guard let org = res.org else {
                    throw APIError.http(status: 400, body: "Could not link this phone to an office.")
                }
                return org
            } catch {
                if !Self.isUnreachable(error) { throw error }
            }
        }
        return try await linkOfficeViaSupabase(orgName: orgName, fullName: fullName)
    }

    private struct OfficeResponse: Decodable {
        let org: FieldOrg?
    }

    func refresh(refreshToken: String) async throws -> AuthResponse {
        if usesBFF {
            do {
                return try await post(
                    path: "/api/auth/refresh",
                    body: RefreshBody(refreshToken: refreshToken),
                    authed: false
                )
            } catch {
                if Self.isUnreachable(error) {
                    return try await refreshViaSupabase(refreshToken: refreshToken)
                }
                throw error
            }
        }
        return try await refreshViaSupabase(refreshToken: refreshToken)
    }

    func logout() async {
        struct Ok: Decodable { let ok: Bool? }
        do {
            if usesBFF {
                let _: Ok = try await post(
                    path: "/api/auth/logout",
                    body: RefreshBody(refreshToken: refreshToken ?? ""),
                    authed: false
                )
            } else {
                try await supabaseLogout()
            }
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
        if usesBFF {
            do {
                return try await get(path: "/api/field-app/me")
            } catch {
                if !Self.isUnreachable(error) { throw error }
            }
        }
        return try await fieldMeViaSupabase()
    }

    struct TodayResponse: Decodable {
        let jobs: [ExpectedJob]
    }

    func todayJobs() async throws -> [ExpectedJob] {
        if usesBFF {
            do {
                let res: TodayResponse = try await get(path: "/api/field-app/today")
                return res.jobs
            } catch {
                if !Self.isUnreachable(error) { throw error }
            }
        }
        return try await todayJobsViaSupabase()
    }

    struct CreateJobResponse: Decodable {
        let job: ExpectedJob
    }

    /// POST /api/field-app/jobs — create a job from the phone (web createTodayJob).
    func createTodayJob(title: String, situation: String?) async throws -> ExpectedJob {
        struct Body: Encodable {
            let title: String
            let situation: String?
        }
        let res: CreateJobResponse = try await post(
            path: "/api/field-app/jobs",
            body: Body(
                title: title,
                situation: (situation?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false)
                    ? situation : nil
            )
        )
        return res.job
    }

    struct PlacesStatus: Decodable {
        let configured: Bool?
        let provider: String?
        let google: Bool?
    }

    struct PlaceSuggestion: Decodable, Identifiable, Equatable {
        var id: String { placeId }
        let placeId: String
        let description: String
        let mainText: String?
        let secondaryText: String?
    }

    struct PlacesAutocompleteResponse: Decodable {
        let suggestions: [PlaceSuggestion]
        let configured: Bool?
        let provider: String?
    }

    struct PlaceAddress: Decodable {
        let formatted: String?
        let addressLine1: String?
        let city: String?
        let region: String?
        let postalCode: String?
        let country: String?
        let placeId: String?
        let lat: Double?
        let lng: Double?

        var displayLine: String {
            let formatted = self.formatted?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            if !formatted.isEmpty { return formatted }
            return [addressLine1, city, region]
                .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
                .joined(separator: ", ")
        }
    }

    struct PlacesDetailsResponse: Decodable {
        let address: PlaceAddress
        let configured: Bool?
        let provider: String?
    }

    func placesStatus() async throws -> PlacesStatus {
        try await get(path: "/api/field-app/places/status")
    }

    func placesAutocomplete(input: String, sessionToken: String?) async throws -> [PlaceSuggestion] {
        struct Body: Encodable {
            let input: String
            let sessionToken: String?
        }
        let res: PlacesAutocompleteResponse = try await post(
            path: "/api/field-app/places/autocomplete",
            body: Body(input: input, sessionToken: sessionToken)
        )
        return res.suggestions
    }

    func placesDetails(placeId: String, sessionToken: String?) async throws -> PlaceAddress {
        struct Body: Encodable {
            let placeId: String
            let sessionToken: String?
        }
        let res: PlacesDetailsResponse = try await post(
            path: "/api/field-app/places/details",
            body: Body(placeId: placeId, sessionToken: sessionToken)
        )
        return res.address
    }

    // MARK: - Job share (no office login)

    struct ShareExchangeResponse: Decodable {
        let ok: Bool?
        struct You: Decodable {
            let company: String?
            let trade: String?
            let role: String?
        }
        let you: You?
    }

    struct ShareJobPayload: Decodable {
        struct You: Decodable {
            let company: String?
            let trade: String?
            let role: String?
        }
        struct Job: Decodable {
            let jobNumber: Int?
            let title: String?
            let claimNumber: String?
            let scheduledStart: String?
            let id: String?
        }
        let you: You?
        let job: Job?
    }

    private func jobSharePath(token: String, suffix: String = "") -> String {
        let enc = token.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? token
        return "/api/job-share/\(enc)\(suffix)"
    }

    func exchangeShareToken(_ token: String) async throws -> ShareExchangeResponse {
        struct Body: Encodable { let token: String }
        return try await post(path: "/api/job-share/exchange", body: Body(token: token), authed: false)
    }

    func loadShareJob(token: String) async throws -> ShareJobPayload {
        try await send(path: jobSharePath(token: token), method: "GET", bodyData: nil, authed: false)
    }

    func shareJobAsExpected(_ payload: ShareJobPayload, token: String) -> ExpectedJob {
        let title = payload.job?.title?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty ?? "Job"
        let num = payload.job?.jobNumber.map { "#\($0)" } ?? ""
        let claim = payload.job?.claimNumber?.trimmingCharacters(in: .whitespacesAndNewlines)
        let addr: String
        if let claim, !claim.isEmpty {
            addr = "Claim \(claim)"
        } else {
            addr = "Shared job"
        }
        let id = payload.job?.id?.nilIfEmpty ?? "share:\(token.prefix(12))"
        return ExpectedJob(
            id: id,
            number: num,
            name: num.isEmpty ? title : "\(num) · \(title)",
            address: addr,
            at: "Today",
            placed: true,
            status: nil,
            filmed: false
        )
    }

    struct ProofUploadPart: Decodable {
        let index: Int
        let start: Int64?
        let end: Int64?
        let path: String?
        let token: String?
        let uploadUrl: String
    }

    struct ProofUploadUrlResponse: Decodable {
        let path: String
        let clipId: String?
        let token: String?
        let uploadUrl: String
        let chunkSize: Int?
        let parts: [ProofUploadPart]?
    }

    struct ProofPartUploadUrlResponse: Decodable {
        let path: String
        let clipId: String?
        let index: Int
        let partPath: String?
        let token: String?
        let uploadUrl: String
        let maxParts: Int?
        let assembleMaxBytes: Int64?
    }

    struct ProofUploadCompleteResponse: Decodable {
        let path: String
        let byteSize: Int64?
    }

    func beginJobProofUpload(
        jobId: String,
        workDate: String,
        phase: String = "after",
        fileExtension: String = "mp4",
        clipId: String? = nil,
        byteSize: Int64? = nil,
        shareToken: String? = nil
    ) async throws -> ProofUploadUrlResponse {
        struct Body: Encodable {
            let workDate: String
            let phase: String
            let `extension`: String
            let clipId: String?
            let byteSize: Int64?
        }
        let resolvedClip = ClipId.resolve(clipId)
        let body = Body(
            workDate: workDate,
            phase: phase,
            extension: fileExtension,
            clipId: resolvedClip,
            byteSize: byteSize
        )
        if let shareToken, !shareToken.isEmpty {
            return try await post(
                path: jobSharePath(token: shareToken, suffix: "/proof/upload-url"),
                body: body,
                authed: false
            )
        }
        if usesBFF {
            do {
                return try await post(
                    path: "/api/field-app/jobs/\(jobId)/proof/upload-url",
                    body: body
                )
            } catch {
                if !Self.isUnreachable(error) { throw error }
            }
        }
        return try await beginProofUploadViaSupabase(
            jobId: jobId,
            workDate: workDate,
            phase: phase,
            fileExtension: fileExtension,
            clipId: resolvedClip
        )
    }

    /// Mint one signed URL for one slice (web `upload-part-url` / live streamer).
    func beginJobProofPartUpload(
        jobId: String,
        workDate: String,
        phase: String = "after",
        fileExtension: String = "mp4",
        clipId: String,
        index: Int,
        shareToken: String? = nil
    ) async throws -> ProofPartUploadUrlResponse {
        struct Body: Encodable {
            let workDate: String
            let phase: String
            let `extension`: String
            let clipId: String
            let index: Int
        }
        let body = Body(
            workDate: workDate,
            phase: phase,
            extension: fileExtension,
            clipId: ClipId.resolve(clipId),
            index: index
        )
        if let shareToken, !shareToken.isEmpty {
            return try await post(
                path: jobSharePath(token: shareToken, suffix: "/proof/upload-part-url"),
                body: body,
                authed: false
            )
        }
        return try await post(
            path: "/api/field-app/jobs/\(jobId)/proof/upload-part-url",
            body: body
        )
    }

    /// Stitch `.parts/0000…` onto the final storage path after multipart PUTs.
    func completeJobProofUpload(
        jobId: String,
        workDate: String,
        phase: String = "after",
        storagePath: String,
        partCount: Int,
        shareToken: String? = nil
    ) async throws -> ProofUploadCompleteResponse {
        struct Body: Encodable {
            let workDate: String
            let phase: String
            let storagePath: String
            let partCount: Int
        }
        let body = Body(
            workDate: workDate,
            phase: phase,
            storagePath: storagePath,
            partCount: partCount
        )
        if let shareToken, !shareToken.isEmpty {
            return try await post(
                path: jobSharePath(token: shareToken, suffix: "/proof/upload-complete"),
                body: body,
                authed: false
            )
        }
        return try await post(
            path: "/api/field-app/jobs/\(jobId)/proof/upload-complete",
            body: body
        )
    }

    /// PUT to a BFF signed URL, or POST straight into the Atmosphere storage bucket.
    /// When `begin.parts` has 2+ slices (long film), uploads parts then stitches
    /// via `upload-complete` — same contract as web Field Capture.
    func uploadProofMedia(localURL: URL, begin: ProofUploadUrlResponse) async throws -> (byteSize: Int64, sha256Hex: String, storagePath: String) {
        let size = try MediaUploadClient.byteSize(ofFile: localURL)
        let hex = try MediaUploadClient.sha256Hex(ofFile: localURL)
        let parts = begin.parts ?? []
        if parts.count >= 2, size <= Int64(MediaUploadClient.maxAssembleBytes) {
            let ordered = parts.sorted { $0.index < $1.index }
            for part in ordered {
                guard let partURL = URL(string: part.uploadUrl) else {
                    throw APIError.http(status: 0, body: "Bad upload part URL")
                }
                let start = part.start ?? 0
                let endExclusive: Int64
                if let end = part.end {
                    // Server range is inclusive end.
                    endExclusive = end + 1
                } else {
                    let chunk = Int64(begin.chunkSize ?? MediaUploadClient.defaultPartBytes)
                    endExclusive = min(size, start + chunk)
                }
                try await MediaUploadClient.uploadFileRange(
                    localURL: localURL,
                    range: start ..< endExclusive,
                    uploadURL: partURL,
                    headers: ["Content-Type": "application/octet-stream"]
                )
            }
            // Caller must know jobId to stitch — return path; stitch is separate.
            return (size, hex, begin.path)
        }

        guard let uploadURL = URL(string: begin.uploadUrl) else {
            throw APIError.http(status: 0, body: "Bad upload URL")
        }
        // Signed upload URLs also live under `/storage/v1/object/upload/sign/…` and
        // must be PUT. Only the direct fallback path
        // `/storage/v1/object/job-proofs/…` is a bearer-authenticated POST.
        let isDirectStoragePost =
            begin.uploadUrl.contains("/storage/v1/object/job-proofs/")
            && !begin.uploadUrl.contains("/upload/sign/")
        var headers: [String: String] = ["Content-Type": "video/mp4"]
        if isDirectStoragePost {
            headers["apikey"] = supabaseAnonKey
            if let accessToken {
                headers["Authorization"] = "Bearer \(accessToken)"
            }
            headers["x-upsert"] = "true"
        }
        try await MediaUploadClient.putFile(
            localURL: localURL,
            uploadURL: uploadURL,
            method: isDirectStoragePost ? "POST" : "PUT",
            headers: headers
        )
        return (size, hex, begin.path)
    }

    /// Full multipart path when the slot has no pre-minted `parts` but the film
    /// is long: mint each slice via `upload-part-url`, PUT, then `upload-complete`.
    func uploadProofMediaMultipartViaPartUrls(
        jobId: String,
        localURL: URL,
        workDate: String,
        clipId: String,
        phase: String = "after",
        fileExtension: String = "mp4",
        shareToken: String? = nil,
        onProgress: ((Double) -> Void)? = nil
    ) async throws -> (byteSize: Int64, sha256Hex: String, storagePath: String, partCount: Int) {
        let size = try MediaUploadClient.byteSize(ofFile: localURL)
        let hex = try MediaUploadClient.sha256Hex(ofFile: localURL)
        let ranges = MediaUploadClient.partRanges(byteSize: size)
        guard ranges.count >= 2 else {
            throw APIError.http(status: 0, body: "Film is too small for multipart.")
        }
        var storagePath = ""
        for (index, range) in ranges.enumerated() {
            let minted = try await beginJobProofPartUpload(
                jobId: jobId,
                workDate: workDate,
                phase: phase,
                fileExtension: fileExtension,
                clipId: clipId,
                index: index,
                shareToken: shareToken
            )
            storagePath = minted.path
            guard let partURL = URL(string: minted.uploadUrl) else {
                throw APIError.http(status: 0, body: "Bad upload part URL")
            }
            try await MediaUploadClient.uploadFileRange(
                localURL: localURL,
                range: range,
                uploadURL: partURL
            )
            onProgress?(Double(index + 1) / Double(ranges.count))
        }
        _ = try await completeJobProofUpload(
            jobId: jobId,
            workDate: workDate,
            phase: phase,
            storagePath: storagePath,
            partCount: ranges.count,
            shareToken: shareToken
        )
        return (size, hex, storagePath, ranges.count)
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
        /// Echoed for clients/logs; server binds clip from storagePath.
        var clipId: String?
    }

    struct ProofRecordResponse: Decodable {
        struct Proof: Decodable {
            let id: String?
        }
        let proof: Proof?
    }

    func completeJobProof(jobId: String, body: ProofRecordBody, shareToken: String? = nil) async throws -> ProofRecordResponse {
        if let shareToken, !shareToken.isEmpty {
            return try await post(
                path: jobSharePath(token: shareToken, suffix: "/proof"),
                body: body,
                authed: false
            )
        }
        if usesBFF {
            do {
                return try await post(path: "/api/field-app/jobs/\(jobId)/proof", body: body)
            } catch {
                if !Self.isUnreachable(error) { throw error }
            }
        }
        return try await completeProofViaSupabase(jobId: jobId, body: body)
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

    // MARK: - Supabase (hosted Atmosphere project)

    private struct EmptyJSON: Encodable {}

    private struct GoTrueTokenResponse: Decodable {
        let access_token: String?
        let refresh_token: String?
        let expires_in: Int?
        let expires_at: Int?
        let user: GoTrueUser?
        let error: String?
        let error_description: String?
        let error_code: String?
        let msg: String?
    }

    private struct GoTrueUser: Decodable {
        let id: String
        let email: String?
    }

    private struct MembershipRow: Decodable {
        let org_id: String
        let org_name: String?
        let role: String?
        let status: String?
    }

    private struct ProfileRow: Decodable {
        let full_name: String?
    }

    private struct JobRow: Decodable {
        let id: String
        let job_number: Int?
        let title: String?
        let status: String?
        let scheduled_start: String?
        let property_id: String?
    }

    private struct ProofRow: Decodable {
        let job_id: String
    }

    private struct PropertyRow: Decodable {
        let id: String
        let address_line1: String?
        let city: String?
    }

    private struct PartyRow: Decodable {
        let id: String
        let email: String?
    }

    private struct ProofInsertRow: Decodable {
        let id: String
    }

    private func loginViaSupabase(email: String, password: String) async throws -> AuthResponse {
        struct Body: Encodable {
            let email: String
            let password: String
        }
        return try await supabaseAuthToken(grantType: "password", json: Body(email: email, password: password))
    }

    private func signupViaSupabase(email: String, password: String) async throws -> AuthResponse {
        struct Body: Encodable {
            let email: String
            let password: String
        }
        var request = URLRequest(url: try makeSupabaseURL(path: "/auth/v1/signup"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(supabaseAnonKey, forHTTPHeaderField: "apikey")
        request.httpBody = try encoder.encode(Body(email: email, password: password))

        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        let parsed = try? decoder.decode(GoTrueTokenResponse.self, from: data)
        if status == 400 || status == 401 || status == 422 {
            let raw = parsed?.error_description ?? parsed?.msg ?? parsed?.error
                ?? String(data: data, encoding: .utf8) ?? ""
            throw APIError.http(
                status: 400,
                body: raw.isEmpty
                    ? "Unable to create an account with those details. If you already have an account, try signing in."
                    : raw
            )
        }
        guard (200 ... 299).contains(status) else {
            let text = parsed?.error_description ?? parsed?.msg ?? String(data: data, encoding: .utf8) ?? ""
            throw APIError.http(status: status, body: text)
        }
        if let access = parsed?.access_token, let refresh = parsed?.refresh_token {
            return AuthResponse(
                user: PublicUser(id: parsed?.user?.id ?? jwtClaim("sub", in: access) ?? "", email: parsed?.user?.email),
                session: SessionTokens(
                    accessToken: access,
                    refreshToken: refresh,
                    expiresIn: parsed?.expires_in,
                    expiresAt: parsed?.expires_at
                ),
                needsEmailConfirmation: false,
                message: nil,
                org: nil,
                orgError: nil
            )
        }
        return AuthResponse(
            user: parsed?.user.map { PublicUser(id: $0.id, email: $0.email) },
            session: nil,
            needsEmailConfirmation: true,
            message: "Account created. Check your email to confirm before signing in.",
            org: nil,
            orgError: nil
        )
    }

    private func registerViaLegacyBFF(
        email: String,
        password: String,
        fullName: String?,
        orgName: String?
    ) async throws -> AuthResponse {
        struct SignupBody: Encodable {
            let email: String
            let password: String
            let acceptedTermsVersion: String
        }
        let result = try await post(
            path: "/api/auth/signup",
            body: SignupBody(
                email: email,
                password: password,
                acceptedTermsVersion: Self.currentTermsVersion
            ),
            authed: false
        )
        if result.needsEmailConfirmation == true || result.session == nil {
            return result
        }
        accessToken = result.session?.accessToken
        refreshToken = result.session?.refreshToken
        do {
            let org = try await linkOfficeViaBFF(orgName: orgName, fullName: fullName)
            return AuthResponse(
                user: result.user,
                session: result.session,
                needsEmailConfirmation: false,
                message: nil,
                org: org,
                orgError: nil
            )
        } catch {
            let message = (error as? APIError).flatMap {
                if case let .http(_, body) = $0 { return body } else { return nil }
            } ?? error.localizedDescription
            return AuthResponse(
                user: result.user,
                session: result.session,
                needsEmailConfirmation: false,
                message: nil,
                org: nil,
                orgError: message
            )
        }
    }

    private func linkOfficeViaBFF(orgName: String?, fullName: String?) async throws -> FieldOrg {
        if let fullName, !fullName.isEmpty {
            struct ProfileBody: Encodable { let fullName: String }
            struct ProfileRes: Decodable { let profile: ProfileRow? }
            let _: ProfileRes = try await post(path: "/api/profile", body: ProfileBody(fullName: fullName))
        }
        if let orgName, !orgName.isEmpty {
            struct CreateBody: Encodable {
                let name: String
                let role: String
                let workType: String
                let contractorType: String
                let usageIntents: [String]
            }
            let res: OfficeResponse = try await post(
                path: "/api/org",
                body: CreateBody(
                    name: orgName,
                    role: "field_technician",
                    workType: "construction",
                    contractorType: "other",
                    usageIntents: ["field_work"]
                )
            )
            guard let org = res.org else {
                throw APIError.http(status: 400, body: "Could not start that office.")
            }
            return org
        }
        struct JoinBody: Encodable {
            let role: String
            let workType: String
            let usageIntents: [String]
        }
        let res: OfficeResponse = try await post(
            path: "/api/org/join",
            body: JoinBody(
                role: "employee",
                workType: "construction",
                usageIntents: ["field_work"]
            )
        )
        guard let org = res.org else {
            throw APIError.http(status: 400, body: "Ask your Global Admin to invite this email.")
        }
        return org
    }

    private func registerViaSupabase(
        email: String,
        password: String,
        fullName: String?,
        orgName: String?
    ) async throws -> AuthResponse {
        let created = try await signupViaSupabase(email: email, password: password)
        if created.needsEmailConfirmation == true || created.session == nil {
            return created
        }
        accessToken = created.session?.accessToken
        refreshToken = created.session?.refreshToken
        do {
            let org = try await linkOfficeViaSupabase(
                orgName: orgName,
                fullName: fullName
            )
            return AuthResponse(
                user: created.user,
                session: created.session,
                needsEmailConfirmation: false,
                message: nil,
                org: org,
                orgError: nil
            )
        } catch {
            let message = (error as? APIError).flatMap {
                if case let .http(_, body) = $0 { return body } else { return nil }
            } ?? error.localizedDescription
            return AuthResponse(
                user: created.user,
                session: created.session,
                needsEmailConfirmation: false,
                message: nil,
                org: nil,
                orgError: message
            )
        }
    }

    private func linkOfficeViaSupabase(
        orgName: String?,
        fullName: String?
    ) async throws -> FieldOrg {
        if let fullName, !fullName.isEmpty {
            struct Profile: Encodable {
                let id: String
                let email: String?
                let full_name: String
            }
            let _: [ProfileRow] = try await supabaseRest(
                path: "/rest/v1/profiles",
                method: "POST",
                query: [URLQueryItem(name: "on_conflict", value: "id")],
                json: Profile(id: jwtClaim("sub") ?? "", email: jwtClaim("email"), full_name: fullName),
                extraHeaders: ["Prefer": "resolution=merge-duplicates,return=representation"]
            )
        }
        guard let orgName, !orgName.isEmpty else {
            throw APIError.http(
                status: 400,
                body: "Ask your Global Admin to invite this email, then try again."
            )
        }
        struct Create: Encodable {
            let p_name: String
            let p_role: String
            let p_work_type: String
        }
        let org = try await supabaseRpcOrg(
            path: "/rest/v1/rpc/create_org",
            json: Create(p_name: orgName, p_role: "field_technician", p_work_type: "construction")
        )
        struct Contractor: Encodable { let p_contractor_type: String }
        do {
            let _: FieldOrg = try await supabaseRpcOrg(
                path: "/rest/v1/rpc/set_org_contractor_type",
                json: Contractor(p_contractor_type: "other")
            )
        } catch {
            /* optional until the questionnaire migration is applied */
        }
        return org
    }

    private struct OrgRow: Decodable {
        let id: String
        let name: String?
        let join_code: String?
    }

    private func supabaseRpcOrg<Body: Encodable>(path: String, json: Body) async throws -> FieldOrg {
        let data = try await supabaseRestData(path: path, method: "POST", json: json)
        if let row = try? decoder.decode(OrgRow.self, from: data) {
            return FieldOrg(id: row.id, name: row.name?.nilIfEmpty ?? "Organization", joinCode: row.join_code, role: nil)
        }
        if let rows = try? decoder.decode([OrgRow].self, from: data), let row = rows.first {
            return FieldOrg(id: row.id, name: row.name?.nilIfEmpty ?? "Organization", joinCode: row.join_code, role: nil)
        }
        let text = Self.apiErrorMessage(from: data) ?? String(data: data, encoding: .utf8) ?? ""
        throw APIError.http(status: 400, body: text.isEmpty ? "Could not link this phone to an office." : text)
    }

    private func supabaseRestData<Body: Encodable>(
        path: String,
        method: String,
        json: Body
    ) async throws -> Data {
        let url = try makeSupabaseURL(path: path)
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(supabaseAnonKey, forHTTPHeaderField: "apikey")
        if let accessToken {
            request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        }
        request.httpBody = try encoder.encode(json)
        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200 ... 299).contains(status) else {
            let text = Self.apiErrorMessage(from: data) ?? String(data: data, encoding: .utf8) ?? ""
            throw APIError.http(status: status, body: text)
        }
        return data
    }

    private func refreshViaSupabase(refreshToken: String) async throws -> AuthResponse {
        struct Body: Encodable {
            let refresh_token: String
        }
        return try await supabaseAuthToken(grantType: "refresh_token", json: Body(refresh_token: refreshToken))
    }

    private func supabaseAuthToken(grantType: String, json: some Encodable) async throws -> AuthResponse {
        guard var components = URLComponents(url: try makeSupabaseURL(path: "/auth/v1/token"), resolvingAgainstBaseURL: false) else {
            throw APIError.http(status: 0, body: "bad auth url")
        }
        components.queryItems = [URLQueryItem(name: "grant_type", value: grantType)]
        guard let url = components.url else {
            throw APIError.http(status: 0, body: "bad auth url")
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(supabaseAnonKey, forHTTPHeaderField: "apikey")
        request.httpBody = try encoder.encode(json)

        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        let parsed = try? decoder.decode(GoTrueTokenResponse.self, from: data)
        if status == 400 || status == 401 {
            let raw = parsed?.error_description ?? parsed?.msg ?? parsed?.error
                ?? String(data: data, encoding: .utf8) ?? ""
            let lower = raw.lowercased()
            if parsed?.error_code == "invalid_credentials"
                || lower.contains("invalid") || lower.contains("credential") || lower.contains("grant") {
                throw APIError.http(status: 401, body: "Invalid email or password.")
            }
            throw APIError.http(status: 401, body: raw.isEmpty ? "Invalid email or password." : raw)
        }
        guard (200 ... 299).contains(status),
              let access = parsed?.access_token,
              let refresh = parsed?.refresh_token
        else {
            let text = parsed?.error_description ?? parsed?.msg ?? String(data: data, encoding: .utf8) ?? ""
            throw APIError.http(status: status, body: text)
        }
        return AuthResponse(
            user: PublicUser(id: parsed?.user?.id ?? jwtClaim("sub", in: access) ?? "", email: parsed?.user?.email),
            session: SessionTokens(
                accessToken: access,
                refreshToken: refresh,
                expiresIn: parsed?.expires_in,
                expiresAt: parsed?.expires_at
            ),
            needsEmailConfirmation: false,
            message: nil,
            org: nil,
            orgError: nil
        )
    }

    private func supabaseLogout() async throws {
        var request = URLRequest(url: try makeSupabaseURL(path: "/auth/v1/logout"))
        request.httpMethod = "POST"
        request.setValue(supabaseAnonKey, forHTTPHeaderField: "apikey")
        if let accessToken {
            request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        }
        _ = try await URLSession.shared.data(for: request)
    }

    private func fieldMeViaSupabase() async throws -> FieldMe {
        let membership = try await requireMembership()
        let userId = jwtClaim("sub") ?? ""
        let email = jwtClaim("email")
        var fullName: String?
        if !userId.isEmpty {
            let profiles: [ProfileRow] = try await supabaseRest(
                path: "/rest/v1/profiles",
                query: [
                    URLQueryItem(name: "select", value: "full_name"),
                    URLQueryItem(name: "id", value: "eq.\(userId)"),
                ]
            )
            fullName = profiles.first?.full_name
        }
        return FieldMe(
            user: .init(id: userId, email: email, fullName: fullName),
            org: .init(
                id: membership.org_id,
                name: membership.org_name?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
                    ?? "Organization",
                role: membership.role
            )
        )
    }

    private func todayJobsViaSupabase() async throws -> [ExpectedJob] {
        let membership = try await requireMembership()
        let today = Self.todayISODate()
        let jobs: [JobRow] = try await supabaseRest(
            path: "/rest/v1/crm_jobs",
            query: [
                URLQueryItem(name: "select", value: "id,job_number,title,status,scheduled_start,property_id"),
                URLQueryItem(name: "org_id", value: "eq.\(membership.org_id)"),
                URLQueryItem(name: "order", value: "scheduled_start.asc.nullslast"),
                URLQueryItem(name: "limit", value: "200"),
            ]
        )
        let proofs: [ProofRow] = try await supabaseRest(
            path: "/rest/v1/job_proofs",
            query: [
                URLQueryItem(name: "select", value: "job_id"),
                URLQueryItem(name: "org_id", value: "eq.\(membership.org_id)"),
                URLQueryItem(name: "work_date", value: "eq.\(today)"),
            ]
        )
        let filmedIds = Set(proofs.map(\.job_id))
        let picked = Self.pickTodayJobs(jobs, filmedIds: filmedIds, today: today)
        let propertyIds = Array(Set(picked.compactMap(\.property_id)))
        var addressById: [String: String] = [:]
        if !propertyIds.isEmpty {
            let properties: [PropertyRow] = try await supabaseRest(
                path: "/rest/v1/crm_properties",
                query: [
                    URLQueryItem(name: "select", value: "id,address_line1,city"),
                    URLQueryItem(name: "id", value: "in.(\(propertyIds.joined(separator: ",")))"),
                ]
            )
            for property in properties {
                let line = [property.address_line1, property.city]
                    .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
                    .filter { !$0.isEmpty }
                    .joined(separator: ", ")
                if !line.isEmpty { addressById[property.id] = line }
            }
        }
        return picked.map { job in
            let filmed = filmedIds.contains(job.id)
            return ExpectedJob(
                id: job.id,
                number: job.job_number.map { "#\($0)" } ?? "",
                name: job.title?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty ?? "Job",
                address: job.property_id.flatMap { addressById[$0] } ?? "Address on file",
                at: Self.formatTodayAt(job.scheduled_start, filmed: filmed),
                placed: job.property_id.flatMap { addressById[$0] } != nil || filmed,
                status: job.status,
                filmed: filmed
            )
        }
    }

    private func beginProofUploadViaSupabase(
        jobId: String,
        workDate: String,
        phase: String,
        fileExtension: String,
        clipId: String
    ) async throws -> ProofUploadUrlResponse {
        let membership = try await requireMembership()
        let party = try await ensureFieldParty(orgId: membership.org_id, jobId: jobId)
        let resolved = ClipId.resolve(clipId)
        let path = "\(membership.org_id)/\(jobId)/\(party.id)/\(workDate)-\(phase)-\(resolved).\(fileExtension)"
        let uploadUrl = supabaseURL.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            + "/storage/v1/object/job-proofs/" + path
        return ProofUploadUrlResponse(
            path: path,
            clipId: resolved,
            token: nil,
            uploadUrl: uploadUrl,
            chunkSize: nil,
            parts: nil
        )
    }

    private func completeProofViaSupabase(jobId: String, body: ProofRecordBody) async throws -> ProofRecordResponse {
        let membership = try await requireMembership()
        let party = try await ensureFieldParty(orgId: membership.org_id, jobId: jobId)
        struct Insert: Encodable {
            let org_id: String
            let job_id: String
            let party_id: String
            let work_date: String
            let phase: String
            let storage_path: String
            let byte_size: Int64?
            let duration_seconds: Double?
            let content_hash: String?
            let captured_at: String?
            let lat: Double?
            let lon: Double?
            let accuracy_m: Double?
            let state: String
        }
        let rows: [ProofInsertRow] = try await supabaseRest(
            path: "/rest/v1/job_proofs",
            method: "POST",
            query: [
                URLQueryItem(name: "on_conflict", value: "party_id,work_date,phase"),
            ],
            json: Insert(
                org_id: membership.org_id,
                job_id: jobId,
                party_id: party.id,
                work_date: body.workDate,
                phase: body.phase,
                storage_path: body.storagePath,
                byte_size: body.byteSize,
                duration_seconds: body.durationSeconds,
                content_hash: body.contentHash,
                captured_at: body.capturedAt,
                lat: body.lat,
                lon: body.lon,
                accuracy_m: body.accuracyM,
                state: "uploaded"
            ),
            extraHeaders: [
                "Prefer": "resolution=merge-duplicates,return=representation",
            ]
        )
        return ProofRecordResponse(proof: .init(id: rows.first?.id))
    }

    private func requireMembership() async throws -> MembershipRow {
        let rows: [MembershipRow] = try await supabaseRest(
            path: "/rest/v1/rpc/my_org_membership",
            method: "POST",
            json: EmptyJSON()
        )
        guard let membership = rows.first else {
            throw APIError.http(
                status: 403,
                body: "Your account is not linked to an office yet. Open the Atmosphere website and join with the office code."
            )
        }
        return membership
    }

    private func ensureFieldParty(orgId: String, jobId: String) async throws -> PartyRow {
        let existing: [PartyRow] = try await supabaseRest(
            path: "/rest/v1/job_parties",
            query: [
                URLQueryItem(name: "select", value: "id,email"),
                URLQueryItem(name: "org_id", value: "eq.\(orgId)"),
                URLQueryItem(name: "job_id", value: "eq.\(jobId)"),
                URLQueryItem(name: "company", value: "eq.\"Field Capture\""),
                URLQueryItem(name: "revoked_at", value: "is.null"),
                URLQueryItem(name: "limit", value: "5"),
            ]
        )
        let email = jwtClaim("email")
        if let match = existing.first(where: { $0.email == email }) ?? existing.first {
            return match
        }
        struct Insert: Encodable {
            let org_id: String
            let job_id: String
            let company: String
            let trade: String
            let contact_name: String
            let email: String?
            let role: String
            let created_by: String?
        }
        let created: [PartyRow] = try await supabaseRest(
            path: "/rest/v1/job_parties",
            method: "POST",
            json: Insert(
                org_id: orgId,
                job_id: jobId,
                company: "Field Capture",
                trade: "field_capture",
                contact_name: "Field Capture",
                email: email,
                role: "general_contractor",
                created_by: jwtClaim("sub")
            ),
            extraHeaders: ["Prefer": "return=representation"]
        )
        guard let party = created.first else {
            throw APIError.http(status: 400, body: "Could not open Field Capture on this job.")
        }
        return party
    }

    private func makeSupabaseURL(path: String, query: [URLQueryItem] = []) throws -> URL {
        let origin = supabaseURL.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let suffix = path.hasPrefix("/") ? path : "/" + path
        guard var components = URLComponents(string: origin + suffix) else {
            throw APIError.http(status: 0, body: "bad url \(path)")
        }
        if !query.isEmpty { components.queryItems = query }
        guard let url = components.url else {
            throw APIError.http(status: 0, body: "bad url \(path)")
        }
        return url
    }

    private func supabaseRest<T: Decodable>(
        path: String,
        method: String = "GET",
        query: [URLQueryItem] = [],
        extraHeaders: [String: String] = [:],
        isRetry: Bool = false
    ) async throws -> T {
        try await supabaseRest(
            path: path,
            method: method,
            query: query,
            json: Optional<EmptyJSON>.none,
            extraHeaders: extraHeaders,
            isRetry: isRetry
        )
    }

    private func supabaseRest<T: Decodable, Body: Encodable>(
        path: String,
        method: String = "GET",
        query: [URLQueryItem] = [],
        json: Body?,
        extraHeaders: [String: String] = [:],
        isRetry: Bool = false
    ) async throws -> T {
        let url = try makeSupabaseURL(path: path, query: query)
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(supabaseAnonKey, forHTTPHeaderField: "apikey")
        if let accessToken {
            request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        }
        for (key, value) in extraHeaders {
            request.setValue(value, forHTTPHeaderField: key)
        }
        if let json {
            request.httpBody = try encoder.encode(json)
        }

        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if status == 401, !isRetry, let onUnauthorized {
            try await onUnauthorized()
            return try await supabaseRest(
                path: path,
                method: method,
                query: query,
                json: json,
                extraHeaders: extraHeaders,
                isRetry: true
            )
        }
        guard (200 ... 299).contains(status) else {
            let text = Self.apiErrorMessage(from: data) ?? String(data: data, encoding: .utf8) ?? ""
            throw APIError.http(status: status, body: text)
        }
        if data.isEmpty, T.self == Ack.self {
            return Ack() as! T
        }
        return try decoder.decode(T.self, from: data)
    }

    private func jwtClaim(_ name: String, in token: String? = nil) -> String? {
        guard let token = token ?? accessToken else { return nil }
        let parts = token.split(separator: ".")
        guard parts.count >= 2 else { return nil }
        var b64 = String(parts[1])
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        while b64.count % 4 != 0 { b64.append("=") }
        guard let data = Data(base64Encoded: b64),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return nil }
        if let value = obj[name] as? String { return value }
        if let value = obj[name] as? NSNumber { return value.stringValue }
        return nil
    }

    private static func todayISODate() -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = .current
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: Date())
    }

    private static func pickTodayJobs(_ jobs: [JobRow], filmedIds: Set<String>, today _: String) -> [JobRow] {
        let closed: Set<String> = ["cancelled"]
        let open: Set<String> = ["draft", "scheduled", "in_progress", "on_hold"]
        var list: [JobRow] = []
        for job in jobs {
            let status = job.status ?? ""
            if filmedIds.contains(job.id) {
                list.append(job)
                continue
            }
            if closed.contains(status) { continue }
            if open.contains(status) { list.append(job) }
        }
        return list
    }

    private static func formatTodayAt(_ iso: String?, filmed: Bool) -> String {
        if filmed { return "Filmed" }
        guard let iso else { return "" }
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let basic = ISO8601DateFormatter()
        basic.formatOptions = [.withInternetDateTime]
        guard let date = fractional.date(from: iso) ?? basic.date(from: iso) else { return "Today" }
        let formatter = DateFormatter()
        formatter.timeStyle = .short
        formatter.dateStyle = .none
        return formatter.string(from: date)
    }

    static func isUnreachable(_ error: Error) -> Bool {
        if let urlError = error as? URLError {
            switch urlError.code {
            case .cannotConnectToHost, .cannotFindHost, .timedOut, .notConnectedToInternet,
                 .networkConnectionLost, .dnsLookupFailed:
                return true
            default:
                break
            }
        }
        let ns = error as NSError
        if ns.domain == NSURLErrorDomain {
            switch ns.code {
            case NSURLErrorCannotConnectToHost, NSURLErrorCannotFindHost, NSURLErrorTimedOut,
                 NSURLErrorNotConnectedToInternet, NSURLErrorNetworkConnectionLost, NSURLErrorDNSLookupFailed:
                return true
            default:
                break
            }
        }
        return false
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
        let data = try encoder.encode(body)
        return try await send(path: path, method: "POST", bodyData: data, authed: authed)
    }

    private func send<Response: Decodable>(
        path: String,
        method: String,
        bodyData: Data?,
        authed: Bool,
        isRetry: Bool = false
    ) async throws -> Response {
        let origin = bffURL ?? baseURL
        guard let url = URL(string: path, relativeTo: origin)?.absoluteURL else {
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
        return try decoder.decode(Response.self, from: data)
    }

    /// Prefer the BFF's `{ error }` field over a raw JSON blob.
    private static func apiErrorMessage(from data: Data) -> String? {
        guard
            let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return nil }
        if let error = obj["error"] as? String {
            let trimmed = error.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty { return trimmed }
        }
        if let message = obj["message"] as? String {
            let trimmed = message.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty { return trimmed }
        }
        if let description = obj["error_description"] as? String {
            let trimmed = description.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty { return trimmed }
        }
        return nil
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

private extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}
