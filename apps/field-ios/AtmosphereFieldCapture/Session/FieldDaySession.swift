import Foundation

/// Orchestrates today → record (A/V) → door → upload into the org evidence library.
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
    @Published var shareToken: String?
    @Published var shareJob: AtmosphereClient.ShareJobView?
    @Published var showInvite = false
    @Published var acceptName = ""
    @Published var acceptingBrief = false
    @Published var uploadProgress: Double = 0
    @Published var sendingDetail = "Still sending your day film…"
    @Published var pendingUpload: PendingDayUpload?

    let recorder = DayFilmRecorder()
    let locator = SiteLocator()
    let roomPlan = RoomPlanBridge()

    var isShareMode: Bool { shareToken != nil }

    func loadToday(api: AtmosphereClient) async {
        if isShareMode { return }
        loadingJobs = true
        lastError = nil
        defer { loadingJobs = false }
        do {
            async let today = api.todayJobs()
            async let mine = api.assignedJobs()
            let list = try await today
            let assigned = try await mine
            jobs = list
            assignedJobs = assigned
            let pool = list + assigned
            if activeJobId == nil || !pool.contains(where: { $0.id == activeJobId }) {
                activeJobId = list.first?.id ?? assigned.first?.id
            }
        } catch {
            lastError = error.localizedDescription
            jobs = []
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

    func openInvite(api: AtmosphereClient, raw: String) async {
        lastError = nil
        guard let token = ShareLink.token(from: raw) else {
            lastError = "That invite link is not valid."
            showInvite = true
            return
        }
        do {
            let view = try await api.loadShareJob(token: token)
            shareToken = token
            shareJob = view
            showInvite = true
            acceptName = ""
            let job = ExpectedJob(
                id: token,
                number: view.job.jobNumber.map { "#\($0)" } ?? "",
                name: view.job.title ?? "Job",
                address: view.brief?.facts?["address"] ?? view.you?.company ?? "Invite",
                at: "Today",
                placed: true,
                assigned: true,
                role: view.you?.role
            )
            jobs = [job]
            activeJobId = job.id
        } catch {
            lastError = error.localizedDescription
            showInvite = true
        }
    }

    func dismissInvite() {
        if shareJob == nil {
            showInvite = false
            shareToken = nil
        } else if shareJob?.clear == true || shareJob?.acknowledgedRevision == shareJob?.currentRevision {
            showInvite = false
        } else {
            showInvite = false
            shareToken = nil
            shareJob = nil
        }
    }

    func acceptBrief(api: AtmosphereClient) async -> Bool {
        guard let token = shareToken, let revision = shareJob?.currentRevision else {
            lastError = "This invite has no brief to accept yet."
            return false
        }
        let name = acceptName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard name.count >= 2 else {
            lastError = "Type your name to accept the brief."
            return false
        }
        acceptingBrief = true
        lastError = nil
        defer { acceptingBrief = false }
        do {
            try await api.acceptShareBrief(token: token, name: name, revision: revision)
            shareJob = try? await api.loadShareJob(token: token)
            showInvite = false
            tab = .today
            phase = .today
            return true
        } catch {
            lastError = error.localizedDescription
            return false
        }
    }

    func restorePendingUpload(api: AtmosphereClient) async {
        guard let pending = PendingUploadStore.load() else { return }
        let url = URL(fileURLWithPath: pending.localPath)
        guard FileManager.default.fileExists(atPath: url.path) else {
            PendingUploadStore.clear()
            return
        }
        pendingUpload = pending
        shareToken = pending.shareToken
        activeJobId = pending.jobId
        phase = .sending
        sendingDetail = "Still sending your day film…"
        await sendPending(api: api)
    }

    func selectJob(_ id: String) {
        activeJobId = id
        tab = .today
        phase = .today
    }

    func startDay() async {
        lastError = nil
        let pool = jobs + assignedJobs.filter { job in !jobs.contains(where: { $0.id == job.id }) }
        if let share = shareJob, share.clear == false,
           share.acknowledgedRevision != share.currentRevision
        {
            lastError = share.because ?? "Accept the brief before you film."
            showInvite = true
            return
        }
        guard activeJobId != nil || !pool.isEmpty else {
            lastError = "No job assigned to you. Add a job from this phone, or ask the office to put you on one."
            return
        }
        if activeJobId == nil { activeJobId = pool.first?.id }
        do {
            try await recorder.prepare()
            locator.configure(jobs: pool)
            locator.start()
            try recorder.startDay()
            phase = .recording
        } catch {
            lastError = error.localizedDescription
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
            var pending = PendingDayUpload(
                localPath: durable.path,
                jobId: jobId,
                shareToken: shareToken,
                workDate: Self.todayStamp(),
                durationSeconds: tracks.duration,
                lat: locator.coordinate?.latitude,
                lon: locator.coordinate?.longitude,
                storagePath: nil,
                uploadUrl: nil,
                byteSize: nil,
                sha256Hex: nil,
                attempt: 0
            )
            PendingUploadStore.save(pending)
            pendingUpload = pending
            uploadProgress = 0
            sendingDetail = "Still sending your day film…"
            recorder.teardown()
            phase = .sending
            await sendPending(api: api)
        } catch {
            lastError = error.localizedDescription
            phase = .door
            doorChecks = [
                DoorCheck(id: "err", label: "Upload issue", detail: error.localizedDescription, ok: false),
            ]
        }
    }

    func sendPending(api: AtmosphereClient) async {
        guard var pending = pendingUpload else { return }
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
            pending.attempt += 1
            sendingDetail = pending.attempt > 1
                ? "Signal dropped — retrying the same film…"
                : "Still sending your day film…"
            let begin: AtmosphereClient.ProofUploadUrlResponse
            if let token = pending.shareToken, !token.isEmpty {
                begin = try await api.beginShareProofUpload(token: token, workDate: pending.workDate)
            } else {
                begin = try await api.beginJobProofUpload(jobId: pending.jobId, workDate: pending.workDate)
            }
            pending.storagePath = begin.path
            pending.uploadUrl = begin.uploadUrl
            PendingUploadStore.save(pending)
            pendingUpload = pending

            let uploaded = try await api.uploadProofMedia(localURL: file, begin: begin)
            pending.byteSize = uploaded.byteSize
            pending.sha256Hex = uploaded.sha256Hex
            PendingUploadStore.save(pending)

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
                twinId: nil,
                geometrySessionId: nil,
                videoRef: recorded.proof?.id ?? begin.path,
                durationSeconds: pending.durationSeconds,
                byteSize: uploaded.byteSize,
                contentType: "video/mp4",
                hasAudio: true,
                hasVideo: true,
                capturedAt: Date()
            )
            roomPlan.detectCapabilities()
            sendingDetail = "Day film is filed. Measure the property when you can."
            phase = .measuring
        } catch {
            lastError = error.localizedDescription
            sendingDetail = "Still holding the film on this phone. We’ll send it when the signal holds."
        }
    }

    func skipMeasure() {
        applyTwinFallback(pending: true)
        finishToDoor()
    }

    func finishMeasure(api: AtmosphereClient) async {
        lastError = nil
        let rooms = roomPlan.asIngestRooms()
        guard !rooms.isEmpty else {
            skipMeasure()
            return
        }
        do {
            var mesh: AtmosphereClient.IngestBody.MeshPayload?
            if let meshURL = roomPlan.meshLocalURL, let jobId = pendingUpload?.jobId ?? activeJobId {
                let begin = try await api.beginMeshUpload(jobId: jobId, shareToken: shareToken)
                _ = try await api.uploadMesh(localURL: meshURL, begin: begin)
                if let download = begin.downloadUrl {
                    mesh = .init(format: "usdz", url: download, producedBy: "roomplan")
                }
            }
            if !isShareMode {
                let geo = try await api.openGeometrySession(
                    lidarAvailable: roomPlan.lidarAvailable,
                    label: "Field day \(pendingUpload?.workDate ?? Self.todayStamp())",
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
            }
            twinRooms = rooms.map {
                TwinRoomSummary(
                    id: $0.name,
                    name: $0.name,
                    detail: $0.floorAreaSqFt.map { "\(Int($0)) SF" }
                        ?? "\($0.lengthFt ?? 0)×\($0.widthFt ?? 0) ft"
                )
            }
            finishToDoor()
        } catch {
            lastError = error.localizedDescription
            applyTwinFallback(pending: false)
            finishToDoor()
        }
    }

    private func applyTwinFallback(pending: Bool) {
        if pending {
            twinRooms = [
                TwinRoomSummary(
                    id: "pending",
                    name: "Twin pending measure",
                    detail: "Video + audio filed · RoomPlan pass when available"
                ),
            ]
        } else {
            twinRooms = [
                TwinRoomSummary(
                    id: "skip",
                    name: "Twin deferred",
                    detail: "Day film is filed; twin measure can retry later"
                ),
            ]
        }
    }

    private func finishToDoor() {
        let jobId = pendingUpload?.jobId ?? activeJobId ?? ""
        let jobName = (jobs + assignedJobs).first(where: { $0.id == jobId })?.name ?? shareJob?.job.title ?? jobId
        doorChecks = [
            DoorCheck(id: "1", label: "Filmed on site", detail: siteLabel, ok: true),
            DoorCheck(id: "2", label: "Video + audio sealed", detail: "mic track present", ok: true),
            DoorCheck(id: "3", label: "Filed to \(jobName)", detail: "office evidence library", ok: true),
            DoorCheck(
                id: "4",
                label: "Twin session",
                detail: manifest?.twinId ?? twinRooms.first?.name ?? "—",
                ok: manifest?.twinId != nil || !(twinRooms.first?.id == "skip")
            ),
        ]
        if let path = pendingUpload?.localPath {
            try? FileManager.default.removeItem(atPath: path)
        }
        PendingUploadStore.clear()
        pendingUpload = nil
        phase = .door
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

    func backToToday() {
        phase = .today
        elapsedSeconds = 0
        lastError = nil
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
