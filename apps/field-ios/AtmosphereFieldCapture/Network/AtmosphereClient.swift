import Foundation

/**
 * REST client for Atmosphere Field Capture.
 *
 * Sign-in uses the same Atmosphere account as the website (Supabase Auth).
 * Today’s jobs are loaded from that project. A local Express BFF is used
 * when one is actually reachable (Xcode simulator + `npm run dev`).
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
        if usesBFF {
            do {
                return try await post(
                    path: "/api/field-app/jobs/\(jobId)/proof/upload-url",
                    body: Body(workDate: workDate, phase: phase, extension: fileExtension)
                )
            } catch {
                if !Self.isUnreachable(error) { throw error }
            }
        }
        return try await beginProofUploadViaSupabase(
            jobId: jobId,
            workDate: workDate,
            phase: phase,
            fileExtension: fileExtension
        )
    }

    /// PUT to a BFF signed URL, or POST straight into the Atmosphere storage bucket.
    func uploadProofMedia(localURL: URL, begin: ProofUploadUrlResponse) async throws -> (byteSize: Int64, sha256Hex: String) {
        guard let uploadURL = URL(string: begin.uploadUrl) else {
            throw APIError.http(status: 0, body: "Bad upload URL")
        }
        let isStorage = begin.uploadUrl.contains("/storage/v1/object/")
        var headers: [String: String] = ["Content-Type": "video/mp4"]
        if isStorage {
            headers["apikey"] = supabaseAnonKey
            if let accessToken {
                headers["Authorization"] = "Bearer \(accessToken)"
            }
            headers["x-upsert"] = "true"
        }
        return try await MediaUploadClient.uploadFile(
            localURL: localURL,
            uploadURL: uploadURL,
            method: isStorage ? "POST" : "PUT",
            headers: headers
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
            )
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
                placed: job.scheduled_start != nil || filmed,
                status: job.status,
                filmed: filmed
            )
        }
    }

    private func beginProofUploadViaSupabase(
        jobId: String,
        workDate: String,
        phase: String,
        fileExtension: String
    ) async throws -> ProofUploadUrlResponse {
        let membership = try await requireMembership()
        let party = try await ensureFieldParty(orgId: membership.org_id, jobId: jobId)
        let path = "\(membership.org_id)/\(jobId)/\(party.id)/\(workDate)-\(phase).\(fileExtension)"
        let uploadUrl = supabaseURL.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            + "/storage/v1/object/job-proofs/" + path
        return ProofUploadUrlResponse(path: path, token: nil, uploadUrl: uploadUrl)
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

    private static func pickTodayJobs(_ jobs: [JobRow], filmedIds: Set<String>, today: String) -> [JobRow] {
        func day(_ iso: String?) -> String? {
            guard let iso, iso.count >= 10 else { return nil }
            return String(iso.prefix(10))
        }
        let closed: Set<String> = ["cancelled"]
        let open: Set<String> = ["draft", "scheduled", "in_progress", "on_hold"]
        var todayJobs: [JobRow] = []
        var fallback: [JobRow] = []
        for job in jobs {
            let status = job.status ?? ""
            if closed.contains(status) {
                if filmedIds.contains(job.id) { todayJobs.append(job) }
                continue
            }
            if filmedIds.contains(job.id) || day(job.scheduled_start) == today || status == "in_progress" {
                todayJobs.append(job)
            } else if open.contains(status) {
                fallback.append(job)
            }
        }
        return todayJobs.isEmpty ? fallback : todayJobs
    }

    private static func formatTodayAt(_ iso: String?, filmed: Bool) -> String {
        if filmed { return "Filmed" }
        guard let iso else { return "Today" }
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
