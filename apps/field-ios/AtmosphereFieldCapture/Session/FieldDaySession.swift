import Foundation

/// Orchestrates today → record (A/V) → door. Day films save on the phone and
/// file to the Atmosphere dashboard when a path is available.
@MainActor
final class FieldDaySession: ObservableObject {
    @Published var phase: FieldPhase = .today
    @Published var tab: FieldTab = .today
    @Published var jobs: [ExpectedJob] = []
    @Published var assignedJobs: [ExpectedJob] = []
    @Published var jobSearch: String = ""
    @Published var activeJobId: String?
    @Published var elapsedSeconds: Int = 0
    @Published var siteLabel: String = "Getting your bearings…"
    @Published var doorChecks: [DoorCheck] = []
    @Published var twinRooms: [TwinRoomSummary] = []
    @Published var lastError: String?
    @Published var uploading: Bool = false
    @Published var creatingJob: Bool = false
    @Published var manifest: DayFilmManifest?
    @Published var loadingJobs: Bool = false
    @Published var showInvite = false
    @Published var invitePaste = ""
    @Published var acceptName = ""
    @Published var acceptingBrief = false
    @Published var uploadProgress: Double = 0
    @Published var queuedUploads: [PendingDayUpload] = []
    @Published var filmFiled = false
    @Published var measureOffer: MeasureOffer?
    @Published var measureReturn: MeasureReturn = .door
    @Published var shareJob: AtmosphereClient.ShareJobView?
    @Published var reviewingToken: String?

    let recorder = DayFilmRecorder()
    let locator = SiteLocator()
    let roomPlan = RoomPlanBridge()
    let reachability = UploadReachability()
    private var processingQueue = false

    var queueBanner: String? {
        let waiting = queuedUploads.filter { !$0.filed }
        guard !waiting.isEmpty else { return nil }
        if uploading {
            let pct = Int(uploadProgress * 100)
            return waiting.count == 1
                ? "Sending the day film to the dashboard… \(pct)%"
                : "Sending \(waiting.count) day films to the dashboard… \(pct)%"
        }
        if !reachability.isOnline {
            return waiting.count == 1
                ? "Saved on this phone — files when you’re online."
                : "\(waiting.count) day films saved on this phone — file when you’re online."
        }
        return "Saved on this phone — sending when the signal holds."
    }

    func inviteToken(for jobId: String?) -> String? {
        guard let jobId else { return nil }
        return AcceptedInviteStore.token(for: jobId)
    }

    func needsMeasurements(for jobId: String?) -> Bool {
        guard let jobId, !jobId.isEmpty else { return true }
        if MeasuredJobStore.contains(jobId) { return false }
        if !roomPlan.rooms.isEmpty { return false }
        return true
    }

    func loadToday(api: AtmosphereClient) async {
        loadingJobs = true
        lastError = nil
        defer { loadingJobs = false }
        do {
            async let today = api.todayJobs()
            async let mine = api.assignedJobs()
            let list = try await today
            let assigned = try await mine
            jobs = mergeInvites(list)
            assignedJobs = assigned
            let pool = jobs + assignedJobs
            if activeJobId == nil || !pool.contains(where: { $0.id == activeJobId }) {
                activeJobId = jobs.first?.id ?? assigned.first?.id
            }
        } catch {
            lastError = error.localizedDescription
            jobs = mergeInvites([])
            assignedJobs = []
        }
    }

    func refreshHistory(api: AtmosphereClient) async {
        do {
            assignedJobs = try await api.assignedJobs(query: jobSearch)
        } catch {
            lastError = error.localizedDescription
        }
    }

    func createJob(
        api: AtmosphereClient,
        name: String,
        address: String,
        city: String,
        notes: String
    ) async -> Bool {
        creatingJob = true
        lastError = nil
        defer { creatingJob = false }
        do {
            let job = try await api.createFieldJob(
                name: name,
                address: address,
                city: city.isEmpty ? nil : city,
                notes: notes.isEmpty ? nil : notes
            )
            if !jobs.contains(where: { $0.id == job.id }) {
                jobs.insert(job, at: 0)
            }
            activeJobId = job.id
            tab = .today
            return true
        } catch {
            lastError = error.localizedDescription
            return false
        }
    }

