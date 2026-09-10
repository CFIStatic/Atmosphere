import Foundation

/// Durable queue entry — mirrors web IndexedDB day-film queue metadata
/// (blob lives as a file beside the index).
struct DayFilmQueueEntry: Codable, Identifiable, Equatable {
    enum Status: String, Codable, Equatable {
        case queued
        case uploading
        case filed
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

    var isPending: Bool { status != .filed }
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
