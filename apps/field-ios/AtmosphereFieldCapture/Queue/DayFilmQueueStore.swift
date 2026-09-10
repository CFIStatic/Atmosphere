import Foundation

/// File-on-disk + JSON index, surviving app kill like web IndexedDB queue.
actor DayFilmQueueStore {
    static let shared = DayFilmQueueStore()

    private let fm = FileManager.default
    private let root: URL
    private let indexURL: URL

    init(root: URL? = nil) {
        let base: URL
        if let root {
            base = root
        } else {
            let support = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
                ?? fm.temporaryDirectory
            base = support.appendingPathComponent("DayFilmQueue", isDirectory: true)
        }
        self.root = base
        self.indexURL = base.appendingPathComponent("index.json", isDirectory: false)
        try? fm.createDirectory(at: base, withIntermediateDirectories: true)
    }

    func list() throws -> [DayFilmQueueEntry] {
        guard fm.fileExists(atPath: indexURL.path) else { return [] }
        let data = try Data(contentsOf: indexURL)
        let rows = try JSONDecoder().decode([DayFilmQueueEntry].self, from: data)
        return rows.sorted { a, b in
            let ta = a.recordedAt
            let tb = b.recordedAt
            if ta != tb { return ta < tb }
            return a.id < b.id
        }
    }

    func save(_ entry: DayFilmQueueEntry) throws {
        var rows = (try? list()) ?? []
        if let idx = rows.firstIndex(where: { $0.id == entry.id }) {
            rows[idx] = entry
        } else {
            rows.append(entry)
        }
        try writeIndex(rows)
    }

    func update(id: String, mutate: (inout DayFilmQueueEntry) -> Void) throws -> DayFilmQueueEntry? {
        var rows = try list()
        guard let idx = rows.firstIndex(where: { $0.id == id }) else { return nil }
        mutate(&rows[idx])
        try writeIndex(rows)
        return rows[idx]
    }

    /// Remap every film waiting on a phone-only draft id onto the office job id.
    @discardableResult
    func remapJobId(from localId: String, to serverId: String) throws -> Int {
        guard localId != serverId else { return 0 }
        var rows = try list()
        var count = 0
        for i in rows.indices where rows[i].jobId == localId {
            rows[i].jobId = serverId
            rows[i].jobDraft = nil
            count += 1
        }
        if count > 0 { try writeIndex(rows) }
        return count
    }

    func remove(id: String) throws {
        var rows = try list()
        if let entry = rows.first(where: { $0.id == id }) {
            let url = fileURL(for: entry)
            try? fm.removeItem(at: url)
        }
        rows.removeAll { $0.id == id }
        try writeIndex(rows)
    }

    func fileURL(for entry: DayFilmQueueEntry) -> URL {
        root.appendingPathComponent(entry.fileName, isDirectory: false)
    }

    /// Persist the finished MP4 into the durable queue directory (copy, then
    /// caller may delete the recorder temp). Returns the entry ready to enqueue.
    func persistFilm(
        from localURL: URL,
        jobId: String,
        jobName: String,
        clipId: String,
        workDate: String,
        durationSeconds: Double,
        lat: Double?,
        lon: Double?,
        accuracyM: Double?,
        mode: DayFilmQueueEntry.Mode = .account,
        shareToken: String? = nil,
        jobDraft: JobDraftPayload? = nil
    ) throws -> DayFilmQueueEntry {
        let id = "film-\(Int(Date().timeIntervalSince1970 * 1000))-\(String(UInt16.random(in: 0 ... .max), radix: 16))"
        let fileName = "\(id).mp4"
        let dest = root.appendingPathComponent(fileName, isDirectory: false)
        if fm.fileExists(atPath: dest.path) {
            try fm.removeItem(at: dest)
        }
        try fm.copyItem(at: localURL, to: dest)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        var mutable = dest
        try? mutable.setResourceValues(values)

        let attrs = try fm.attributesOfItem(atPath: dest.path)
        let byteSize = (attrs[.size] as? NSNumber)?.int64Value ?? 0
        let iso = ISO8601DateFormatter().string(from: Date())

        let entry = DayFilmQueueEntry(
            id: id,
            jobId: jobId,
            jobName: jobName,
            clipId: ClipId.resolve(clipId),
            workDate: workDate,
            phase: "after",
            fileName: fileName,
            mimeType: "video/mp4",
            byteSize: byteSize,
            durationSeconds: durationSeconds > 0 ? durationSeconds : nil,
            recordedAt: iso,
            lat: lat,
            lon: lon,
            accuracyM: accuracyM,
            contentHash: nil,
            storagePath: nil,
            status: .queued,
            attempts: 0,
            lastError: "",
            lastStatus: 0,
            nextAttemptAt: 0,
            streamBytesDone: 0,
            streamPartCount: 0,
            streamFailed: false,
            mode: mode,
            shareToken: shareToken,
            jobDraft: jobDraft
        )
        try save(entry)
        return entry
    }

    func pendingCount() throws -> Int {
        try list().filter(\.isPending).count
    }

    private func writeIndex(_ rows: [DayFilmQueueEntry]) throws {
        try fm.createDirectory(at: root, withIntermediateDirectories: true)
        let data = try JSONEncoder().encode(rows)
        try data.write(to: indexURL, options: [.atomic])
    }
}
