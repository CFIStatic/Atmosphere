import AVFoundation
import Foundation

/**
 * Day-length field film: **camera + microphone** in one MP4 (H.264 + AAC).
 *
 * Audio is not optional. The office Verifier plays this file with soundtrack;
 * AI stills are extracted server-side without stripping the stored audio track.
 *
 * Quality cap (see backend `PREFERRED_DAY_FILM`): ~720p, ~30 fps, ~2 Mbps video.
 */
@MainActor
final class DayFilmRecorder: NSObject, ObservableObject {
    enum Status: Equatable {
        case idle
        case preparing
        case recording
        case finishing
        case failed(String)
    }

    @Published private(set) var status: Status = .idle
    @Published private(set) var elapsedSeconds: Int = 0

    /// The live capture session. Recording UI binds a preview layer to this
    /// so the crew sees what is being recorded — not a black view.
    var captureSession: AVCaptureSession { session }

    var isSessionRunning: Bool { session.isRunning }

    private let session = AVCaptureSession()
    private let movieOutput = AVCaptureMovieFileOutput()
    private var timer: Timer?
    private var startedAt: Date?
    private var outputURL: URL?
    private var stopContinuation: CheckedContinuation<URL, Error>?

    /// Max one object (~24h), matching server `PROOF_MAX_DURATION_SECONDS`.
    static let maxDurationSeconds: Double = 86_400

    var isRecording: Bool {
        if case .recording = status { return true }
        return false
    }

    func prepare() async throws {
        status = .preparing
        let cam = try await CapturePermissions.requestCamera()
        let mic = try await CapturePermissions.requestMicrophone()
        guard cam, mic else {
            status = .failed("Camera and microphone are both required for Field Capture.")
            throw CaptureError.permissionDenied
        }

        session.beginConfiguration()
        // Cap at 720p (not .high / 1080p+) — matches PREFERRED_DAY_FILM.
        if session.canSetSessionPreset(.hd1280x720) {
            session.sessionPreset = .hd1280x720
        } else {
            session.sessionPreset = .medium
        }

        session.inputs.forEach { session.removeInput($0) }
        session.outputs.forEach { session.removeOutput($0) }

        guard
            let videoDevice = AVCaptureDevice.default(
                .builtInWideAngleCamera,
                for: .video,
                position: .back
            ) ?? AVCaptureDevice.default(for: .video),
            let videoInput = try? AVCaptureDeviceInput(device: videoDevice),
            session.canAddInput(videoInput)
        else {
            status = .failed("No camera available.")
            throw CaptureError.deviceUnavailable
        }
        session.addInput(videoInput)

        // Microphone is mandatory — day film is audiovisual.
        guard
            let audioDevice = AVCaptureDevice.default(for: .audio),
            let audioInput = try? AVCaptureDeviceInput(device: audioDevice),
            session.canAddInput(audioInput)
        else {
            status = .failed("No microphone available.")
            throw CaptureError.deviceUnavailable
        }
        session.addInput(audioInput)

        guard session.canAddOutput(movieOutput) else {
            status = .failed("Could not configure movie output.")
            throw CaptureError.deviceUnavailable
        }
        session.addOutput(movieOutput)

        // Prefer AAC audio + H.264 in QuickTime/MP4. Portrait so the filed
        // film matches the live preview the crew watches. Cap encode ~2 Mbps.
        if let connection = movieOutput.connection(with: .video) {
            if connection.isVideoStabilizationSupported {
                connection.preferredVideoStabilizationMode = .auto
            }
            Self.applyPortraitOrientation(to: connection)
            Self.applyDayFilmOutputSettings(to: movieOutput, connection: connection)
        }

        session.commitConfiguration()

        Self.lockFrameRate(device: videoDevice, fps: Self.targetFrameRate)

        await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
            DispatchQueue.global(qos: .userInitiated).async {
                self.session.startRunning()
                cont.resume()
            }
        }
        status = .idle
    }

    func startDay() throws {
        guard !movieOutput.isRecording else { return }
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("field-day-\(UUID().uuidString).mp4")
        outputURL = url
        startedAt = Date()
        elapsedSeconds = 0
        movieOutput.startRecording(to: url, recordingDelegate: self)
        status = .recording
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self, let started = self.startedAt else { return }
                self.elapsedSeconds = Int(Date().timeIntervalSince(started))
                if Double(self.elapsedSeconds) >= Self.maxDurationSeconds {
                    _ = try? await self.finishDay()
                }
            }
        }
    }

    func finishDay() async throws -> URL {
        guard movieOutput.isRecording else {
            throw CaptureError.notRecording
        }
        status = .finishing
        timer?.invalidate()
        timer = nil
        return try await withCheckedThrowingContinuation { cont in
            self.stopContinuation = cont
            self.movieOutput.stopRecording()
        }
    }

    func teardown() {
        timer?.invalidate()
        timer = nil
        session.stopRunning()
        status = .idle
    }

    /// ~720p / ~30 fps / ~2 Mbps — see backend `PREFERRED_DAY_FILM`.
    static let targetFrameRate: Double = 30
    static let targetVideoBitsPerSecond: Int = 2_000_000

    /// Prefer ~30 fps when the active format supports it (falls back silently).
    static func lockFrameRate(device: AVCaptureDevice, fps: Double) {
        let ranges = device.activeFormat.videoSupportedFrameRateRanges
        guard ranges.contains(where: { $0.minFrameRate <= fps && fps <= $0.maxFrameRate }) else {
            return
        }
        do {
            try device.lockForConfiguration()
            let duration = CMTime(value: 1, timescale: CMTimeScale(fps))
            device.activeVideoMinFrameDuration = duration
            device.activeVideoMaxFrameDuration = duration
            device.unlockForConfiguration()
        } catch {
            // Keep whatever the preset chose; recording must still start.
        }
    }

    /// H.264 + average bitrate on the movie-file output (best-effort).
    static func applyDayFilmOutputSettings(
        to output: AVCaptureMovieFileOutput,
        connection: AVCaptureConnection
    ) {
        let compression: [String: Any] = [
            AVVideoAverageBitRateKey: targetVideoBitsPerSecond,
            AVVideoExpectedSourceFrameRateKey: Int(targetFrameRate),
            AVVideoMaxKeyFrameIntervalKey: Int(targetFrameRate),
        ]
        let settings: [String: Any] = [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoCompressionPropertiesKey: compression,
        ]
        output.setOutputSettings(settings, for: connection)
    }

    /// iPhone is portrait-locked; keep the movie track the same way up as the finder.
    static func applyPortraitOrientation(to connection: AVCaptureConnection?) {
        guard let connection else { return }
        if #available(iOS 17.0, *) {
            if connection.isVideoRotationAngleSupported(90) {
                connection.videoRotationAngle = 90
            }
        } else if connection.isVideoOrientationSupported {
            connection.videoOrientation = .portrait
        }
    }

    /// Probe the finished file for audio + video tracks before upload.
    static func probeTracks(url: URL) async throws -> (hasVideo: Bool, hasAudio: Bool, duration: Double) {
        let asset = AVURLAsset(url: url)
        let video = try await asset.loadTracks(withMediaType: .video)
        let audio = try await asset.loadTracks(withMediaType: .audio)
        let duration = try await asset.load(.duration)
        let seconds = CMTimeGetSeconds(duration)
        return (!video.isEmpty, !audio.isEmpty, seconds.isFinite ? seconds : 0)
    }
}

