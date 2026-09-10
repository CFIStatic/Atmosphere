import Foundation

/// Durable queue entry — mirrors web IndexedDB day-film queue metadata
/// (blob lives as a file beside the index).
struct DayFilmQueueEntry: Codable, Identifiable, Equatable {
    enum Status: String, Codable, Equatable {
        case queued
        case uploading
        case filed
    }

    enum Mode: String, Codable, Equatable {
        case account
        case share
    }

    var id: String
    var jobId: String
    var jobName: String
    var clipId: String
    var workDate: String
    var phase: String
    var fileName: String
    var mimeType: String
    var byteSize: Int64
    var durationSeconds: Double?
    var recordedAt: String
    var lat: Double?
    var lon: Double?
    var accuracyM: Double?
    var contentHash: String?
    var storagePath: String?
    var status: Status
    var attempts: Int
    var lastError: String
    var lastStatus: Int
    var nextAttemptAt: TimeInterval
    /// Multipart stream head when parts already landed (bytesDone / partCount).
    var streamBytesDone: Int64
    var streamPartCount: Int
    var streamFailed: Bool
    /// `account` (office login) or `share` (job-share token).
    var mode: Mode
    var shareToken: String?
    /// When jobId is still phone-only, create-office payload for remap.
    var jobDraft: JobDraftPayload?

    var isPending: Bool { status != .filed }

    enum CodingKeys: String, CodingKey {
        case id, jobId, jobName, clipId, workDate, phase, fileName, mimeType, byteSize
        case durationSeconds, recordedAt, lat, lon, accuracyM, contentHash, storagePath
        case status, attempts, lastError, lastStatus, nextAttemptAt
        case streamBytesDone, streamPartCount, streamFailed, mode, shareToken, jobDraft
    }

    init(
        id: String,
        jobId: String,
        jobName: String,
        clipId: String,
        workDate: String,
        phase: String,
        fileName: String,
        mimeType: String,
        byteSize: Int64,
        durationSeconds: Double?,
        recordedAt: String,
        lat: Double?,
        lon: Double?,
        accuracyM: Double?,
        contentHash: String?,
        storagePath: String?,
        status: Status,
        attempts: Int,
        lastError: String,
        lastStatus: Int,
        nextAttemptAt: TimeInterval,
        streamBytesDone: Int64,
        streamPartCount: Int,
        streamFailed: Bool,
        mode: Mode = .account,
        shareToken: String? = nil,
        jobDraft: JobDraftPayload? = nil
    ) {
        self.id = id
        self.jobId = jobId
        self.jobName = jobName
        self.clipId = clipId
        self.workDate = workDate
        self.phase = phase
        self.fileName = fileName
        self.mimeType = mimeType
        self.byteSize = byteSize
        self.durationSeconds = durationSeconds
        self.recordedAt = recordedAt
        self.lat = lat
        self.lon = lon
        self.accuracyM = accuracyM
        self.contentHash = contentHash
        self.storagePath = storagePath
        self.status = status
        self.attempts = attempts
        self.lastError = lastError
        self.lastStatus = lastStatus
        self.nextAttemptAt = nextAttemptAt
        self.streamBytesDone = streamBytesDone
        self.streamPartCount = streamPartCount
        self.streamFailed = streamFailed
        self.mode = mode
        self.shareToken = shareToken
        self.jobDraft = jobDraft
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        jobId = try c.decode(String.self, forKey: .jobId)
        jobName = try c.decode(String.self, forKey: .jobName)
        clipId = try c.decode(String.self, forKey: .clipId)
        workDate = try c.decode(String.self, forKey: .workDate)
        phase = try c.decode(String.self, forKey: .phase)
        fileName = try c.decode(String.self, forKey: .fileName)
        mimeType = try c.decode(String.self, forKey: .mimeType)
        byteSize = try c.decode(Int64.self, forKey: .byteSize)
        durationSeconds = try c.decodeIfPresent(Double.self, forKey: .durationSeconds)
        recordedAt = try c.decode(String.self, forKey: .recordedAt)
        lat = try c.decodeIfPresent(Double.self, forKey: .lat)
        lon = try c.decodeIfPresent(Double.self, forKey: .lon)
        accuracyM = try c.decodeIfPresent(Double.self, forKey: .accuracyM)
        contentHash = try c.decodeIfPresent(String.self, forKey: .contentHash)
        storagePath = try c.decodeIfPresent(String.self, forKey: .storagePath)
        status = try c.decode(Status.self, forKey: .status)
        attempts = try c.decode(Int.self, forKey: .attempts)
        lastError = try c.decode(String.self, forKey: .lastError)
        lastStatus = try c.decode(Int.self, forKey: .lastStatus)
        nextAttemptAt = try c.decode(TimeInterval.self, forKey: .nextAttemptAt)
        streamBytesDone = try c.decodeIfPresent(Int64.self, forKey: .streamBytesDone) ?? 0
        streamPartCount = try c.decodeIfPresent(Int.self, forKey: .streamPartCount) ?? 0
        streamFailed = try c.decodeIfPresent(Bool.self, forKey: .streamFailed) ?? false
        mode = try c.decodeIfPresent(Mode.self, forKey: .mode) ?? .account
        shareToken = try c.decodeIfPresent(String.self, forKey: .shareToken)
        jobDraft = try c.decodeIfPresent(JobDraftPayload.self, forKey: .jobDraft)
    }
}

enum DayFilmFilingStep: Equatable {
    case idle
    case saved
    case waitingForSignal
    case uploading(progress: Double, detail: String)
    case filed
    case needsSignIn
    case stuck(String)
}
