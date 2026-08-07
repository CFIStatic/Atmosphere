import Foundation

/// Orchestrates today → record (A/V) → door → upload + optional twin ingest.
@MainActor
final class FieldDaySession: ObservableObject {
    @Published var phase: FieldPhase = .today
    @Published var jobs: [ExpectedJob] = FieldDaySession.demoJobs
    @Published var elapsedSeconds: Int = 0
    @Published var siteLabel: String = "Getting your bearings…"
    @Published var doorChecks: [DoorCheck] = []
    @Published var twinRooms: [TwinRoomSummary] = []
    @Published var lastError: String?
    @Published var uploading: Bool = false
    @Published var manifest: DayFilmManifest?

    let recorder = DayFilmRecorder()
    let locator = SiteLocator()
    let roomPlan = RoomPlanBridge()

    func startDay() async {
        lastError = nil
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

            uploading = true
            defer { uploading = false }

            let attrs = try FileManager.default.attributesOfItem(atPath: url.path)
            let byteSize = attrs[.size] as? Int64 ?? 0

            let begin = try await api.beginDayFilmUpload(
                durationSeconds: tracks.duration,
                byteSize: byteSize,
                preferMultipart: byteSize > 64 * 1024 * 1024
            )
            let uploadURL = begin.session.uploadUrl.flatMap(URL.init(string:))
            let uploaded = try await MediaUploadClient.uploadFile(
                localURL: url,
                uploadURL: uploadURL,
                multipart: begin.session.multipart
            )
            let completed = try await api.completeDayFilmUpload(
                sessionId: begin.session.id,
                byteSize: uploaded.byteSize,
                durationSeconds: tracks.duration,
                contentHash: uploaded.sha256Hex
            )

            let videoRef = completed.media.id
            var geometrySessionId: String?
            var twinId: String?

            roomPlan.detectCapabilities()
            await roomPlan.captureRooms()
            let geo = try await api.openGeometrySession(
                lidarAvailable: roomPlan.lidarAvailable,
                label: "Field day \(Date().formatted(date: .abbreviated, time: .omitted))",
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

            manifest = DayFilmManifest(
                mediaId: completed.media.id,
                sessionId: begin.session.id,
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

            doorChecks = [
                DoorCheck(id: "1", label: "Filmed on site", detail: siteLabel, ok: true),
                DoorCheck(id: "2", label: "Video + audio sealed", detail: "mic track present", ok: true),
                DoorCheck(id: "3", label: "Uploaded", detail: videoRef, ok: true),
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

    static let demoJobs: [ExpectedJob] = [
        ExpectedJob(
            id: "j1041",
            number: "#1041",
            name: "Meridian Ave — water loss, Class 3",
            address: "1841 Meridian Ave, Austin",
            at: "7:00 AM",
            placed: true
        ),
        ExpectedJob(
            id: "j1038",
            number: "#1038",
            name: "Cedar Ridge — storm damage, roof tarp",
            address: "4118 Cedar Ridge Dr, Austin",
            at: "11:30 AM",
            placed: true
        ),
    ]
}