extension DayFilmRecorder: AVCaptureFileOutputRecordingDelegate {
    nonisolated func fileOutput(
        _ output: AVCaptureFileOutput,
        didFinishRecordingTo outputFileURL: URL,
        from connections: [AVCaptureConnection],
        error: Error?
    ) {
        Task { @MainActor in
            if let error {
                status = .failed(error.localizedDescription)
                stopContinuation?.resume(throwing: error)
                stopContinuation = nil
                return
            }
            do {
                let tracks = try await Self.probeTracks(url: outputFileURL)
                guard tracks.hasVideo, tracks.hasAudio else {
                    let err = CaptureError.missingAudio
                    status = .failed(err.localizedDescription)
                    stopContinuation?.resume(throwing: err)
                    stopContinuation = nil
                    return
                }
                status = .idle
                stopContinuation?.resume(returning: outputFileURL)
                stopContinuation = nil
            } catch {
                status = .failed(error.localizedDescription)
                stopContinuation?.resume(throwing: error)
                stopContinuation = nil
            }
        }
    }
}

enum CaptureError: LocalizedError {
    case permissionDenied
    case deviceUnavailable
    case notRecording
    case missingAudio

    var errorDescription: String? {
        switch self {
        case .permissionDenied:
            return "Camera and microphone permission are required."
        case .deviceUnavailable:
            return "Camera or microphone is unavailable."
        case .notRecording:
            return "Not recording."
        case .missingAudio:
            return "Recording has no audio track. Field Capture requires video + microphone."
        }
    }
}