    func beginInvite() {
        lastError = nil
        shareJob = nil
        reviewingToken = nil
        invitePaste = ""
        showInvite = true
    }

    func openInvite(api: AtmosphereClient, raw: String) async {
        lastError = nil
        guard let token = ShareLink.token(from: raw) else {
            lastError = "That invite link is not valid."
            showInvite = true
            return
        }
        PendingInviteStore.save(token)
        do {
            let view = try await api.loadShareJob(token: token)
            reviewingToken = token
            shareJob = view
            showInvite = true
            if acceptName.trimmingCharacters(in: .whitespacesAndNewlines).count < 2 {
                acceptName = ""
            }
        } catch {
            lastError = error.localizedDescription
            showInvite = true
        }
    }

    func consumePendingInvite(api: AtmosphereClient) async {
        guard let token = PendingInviteStore.load() else { return }
        await openInvite(api: api, raw: token)
    }

    func dismissInvite() {
        showInvite = false
        PendingInviteStore.clear()
    }

    func acceptBrief(api: AtmosphereClient, signedInName: String?) async -> Bool {
        guard let token = reviewingToken else {
            lastError = "Paste an invite link to accept a job."
            return false
        }
        var name = acceptName.trimmingCharacters(in: .whitespacesAndNewlines)
        if name.count < 2 {
            name = (signedInName ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        }
        acceptingBrief = true
        lastError = nil
        defer { acceptingBrief = false }
        do {
            let job = try await api.acceptFieldInvite(token: token, name: name.isEmpty ? nil : name)
            addAcceptedJob(job, shareToken: nil)
            PendingInviteStore.clear()
            showInvite = false
            tab = .today
            phase = .today
            return true
        } catch {
            if let revision = shareJob?.currentRevision, name.count >= 2 {
                do {
                    try await api.acceptShareBrief(token: token, name: name, revision: revision)
                    let job = jobFromShare(token: token)
                    addAcceptedJob(job, shareToken: token)
                    PendingInviteStore.clear()
                    showInvite = false
                    tab = .today
                    phase = .today
                    return true
                } catch {
                    lastError = error.localizedDescription
                    return false
                }
            }
            lastError = error.localizedDescription
            return false
        }
    }

    func restorePendingUpload(api: AtmosphereClient) async {
        queuedUploads = PendingUploadStore.loadAll()
        reachability.onOnline = { [weak self] in
            guard let self else { return }
            Task { await self.processQueue(api: api) }
        }
        reachability.start()
        await processQueue(api: api)
    }

    func selectJob(_ id: String) {
        activeJobId = id
        tab = .today
        phase = .today
    }

    func requestStartDay() {
        lastError = nil
        let pool = jobs + assignedJobs.filter { job in !jobs.contains(where: { $0.id == job.id }) }
        guard activeJobId != nil || !pool.isEmpty else {
            lastError = "No job assigned to you. Add a job from this phone, accept an invite, or ask the office to put you on one."
            return
        }
        if activeJobId == nil { activeJobId = pool.first?.id }
        if needsMeasurements(for: activeJobId) {
            measureOffer = .beforeRecord
            return
        }
        Task { await beginRecording() }
    }

    func acceptMeasureOffer() {
        measureReturn = measureOffer == .beforeRecord ? .record : .door
        measureOffer = nil
        roomPlan.detectCapabilities()
        phase = .measuring
    }

    func declineMeasureOffer() {
        let offer = measureOffer
        measureOffer = nil
        if offer == .beforeRecord {
            Task { await beginRecording() }
        }
    }

    func beginRecording() async {
        lastError = nil
        let pool = jobs + assignedJobs.filter { job in !jobs.contains(where: { $0.id == job.id }) }
        do {
            try await recorder.prepare()
            locator.configure(jobs: pool)
            locator.start()
            try recorder.startDay()
            phase = .recording
        } catch {
            lastError = error.localizedDescription
            phase = .today
        }
    }

    func tickFromRecorder() {
        elapsedSeconds = recorder.elapsedSeconds
        siteLabel = locator.siteLabel
    }

    func finishDay(api: AtmosphereClient) async {
        lastError = nil
        do {
            let temp = try await recorder.finishDay()
            locator.stop()
            let tracks = try await DayFilmRecorder.probeTracks(url: temp)
            guard tracks.hasAudio, tracks.hasVideo else {
                throw CaptureError.missingAudio
            }
            guard let jobId = activeJobId ?? jobs.first?.id else {
                throw APIError.http(status: 0, body: "No job selected for this day film.")
            }
            let durable = try PendingUploadStore.persistRecording(temp)
            let pending = PendingDayUpload(
                localPath: durable.path,
                jobId: jobId,
                shareToken: inviteToken(for: jobId),
                workDate: Self.todayStamp(),
                durationSeconds: tracks.duration,
                lat: locator.coordinate?.latitude,
                lon: locator.coordinate?.longitude
            )
            PendingUploadStore.upsert(pending)
            queuedUploads = PendingUploadStore.loadAll()
            filmFiled = false
            recorder.teardown()
            applyDoorDraft(jobId: jobId, filed: false)
            if needsMeasurements(for: jobId) {
                measureOffer = .afterRecord
            }
            phase = .door
            Task { await processQueue(api: api) }
        } catch {
            lastError = error.localizedDescription
            phase = .door
            doorChecks = [
                DoorCheck(id: "err", label: "Save issue", detail: error.localizedDescription, ok: false),
            ]
        }
    }

    func processQueue(api: AtmosphereClient) async {
        guard !processingQueue else { return }
        processingQueue = true
        defer { processingQueue = false }
        queuedUploads = PendingUploadStore.loadAll()
        for item in queuedUploads where !item.filed {
            await sendOne(item, api: api)
        }
        queuedUploads = PendingUploadStore.loadAll()
    }

    func skipMeasure() {
        if measureReturn == .record {
            Task { await beginRecording() }
            return
        }
        applyTwinFallback(pending: true)
        refreshDoorTwin()
        phase = .door
    }

    func finishMeasure(api: AtmosphereClient) async {
        lastError = nil
        let rooms = roomPlan.asIngestRooms()
        let jobId = activeJobId ?? queuedUploads.last?.jobId
        guard !rooms.isEmpty else {
            skipMeasure()
            return
        }
        do {
            var mesh: AtmosphereClient.IngestBody.MeshPayload?
            if let meshURL = roomPlan.meshLocalURL, let jobId {
                let begin = try await api.beginMeshUpload(jobId: jobId, shareToken: inviteToken(for: jobId))
                _ = try await api.uploadMesh(localURL: meshURL, begin: begin)
                if let download = begin.downloadUrl {
                    mesh = .init(format: "usdz", url: download, producedBy: "roomplan")
                }
            }
            let geo = try await api.openGeometrySession(
                lidarAvailable: roomPlan.lidarAvailable,
                label: "Field day \(Self.todayStamp())",
                videoRef: manifest?.videoRef
            )
            try await api.ingestGeometry(
                sessionId: geo.session.id,
                body: .init(
                    source: "roomplan",
                    rooms: rooms,
                    mesh: mesh,
                    videoRef: manifest?.videoRef,
                    work: nil
                )
            )
            if var next = manifest {
                next.twinId = geo.twin.id
                next.geometrySessionId = geo.session.id
                manifest = next
            }
            twinRooms = rooms.map {
                TwinRoomSummary(
                    id: $0.name,
                    name: $0.name,
                    detail: $0.floorAreaSqFt.map { "\(Int($0)) SF" }
                        ?? "\($0.lengthFt ?? 0)×\($0.widthFt ?? 0) ft"
                )
            }
            if let jobId { MeasuredJobStore.add(jobId) }
            if measureReturn == .record {
                phase = .today
                await beginRecording()
            } else {
                refreshDoorTwin()
                phase = .door
            }
        } catch {
            lastError = error.localizedDescription
            if let jobId { MeasuredJobStore.add(jobId) }
            twinRooms = rooms.map {
                TwinRoomSummary(
                    id: $0.name,
                    name: $0.name,
                    detail: $0.floorAreaSqFt.map { "\(Int($0)) SF" } ?? "Measured on this phone"
                )
            }
            if measureReturn == .record {
                await beginRecording()
            } else {
                refreshDoorTwin()
                phase = .door
            }
        }
    }

    func backToToday() {
        phase = .today
        elapsedSeconds = 0
        lastError = nil
        measureOffer = nil
    }

    private func sendOne(_ seed: PendingDayUpload, api: AtmosphereClient) async {
        var pending = seed
        uploading = true
        lastError = nil
        MediaUploadClient.shared.onProgress = { [weak self] value in
            Task { @MainActor in
                self?.uploadProgress = value
            }
        }
        defer {
            uploading = false
            MediaUploadClient.shared.onProgress = nil
        }
        do {
            let file = URL(fileURLWithPath: pending.localPath)
            guard FileManager.default.fileExists(atPath: file.path) else {
                PendingUploadStore.remove(id: pending.id)
                return
            }
            pending.attempt += 1
            PendingUploadStore.upsert(pending)
            queuedUploads = PendingUploadStore.loadAll()

            let begin: AtmosphereClient.ProofUploadUrlResponse
            if let token = pending.shareToken, !token.isEmpty {
                begin = try await api.beginShareProofUpload(token: token, workDate: pending.workDate)
            } else {
                begin = try await api.beginJobProofUpload(jobId: pending.jobId, workDate: pending.workDate)
            }
            pending.storagePath = begin.path
            pending.uploadUrl = begin.uploadUrl
            PendingUploadStore.upsert(pending)

            let uploaded = try await api.uploadProofMedia(localURL: file, begin: begin)
            pending.byteSize = uploaded.byteSize
            pending.sha256Hex = uploaded.sha256Hex
            PendingUploadStore.upsert(pending)

            let iso = ISO8601DateFormatter().string(from: Date())
            let body = AtmosphereClient.ProofRecordBody(
                workDate: pending.workDate,
                phase: "after",
                storagePath: begin.path,
                byteSize: uploaded.byteSize,
                durationSeconds: pending.durationSeconds,
                contentHash: uploaded.sha256Hex,
                capturedAt: iso,
                lat: pending.lat,
                lon: pending.lon,
                accuracyM: nil
            )
            let recorded: AtmosphereClient.ProofRecordResponse
            if let token = pending.shareToken, !token.isEmpty {
                recorded = try await api.completeShareProof(token: token, body: body)
            } else {
                recorded = try await api.completeJobProof(jobId: pending.jobId, body: body)
            }

            uploadProgress = 1
            markFilmed(jobId: pending.jobId)
            manifest = DayFilmManifest(
                mediaId: recorded.proof?.id,
                sessionId: nil,
                twinId: manifest?.twinId,
                geometrySessionId: manifest?.geometrySessionId,
                videoRef: recorded.proof?.id ?? begin.path,
                durationSeconds: pending.durationSeconds,
                byteSize: uploaded.byteSize,
                contentType: "video/mp4",
                hasAudio: true,
                hasVideo: true,
                capturedAt: Date()
            )
            filmFiled = true
            try? FileManager.default.removeItem(atPath: pending.localPath)
            PendingUploadStore.remove(id: pending.id)
            applyDoorDraft(jobId: pending.jobId, filed: true)
        } catch {
            lastError = error.localizedDescription
        }
    }

    private func applyDoorDraft(jobId: String, filed: Bool) {
        let jobName = (jobs + assignedJobs).first(where: { $0.id == jobId })?.name ?? shareJob?.job.title ?? jobId
        doorChecks = [
            DoorCheck(id: "1", label: "Filmed on site", detail: siteLabel, ok: true),
            DoorCheck(id: "2", label: "Video + audio sealed", detail: "mic track present", ok: true),
            DoorCheck(
                id: "3",
                label: filed ? "Filed to \(jobName)" : "Saved on this phone",
                detail: filed ? "office evidence library" : "uploads when you’re online",
                ok: true
            ),
            DoorCheck(
                id: "4",
                label: "Building measurements",
                detail: MeasuredJobStore.contains(jobId)
                    ? (twinRooms.first?.name ?? "On file")
                    : (twinRooms.first?.name ?? "Not taken"),
                ok: MeasuredJobStore.contains(jobId) || !twinRooms.isEmpty
            ),
        ]
        if twinRooms.isEmpty && !MeasuredJobStore.contains(jobId) {
            twinRooms = [
                TwinRoomSummary(
                    id: "pending",
                    name: "Measurements not taken",
                    detail: "Offer again only if this job still has none"
                ),
            ]
        }
    }

    private func refreshDoorTwin() {
        guard let jobId = activeJobId ?? queuedUploads.last?.jobId else { return }
        applyDoorDraft(jobId: jobId, filed: filmFiled)
        if !twinRooms.contains(where: { $0.id == "pending" }) {
            // keep measured rooms
        }
    }

    private func applyTwinFallback(pending: Bool) {
        if pending {
            twinRooms = [
                TwinRoomSummary(
                    id: "pending",
                    name: "Measurements skipped",
                    detail: "Day film is saved · measure later if this job still has none"
                ),
            ]
        } else {
            twinRooms = [
                TwinRoomSummary(
                    id: "skip",
                    name: "Measurements deferred",
                    detail: "Day film is saved; measure can retry later"
                ),
            ]
        }
    }

    private func addAcceptedJob(_ job: ExpectedJob, shareToken: String?) {
        if !jobs.contains(where: { $0.id == job.id }) {
            jobs.insert(job, at: 0)
        }
        activeJobId = job.id
        if let shareToken, !shareToken.isEmpty {
            AcceptedInviteStore.upsert(AcceptedInviteJob(job: job, shareToken: shareToken))
        } else {
            let kept = AcceptedInviteStore.load().filter { $0.job.id != job.id }
            AcceptedInviteStore.save(kept)
        }
    }

    private func mergeInvites(_ server: [ExpectedJob]) -> [ExpectedJob] {
        var merged = server
        for invite in AcceptedInviteStore.load() {
            if !merged.contains(where: { $0.id == invite.job.id }) {
                merged.insert(invite.job, at: 0)
            }
        }
        return merged
    }

    private func jobFromShare(token: String) -> ExpectedJob {
        let view = shareJob
        return ExpectedJob(
            id: view.flatMap { _ in token } ?? token,
            number: view?.job.jobNumber.map { "#\($0)" } ?? "",
            name: view?.job.title ?? "Job",
            address: view?.brief?.facts?["address"] ?? view?.you?.company ?? "Invite",
            at: "Today",
            placed: true,
            assigned: true,
            role: view?.you?.role
        )
    }

    private func markFilmed(jobId: String) {
        let stamp = Self.todayStamp()
        if let filmed = (jobs + assignedJobs).first(where: { $0.id == jobId }) {
            let record = ExpectedJob(
                id: filmed.id,
                number: filmed.number,
                name: filmed.name,
                address: filmed.address,
                at: stamp,
                placed: true,
                status: filmed.status,
                filmed: true,
                filmedOn: stamp,
                assigned: true,
                role: filmed.role,
                workType: filmed.workType
            )
            assignedJobs.removeAll { $0.id == record.id }
            assignedJobs.insert(record, at: 0)
            if let idx = jobs.firstIndex(where: { $0.id == record.id }) {
                jobs[idx] = record
            }
        }
    }

    private static func todayStamp() -> String {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = .current
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: Date())
    }
}
