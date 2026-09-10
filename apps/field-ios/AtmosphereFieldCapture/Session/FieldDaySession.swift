import Foundation

/// Orchestrates today → record (A/V) → door. Upload is save-first via
/// `DayFilmUploadQueue` (web IndexedDB queue parity) — hold-to-finish does not
/// await the full PUT before the take is considered saved.
@MainActor
final class FieldDaySession: ObservableObject {
    @Published var phase: FieldPhase = .today
    @Published var jobs: [ExpectedJob] = []
    @Published var activeJobId: String?
    @Published var elapsedSeconds: Int = 0
    @Published var siteLabel: String = "Getting your bearings…"
    @Published var doorChecks: [DoorCheck] = []
    @Published var twinRooms: [TwinRoomSummary] = []
    @Published var lastError: String?
    @Published var uploading: Bool = false
    @Published var manifest: DayFilmManifest?
    @Published var loadingJobs: Bool = false
    @Published var activeClipId: String?
    @Published var doorFilmId: String?
    @Published var filingDetail: String = ""

    let recorder = DayFilmRecorder()
    let locator = SiteLocator()
    let roomPlan = RoomPlanBridge()
    let uploadQueue = DayFilmUploadQueue.shared

    func bindUploadQueue(api: AtmosphereClient) {
        uploadQueue.bind(api: api)
    }

    func loadToday(api: AtmosphereClient) async {
        loadingJobs = true
        lastError = nil
        defer { loadingJobs = false }
        do {
            let list = try await api.todayJobs()
            jobs = list
            if activeJobId == nil || !list.contains(where: { $0.id == activeJobId }) {
                activeJobId = list.first?.id
            }
        } catch {
            lastError = error.localizedDescription
            jobs = []
        }
    }

    func startDay() async {
        lastError = nil
        guard activeJobId != nil || !jobs.isEmpty else {
            lastError = "No job for today. Create or schedule a job in the Atmosphere dashboard first."
            return
        }
        if activeJobId == nil { activeJobId = jobs.first?.id }
        // Fresh clip id per recording — same-day multi-film must not share a stem.
        activeClipId = ClipId.mint()
        do {
            try await recorder.prepare()
            locator.configure(jobs: jobs)
            locator.start()
            try recorder.startDay()
            phase = .recording
        } catch {
            lastError = error.localizedDescription
        }
    }

    /// Door CTA: record another film on the same job without forcing Today.
    func recordAnother() async {
        lastError = nil
        doorFilmId = nil
        doorChecks = []
        twinRooms = []
        manifest = nil
        filingDetail = ""
        await startDay()
    }

    var canRecordAnother: Bool {
        activeJobId != nil || !jobs.isEmpty
    }

    func tickFromRecorder() {
        elapsedSeconds = recorder.elapsedSeconds
        siteLabel = locator.siteLabel
    }

