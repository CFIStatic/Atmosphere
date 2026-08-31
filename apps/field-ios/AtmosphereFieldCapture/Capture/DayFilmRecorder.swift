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

        try configureAudioSession()

        session.beginConfiguration()
        session.automaticallyConfiguresApplicationAudioSession = false
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

        if let audioConnection = movieOutput.connection(with: .audio) {
            audioConnection.isEnabled = true
            movieOutput.setOutputSettings(
                [
                    AVFormatIDKey: kAudioFormatMPEG4AAC,
                    AVSampleRateKey: 44_100,
                    AVNumberOfChannelsKey: 1,
                    AVEncoderBitRateKey: 64_000,
                ],
                for: audioConnection
            )
        }

        // Prefer AAC audio + H.264 in QuickTime/MP4. Portrait so the filed
        // film matches the live preview the crew watches.
        if let connection = movieOutput.connection(with: .video) {
            if connection.isVideoStabilizationSupported {
                connection.preferredVideoStabilizationMode = .auto
            }
            Self.applyPortraitOrientation(to: connection)
        }

        session.commitConfiguration()

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
        var last = (hasVideo: false, hasAudio: false, duration: 0.0)
        for attempt in 0..<6 {
            let asset = AVURLAsset(url: url)
            let video = try await asset.loadTracks(withMediaType: .video)
            let audio = try await asset.loadTracks(withMediaType: .audio)
            let duration = try await asset.load(.duration)
            let seconds = CMTimeGetSeconds(duration)
            last = (!video.isEmpty, !audio.isEmpty, seconds.isFinite ? seconds : 0)
            if last.hasVideo, last.hasAudio { return last }
            if attempt < 5 {
                try await Task.sleep(nanoseconds: 200_000_000)
            }
        }
        return last
    }

    private func configureAudioSession() throws {
        let audioSession = AVAudioSession.sharedInstance()
        try audioSession.setCategory(
            .playAndRecord,
            mode: .videoRecording,
            options: [.defaultToSpeaker, .allowBluetooth, .mixWithOthers]
        )
        try audioSession.setActive(true)
    }

    private static func isBenignRecordingStop(_ error: Error) -> Bool {
        let nsError = error as NSError
        if nsError.domain == AVFoundationErrorDomain,
           nsError.code == AVError.recordingSuccessfullyFinished.rawValue {
            return true
        }
        if nsError.userInfo[AVErrorRecordingSuccessfullyFinishedKey] as? Bool == true {
            return true
        }
        return false
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
            if let error, !Self.isBenignRecordingStop(error) {
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
