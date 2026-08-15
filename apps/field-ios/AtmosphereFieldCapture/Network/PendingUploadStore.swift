import Foundation

/// Day film that still needs to reach storage after the crew leaves the site.
struct PendingDayUpload: Codable, Equatable {
    var localPath: String
    var jobId: String
    var shareToken: String?
    var workDate: String
    var durationSeconds: Double
    var lat: Double?
    var lon: Double?
    var storagePath: String?
    var uploadUrl: String?
    var byteSize: Int64?
    var sha256Hex: String?
    var attempt: Int
}

enum PendingUploadStore {
    private static let key = "atmosphere.field.pendingDayUpload"

    static func load() -> PendingDayUpload? {
        guard let data = UserDefaults.standard.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(PendingDayUpload.self, from: data)
    }

    static func save(_ pending: PendingDayUpload) {
        if let data = try? JSONEncoder().encode(pending) {
            UserDefaults.standard.set(data, forKey: key)
        }
    }

    static func clear() {
        UserDefaults.standard.removeObject(forKey: key)
    }

    static func durableDirectory() throws -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        let dir = base.appendingPathComponent("DayFilms", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    static func persistRecording(_ source: URL) throws -> URL {
        let dest = try durableDirectory().appendingPathComponent("day-\(UUID().uuidString).mp4")
        if FileManager.default.fileExists(atPath: dest.path) {
            try FileManager.default.removeItem(at: dest)
        }
        try FileManager.default.copyItem(at: source, to: dest)
        return dest
    }
}
