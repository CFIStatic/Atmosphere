import Foundation

/// Day film that still needs to reach the Atmosphere dashboard.
struct PendingDayUpload: Codable, Equatable, Identifiable {
    var id: String
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
    var filed: Bool

    init(
        id: String = UUID().uuidString,
        localPath: String,
        jobId: String,
        shareToken: String? = nil,
        workDate: String,
        durationSeconds: Double,
        lat: Double? = nil,
        lon: Double? = nil,
        storagePath: String? = nil,
        uploadUrl: String? = nil,
        byteSize: Int64? = nil,
        sha256Hex: String? = nil,
        attempt: Int = 0,
        filed: Bool = false
    ) {
        self.id = id
        self.localPath = localPath
        self.jobId = jobId
        self.shareToken = shareToken
        self.workDate = workDate
        self.durationSeconds = durationSeconds
        self.lat = lat
        self.lon = lon
        self.storagePath = storagePath
        self.uploadUrl = uploadUrl
        self.byteSize = byteSize
        self.sha256Hex = sha256Hex
        self.attempt = attempt
        self.filed = filed
    }

    enum CodingKeys: String, CodingKey {
        case id, localPath, jobId, shareToken, workDate, durationSeconds
        case lat, lon, storagePath, uploadUrl, byteSize, sha256Hex, attempt, filed
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(String.self, forKey: .id) ?? UUID().uuidString
        localPath = try c.decode(String.self, forKey: .localPath)
        jobId = try c.decode(String.self, forKey: .jobId)
        shareToken = try c.decodeIfPresent(String.self, forKey: .shareToken)
        workDate = try c.decode(String.self, forKey: .workDate)
        durationSeconds = try c.decode(Double.self, forKey: .durationSeconds)
        lat = try c.decodeIfPresent(Double.self, forKey: .lat)
        lon = try c.decodeIfPresent(Double.self, forKey: .lon)
        storagePath = try c.decodeIfPresent(String.self, forKey: .storagePath)
        uploadUrl = try c.decodeIfPresent(String.self, forKey: .uploadUrl)
        byteSize = try c.decodeIfPresent(Int64.self, forKey: .byteSize)
        sha256Hex = try c.decodeIfPresent(String.self, forKey: .sha256Hex)
        attempt = try c.decodeIfPresent(Int.self, forKey: .attempt) ?? 0
        filed = try c.decodeIfPresent(Bool.self, forKey: .filed) ?? false
    }
}

/// Persists one or more day films in Application Support until the dashboard has them.
enum PendingUploadStore {
    private static let queueKey = "atmosphere.field.pendingDayUploads"
    private static let legacyKey = "atmosphere.field.pendingDayUpload"

    static func loadAll() -> [PendingDayUpload] {
        if let data = UserDefaults.standard.data(forKey: queueKey),
           let items = try? JSONDecoder().decode([PendingDayUpload].self, from: data)
        {
            return items.filter { FileManager.default.fileExists(atPath: $0.localPath) }
        }
        if let legacy = loadLegacy() {
            saveAll([legacy])
            UserDefaults.standard.removeObject(forKey: legacyKey)
            return [legacy]
        }
        return []
    }

    static func saveAll(_ items: [PendingDayUpload]) {
        if let data = try? JSONEncoder().encode(items) {
            UserDefaults.standard.set(data, forKey: queueKey)
        }
    }

    static func upsert(_ item: PendingDayUpload) {
        var items = loadAll()
        if let idx = items.firstIndex(where: { $0.id == item.id }) {
            items[idx] = item
        } else {
            items.append(item)
        }
        saveAll(items)
    }

    static func remove(id: String) {
        saveAll(loadAll().filter { $0.id != id })
    }

    static func clear() {
        UserDefaults.standard.removeObject(forKey: queueKey)
        UserDefaults.standard.removeObject(forKey: legacyKey)
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

    private static func loadLegacy() -> PendingDayUpload? {
        guard let data = UserDefaults.standard.data(forKey: legacyKey) else { return nil }
        return try? JSONDecoder().decode(PendingDayUpload.self, from: data)
    }
}