    /// Hold-to-finish: probe A/V → persist locally → door immediately → queue uploads.
    func finishDay(api: AtmosphereClient) async {
        lastError = nil
        uploading = true
        defer { uploading = false }
        do {
            let url = try await recorder.finishDay()
            locator.stop()
            let tracks = try await DayFilmRecorder.probeTracks(url: url)
            guard tracks.hasAudio, tracks.hasVideo else {
                throw CaptureError.missingAudio
            }
            let durationSeconds = tracks.duration > 0
                ? tracks.duration
                : Double(max(elapsedSeconds, recorder.elapsedSeconds))

            guard let jobId = activeJobId ?? jobs.first?.id else {
                throw APIError.http(status: 0, body: "No job selected for this day film.")
            }

            let workDate = Self.todayStamp()
            let clipId = ClipId.resolve(activeClipId)
            activeClipId = clipId
            let jobName = jobs.first(where: { $0.id == jobId })?.name ?? jobId

            let entry = try await DayFilmQueueStore.shared.persistFilm(
                from: url,
                jobId: jobId,
                jobName: jobName,
                clipId: clipId,
                workDate: workDate,
                durationSeconds: durationSeconds,
                lat: locator.coordinate?.latitude,
                lon: locator.coordinate?.longitude,
                accuracyM: nil
            )
            doorFilmId = entry.id
            await uploadQueue.enqueuePersisted(entry)

            // Optional RoomPlan twin — never blocks filing; runs after local save.
            var geometrySessionId: String?
            var twinId: String?
            roomPlan.detectCapabilities()
            await roomPlan.captureRooms()
            do {
                let geo = try await api.openGeometrySession(
                    lidarAvailable: roomPlan.lidarAvailable,
                    label: "Field day \(workDate)",
                    videoRef: entry.fileName
                )
                geometrySessionId = geo.session.id
                twinId = geo.twin.id
                let rooms = roomPlan.asIngestRooms()
                if !rooms.isEmpty {
                    try await api.ingestGeometry(
                        sessionId: geo.session.id,
                        body: .init(
                            source: "roomplan",
                            rooms: rooms,
                            mesh: nil,
                            videoRef: entry.fileName,
                            work: nil
                        )
                    )
                    twinRooms = rooms.map {
                        TwinRoomSummary(
                            id: $0.name,
                            name: $0.name,
                            detail: $0.floorAreaSqFt.map { "\($0) SF" }
                                ?? "\($0.lengthFt ?? 0)×\($0.widthFt ?? 0) ft"
                        )
                    }
                } else {
                    twinRooms = [
                        TwinRoomSummary(
                            id: "pending",
                            name: "Twin pending measure",
                            detail: "Video + audio saved · RoomPlan pass when available"
                        ),
                    ]
                }
            } catch {
                twinRooms = [
                    TwinRoomSummary(
                        id: "skip",
                        name: "Twin deferred",
                        detail: "Day film is saved; twin measure can retry later"
                    ),
                ]
            }

            let byteSize = entry.byteSize
            manifest = DayFilmManifest(
                mediaId: nil,
                sessionId: nil,
                twinId: twinId,
                geometrySessionId: geometrySessionId,
                videoRef: entry.fileName,
                durationSeconds: durationSeconds,
                byteSize: byteSize,
                contentType: "video/mp4",
                hasAudio: true,
                hasVideo: true,
                capturedAt: Date(),
                clipId: clipId
            )

            doorChecks = savedDoorChecks(jobName: jobName, clipId: clipId, twinId: twinId)
            filingDetail = "Saved on this phone — filing to the office…"
            recorder.teardown()
            // Temp recorder file can go; durable copy is in the queue store.
            try? FileManager.default.removeItem(at: url)
            phase = .door
        } catch {
            lastError = error.localizedDescription
            phase = .door
            doorChecks = [
                DoorCheck(id: "err", label: "Not saved", detail: error.localizedDescription, ok: false),
            ]
            filingDetail = "Recording was not saved."
        }
    }

    func applyFiledNotification(proofId: String?, storagePath: String?, byteSize: Int64?) {
        guard let m = manifest else { return }
        var updated = m
        if let proofId { updated.mediaId = proofId }
        if let storagePath { updated.videoRef = storagePath }
        if let byteSize { updated.byteSize = byteSize }
        manifest = updated

        let jobName = jobs.first(where: { $0.id == activeJobId })?.name ?? activeJobId ?? "job"
        doorChecks = [
            DoorCheck(id: "1", label: "Filmed on site", detail: siteLabel, ok: true),
            DoorCheck(id: "2", label: "Video + audio sealed", detail: "mic track present", ok: true),
            DoorCheck(id: "3", label: "Filed to \(jobName)", detail: "office evidence library", ok: true),
            DoorCheck(
                id: "ai",
                label: "Queued for AI reading",
                detail: "actions + dictation in the Verifier",
                ok: true
            ),
            DoorCheck(
                id: "4",
                label: "Twin session",
                detail: updated.twinId ?? "—",
                ok: updated.twinId != nil
            ),
        ]
        filingDetail = "Filed to the office."
    }

    func refreshFilingDetailFromQueue() {
        switch uploadQueue.filingStep {
        case .waitingForSignal:
            filingDetail = "Waiting for signal…"
        case .needsSignIn:
            filingDetail = "Sign in again to finish filing saved days."
        case let .stuck(msg):
            filingDetail = msg
        case let .uploading(_, detail):
            filingDetail = "Filing \(detail)…"
        case .saved:
            filingDetail = "Saved on this phone — filing to the office…"
        case .filed:
            filingDetail = "Filed to the office."
        case .idle:
            break
        }
    }

    func backToToday() {
        phase = .today
        elapsedSeconds = 0
        lastError = nil
        doorFilmId = nil
        // Keep activeJobId so a later Start still knows the job; clear clip.
        activeClipId = nil
    }

    private func savedDoorChecks(jobName: String, clipId: String, twinId: String?) -> [DoorCheck] {
        [
            DoorCheck(id: "1", label: "Filmed on site", detail: siteLabel, ok: true),
            DoorCheck(id: "2", label: "Video + audio sealed", detail: "mic track present", ok: true),
            DoorCheck(
                id: "3",
                label: "Saved for \(jobName)",
                detail: "clip \(clipId) · filing in background",
                ok: true
            ),
            DoorCheck(
                id: "ai",
                label: "AI reading after file",
                detail: "actions + dictation in the Verifier",
                ok: true
            ),
            DoorCheck(
                id: "4",
                label: "Twin session",
                detail: twinId ?? "—",
                ok: twinId != nil
            ),
        ]
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
