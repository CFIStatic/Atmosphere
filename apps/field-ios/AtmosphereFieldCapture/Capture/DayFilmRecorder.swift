import AVFoundation
import Foundation

/**
 * Day-length field film: **camera + microphone** in one MP4 (H.264 + AAC).
 *
 * Audio is not optional. The office Verifier plays this file with soundtrack;
 * AI stills are extracted server-side without stripping the stored audio track.
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
    @Published private(set) var previewLayer: AVCaptureVideoPreviewLayer?

    private let session = AVCaptureSession()
    private let movieOutput = AVCaptureMovieFileOutput()
    private var timer: Timer?
    private var startedAt: Date?
    private var outputURL: URL?
    private var stopContinuation: CheckedContinuation<URL, Error>?
    private var sessionConfigured = false

    /// Max one object (~24h), matching server `PROOF_MAX_DURATION_SECONDS`.
    static let maxDurationSeconds: Double = 86_400

    var isRecording: Bool {
        if case .recording = status { return true }
        return false
    }

    var isCaptureActive: Bool {
        session.isRunning
    }

    /// Permission prompts only — no camera or microphone hardware is started.
    func prepare() async throws {
        status = .preparing
        let cam = try await CapturePermissions.requestCamera()
        let mic = try await CapturePermissions.requestMicrophone()
        guard cam, mic else {
            let message = CapturePermissions.missingPermissionsMessage(camera: cam, microphone: mic)
                ?? "Camera and microphone are both required for Field Capture."
            status = .failed(message)
            throw CaptureError.permissionDenied
        }
        status = .idle
    }

    func startDay() async throws {
        guard !movieOutput.isRecording else { return }
        if !sessionConfigured {
            try configureSession()
        }
        if !session.isRunning {
            await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
                DispatchQueue.global(qos: .userInitiated).async {
                    self.session.startRunning()
                    cont.resume()
                }
            }
        }
        try beginRecordingFile()
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
        if movieOutput.isRecording {
            movieOutput.stopRecording()
        }
        if session.isRunning {
            session.stopRunning()
        }
        previewLayer = nil
        startedAt = nil
        elapsedSeconds = 0
        sessionConfigured = false
        status = .idle
    }

    private func configureSession() throws {
        session.beginConfiguration()
        session.sessionPreset = .high

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

        if let connection = movieOutput.connection(with: .video),
           connection.isVideoStabilizationSupported {
            connection.preferredVideoStabilizationMode = .auto
        }

        session.commitConfiguration()

        let preview = AVCaptureVideoPreviewLayer(session: session)
        preview.videoGravity = .resizeAspectFill
        if let connection = preview.connection, connection.isVideoOrientationSupported {
            connection.videoOrientation = .portrait
        }
        previewLayer = preview
        sessionConfigured = true
    }

    private func beginRecordingFile() throws {
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
