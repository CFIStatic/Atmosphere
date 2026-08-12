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
    let context = FieldContextCollector()

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

    func startDay(api: AtmosphereClient) async {
        lastError = nil
        guard activeJobId != nil || !jobs.isEmpty else {
            lastError = "No job to film. Create or schedule a job in the Atmosphere dashboard first."
            return
        }
        if activeJobId == nil { activeJobId = jobs.first?.id }
        do {
            try await recorder.prepare()
            locator.configure(jobs: jobs)
            locator.onLocation = { [weak self] location in
                self?.context.noteLocation(location)
            }
            context.startCollecting()
            locator.start()
            try recorder.startDay()
            phase = .recording

            if let jobId = activeJobId {
                let workDate = Self.todayStamp()
                try? await context.openSession(api: api, jobId: jobId, workDate: workDate)
            }
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
            let captureFacts: [String: Any] = [
                "hasVideo": true,
                "hasAudio": true,
                "durationSeconds": tracks.duration,
                "byteSize": uploaded.byteSize,
                "contentHash": uploaded.sha256Hex as Any,
                "contentType": "video/mp4",
                "storagePath": begin.path,
                "workDate": workDate,
                "phase": "after",
            ]
            let deviceContext = context.organizedDeviceContext(capture: captureFacts)

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
                    accuracyM: locator.accuracyM ?? context.lastAccuracyM,
                    contextSessionId: context.sessionId,
                    deviceContext: .init(deviceContext)
                )
            )

            await context.completeSession(
                api: api,
                proofId: recorded.proof?.id,
                capture: captureFacts
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
                sessionId: context.sessionId,
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
            let accuracyLabel = locator.accuracyM.map { String(format: "±%.0fm", $0) } ?? "GPS"
            doorChecks = [
                DoorCheck(id: "1", label: "Filmed on site", detail: "\(siteLabel) · \(accuracyLabel)", ok: true),
                DoorCheck(id: "2", label: "Video + audio sealed", detail: "mic track present", ok: true),
                DoorCheck(id: "3", label: "Filed to \(jobName)", detail: "office evidence library", ok: true),
                DoorCheck(
                    id: "4",
                    label: "Capture context",
                    detail: context.sessionId != nil ? "device + trail filed" : "partial",
                    ok: context.sessionId != nil
                ),
                DoorCheck(
                    id: "5",
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
            context.stopCollecting()
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
