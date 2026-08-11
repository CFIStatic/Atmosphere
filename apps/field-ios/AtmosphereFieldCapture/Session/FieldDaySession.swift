import Foundation

/// Orchestrates today → record (A/V) → door → upload into the org evidence library.
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

    let recorder = DayFilmRecorder()
    let locator = SiteLocator()
    let roomPlan = RoomPlanBridge()

    func loadToday(api: AtmosphereClient) async {
        loadingJobs = true
        lastError = nil
        defer { loadingJobs = false }
        do {
            let list = try await api.todayJobs()
            jobs = list
            if activeJobId == nil {
                activeJobId = list.first?.id
            }
        } catch {
            lastError = error.localizedDescription
            jobs = []
        }
    }

    /// Quick Add — type a job name on site; the office sees the file and can finish details later.
    func quickAdd(title: String, api: AtmosphereClient) async {
        let name = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard name.count >= 2 else {
            lastError = "Enter a job name (at least a couple of characters)."
            return
        }
        lastError = nil
        do {
            let job = try await api.quickAddJob(title: name)
            if !jobs.contains(where: { $0.id == job.id }) {
                jobs.insert(job, at: 0)
            }
            activeJobId = job.id
        } catch {
            lastError = error.localizedDescription
        }
    }

    func startDay() async {
        lastError = nil
        guard activeJobId != nil || !jobs.isEmpty else {
            lastError = "No job to film. Tap + Quick Add to name one, or wait for the office."
            return
        }
        if activeJobId == nil { activeJobId = jobs.first?.id }
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

    func tickFromRecorder() {
        elapsedSeconds = recorder.elapsedSeconds
        siteLabel = locator.siteLabel
    }

    func finishDay(api: AtmosphereClient) async {
        lastError = nil
        do {
            let url = try await recorder.finishDay()
            locator.stop()
            let tracks = try await DayFilmRecorder.probeTracks(url: url)
            guard tracks.hasAudio, tracks.hasVideo else {
                throw CaptureError.missingAudio
            }

            guard let jobId = activeJobId ?? jobs.first?.id else {
                throw APIError.http(status: 0, body: "No job selected for this day film.")
            }

            uploading = true
            defer { uploading = false }

            let workDate = Self.todayStamp()
            let begin = try await api.beginJobProofUpload(jobId: jobId, workDate: workDate)
            guard let uploadURL = URL(string: begin.uploadUrl) else {
                throw APIError.http(status: 0, body: "Bad upload URL")
            }
            let uploaded = try await MediaUploadClient.uploadFile(localURL: url, uploadURL: uploadURL)

            let iso = ISO8601DateFormatter().string(from: Date())
            let recorded = try await api.completeJobProof(
                jobId: jobId,
                body: .init(
                    workDate: workDate,
                    phase: "after",
                    storagePath: begin.path,
                    byteSize: uploaded.byteSize,
                    durationSeconds: tracks.duration,
                    contentHash: uploaded.sha256Hex,
                    capturedAt: iso,
                    lat: locator.coordinate?.latitude,
                    lon: locator.coordinate?.longitude,
                    accuracyM: nil
                )
            )

            let videoRef = recorded.proof?.id ?? begin.path
            var geometrySessionId: String?
            var twinId: String?

            roomPlan.detectCapabilities()
            await roomPlan.captureRooms()
            do {
                let geo = try await api.openGeometrySession(
                    lidarAvailable: roomPlan.lidarAvailable,
                    label: "Field day \(workDate)",
                    videoRef: videoRef
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
                            videoRef: videoRef,
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
                            detail: "Video + audio filed · RoomPlan pass when available"
                        ),
                    ]
                }
            } catch {
                twinRooms = [
                    TwinRoomSummary(
                        id: "skip",
                        name: "Twin deferred",
                        detail: "Day film is filed; twin measure can retry later"
                    ),
                ]
            }

            manifest = DayFilmManifest(
                mediaId: recorded.proof?.id,
                sessionId: nil,
                twinId: twinId,
                geometrySessionId: geometrySessionId,
                videoRef: videoRef,
                durationSeconds: tracks.duration,
                byteSize: uploaded.byteSize,
                contentType: "video/mp4",
                hasAudio: true,
                hasVideo: true,
                capturedAt: Date()
            )

            let jobName = jobs.first(where: { $0.id == jobId })?.name ?? jobId
            doorChecks = [
                DoorCheck(id: "1", label: "Filmed on site", detail: siteLabel, ok: true),
                DoorCheck(id: "2", label: "Video + audio sealed", detail: "mic track present", ok: true),
                DoorCheck(id: "3", label: "Filed to \(jobName)", detail: "office evidence library", ok: true),
                DoorCheck(
                    id: "4",
                    label: "Twin session",
                    detail: twinId ?? "—",
                    ok: twinId != nil
                ),
            ]

            recorder.teardown()
            phase = .door
        } catch {
            lastError = error.localizedDescription
            phase = .door
            doorChecks = [
                DoorCheck(id: "err", label: "Upload issue", detail: error.localizedDescription, ok: false),
            ]
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
