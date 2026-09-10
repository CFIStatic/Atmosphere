import Foundation
import Network

/// Durable save-first filing queue — web `createDayFilmQueue` semantics on iOS:
/// persist locally first, upload oldest-first forever with exponential backoff,
/// wake on foreground / path-satisfied. Survives app kill via `DayFilmQueueStore`.
@MainActor
final class DayFilmUploadQueue: ObservableObject {
    static let shared = DayFilmUploadQueue()

    @Published private(set) var entries: [DayFilmQueueEntry] = []
    @Published private(set) var filingStep: DayFilmFilingStep = .idle
    @Published private(set) var activeEntryId: String?

    private let store = DayFilmQueueStore.shared
    private var api: AtmosphereClient?
    private var running = false
    private var kickTask: Task<Void, Never>?
    private var pathMonitor: NWPathMonitor?
    private let retryBaseMs: Double = 5_000
    private let retryCapMs: Double = 60_000

    func bind(api: AtmosphereClient) {
        self.api = api
        startPathMonitor()
        Task { await reloadAndKick(reason: "bind") }
    }

    func reloadAndKick(reason: String) async {
        do {
            var list = try await store.list()
            // A film left "uploading" by a killed process starts over — signed
            // URLs are minted fresh (same as web queue load).
            for i in list.indices where list[i].status == .uploading {
                list[i].status = .queued
                list[i].nextAttemptAt = 0
                try await store.save(list[i])
            }
            entries = list.filter(\.isPending)
            updateFilingStep()
            kick(reason: reason)
        } catch {
            filingStep = .stuck(error.localizedDescription)
        }
    }

    /// Persist MP4 + metadata, then return immediately — upload is async.
    func enqueuePersisted(_ entry: DayFilmQueueEntry) async {
        entries = ((try? await store.list()) ?? []).filter(\.isPending)
        if !entries.contains(where: { $0.id == entry.id }) {
            entries.append(entry)
        }
        filingStep = .saved
        kick(reason: "enqueue")
    }

    func pendingSavedCount() -> Int {
        entries.filter(\.isPending).count
    }

    func entry(id: String) -> DayFilmQueueEntry? {
        entries.first(where: { $0.id == id })
    }

    private func startPathMonitor() {
        guard pathMonitor == nil else { return }
        let monitor = NWPathMonitor()
        pathMonitor = monitor
        monitor.pathUpdateHandler = { [weak self] path in
            Task { @MainActor in
                guard let self else { return }
                if path.status == .satisfied {
                    self.kick(reason: "online")
                } else {
                    self.updateFilingStep(forceWaiting: true)
                }
            }
        }
        monitor.start(queue: DispatchQueue(label: "atm.field.dayfilm.path"))
    }

    private func kick(reason: String) {
        kickTask?.cancel()
        kickTask = Task { [weak self] in
            await self?.pump(reason: reason)
        }
    }

    private func backoffMs(attempt: Int) -> Double {
        let n = max(0, attempt)
        return min(retryCapMs, retryBaseMs * pow(2.0, Double(n)))
    }

    private func updateFilingStep(forceWaiting: Bool = false) {
        if forceWaiting, entries.contains(where: \.isPending) {
            filingStep = .waitingForSignal
            return
        }
        if let active = entries.first(where: { $0.id == activeEntryId }) {
            filingStep = .uploading(progress: 0, detail: active.jobName)
            return
        }
        if let stuck = entries.first(where: { !$0.lastError.isEmpty && $0.attempts >= 3 }) {
            if stuck.lastStatus == 401 {
                filingStep = .needsSignIn
            } else {
                filingStep = .stuck(stuck.lastError)
            }
            return
        }
        if entries.contains(where: \.isPending) {
            filingStep = .saved
        } else if case .uploading = filingStep {
            filingStep = .filed
        } else if entries.isEmpty {
            // keep last terminal state briefly; idle when nothing pending
            if case .filed = filingStep { return }
            filingStep = .idle
        }
    }

    private func pump(reason _: String) async {
        guard !running else { return }
        guard let api else { return }
        running = true
        defer { running = false }

        while !Task.isCancelled {
            let now = Date().timeIntervalSince1970
            let pending = ((try? await store.list()) ?? []).filter(\.isPending)
            entries = pending
            guard let next = pending.first(where: { $0.nextAttemptAt <= now && $0.status != .uploading })
            else {
                updateFilingStep()
                // Schedule soonest future attempt.
                let soonest = pending.map(\.nextAttemptAt).filter { $0 > now }.min()
                if let soonest {
                    let delay = min(max(0.2, soonest - now), retryCapMs / 1000)
                    try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
                    continue
                }
                return
            }

            activeEntryId = next.id
            filingStep = .uploading(progress: 0, detail: next.jobName)
            var working = next
            working.status = .uploading
            try? await store.save(working)

            do {
                let result = try await uploadOne(entry: working, api: api)
                working.status = .filed
                working.storagePath = result.storagePath
                working.contentHash = result.contentHash
                working.lastError = ""
                working.lastStatus = 200
                try await store.save(working)
                // Remove filed bytes after success (meta kept briefly then dropped).
                try? await store.remove(id: working.id)
                activeEntryId = nil
                entries = ((try? await store.list()) ?? []).filter(\.isPending)
                filingStep = entries.isEmpty ? .filed : .saved
                NotificationCenter.default.post(
                    name: .dayFilmQueueDidFile,
                    object: nil,
                    userInfo: [
                        "entryId": working.id,
                        "jobId": working.jobId,
                        "clipId": working.clipId,
                        "proofId": result.proofId as Any,
                        "storagePath": result.storagePath,
                        "byteSize": result.byteSize,
                        "contentHash": result.contentHash as Any,
                    ]
                )
            } catch {
                let status: Int = {
                    if case let APIError.http(s, _) = error { return s }
                    return 0
                }()
                if let latest = try? await store.list(),
                   let row = latest.first(where: { $0.id == working.id }) {
                    working.streamFailed = row.streamFailed
                }
                working.status = .queued
                working.attempts += 1
                working.lastError = error.localizedDescription
                working.lastStatus = status
                working.nextAttemptAt = Date().timeIntervalSince1970 + backoffMs(attempt: working.attempts) / 1000
                if status == 401 {
                    // Give AuthSession a chance to refresh; queue retries after backoff.
                    do { try await api.onUnauthorized?() } catch { /* sign-in needed */ }
                }
                try? await store.save(working)
                activeEntryId = nil
                entries = ((try? await store.list()) ?? []).filter(\.isPending)
                if status == 401 {
                    filingStep = .needsSignIn
                } else if AtmosphereClient.isUnreachable(error) {
                    filingStep = .waitingForSignal
                } else {
                    filingStep = .stuck(working.lastError)
                }
                let delay = backoffMs(attempt: working.attempts) / 1000
                try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            }
        }
    }

    private struct UploadResult {
        var storagePath: String
        var byteSize: Int64
        var contentHash: String?
        var proofId: String?
    }

    private func uploadOne(entry: DayFilmQueueEntry, api: AtmosphereClient) async throws -> UploadResult {
        let localURL = await store.fileURL(for: entry)
        guard FileManager.default.fileExists(atPath: localURL.path) else {
            throw APIError.http(status: 0, body: "Saved day film is missing on this phone.")
        }
        let size = try MediaUploadClient.byteSize(ofFile: localURL)
        let clipId = ClipId.resolve(entry.clipId)

        var storagePath: String
        var byteSize: Int64
        var hash: String

        let useMultipart = MediaUploadClient.shouldMultipart(byteSize: size) && !entry.streamFailed

        if useMultipart {
            do {
                let begin = try await api.beginJobProofUpload(
                    jobId: entry.jobId,
                    workDate: entry.workDate,
                    phase: entry.phase,
                    fileExtension: "mp4",
                    clipId: clipId,
                    byteSize: size
                )
                let parts = begin.parts ?? []
                if parts.count >= 2 {
                    let uploaded = try await api.uploadProofMedia(localURL: localURL, begin: begin)
                    _ = try await api.completeJobProofUpload(
                        jobId: entry.jobId,
                        workDate: entry.workDate,
                        phase: entry.phase,
                        storagePath: begin.path,
                        partCount: parts.count
                    )
                    storagePath = begin.path
                    byteSize = uploaded.byteSize
                    hash = uploaded.sha256Hex
                } else {
                    // Slot had no parts — mint via upload-part-url like web streamer tail.
                    let multi = try await api.uploadProofMediaMultipartViaPartUrls(
                        jobId: entry.jobId,
                        localURL: localURL,
                        workDate: entry.workDate,
                        clipId: clipId,
                        phase: entry.phase
                    )
                    storagePath = multi.storagePath
                    byteSize = multi.byteSize
                    hash = multi.sha256Hex
                }
            } catch {
                // 4xx stitch / part failure → whole-object fallback next attempt.
                if case let APIError.http(status, _) = error, (400 ... 499).contains(status), status != 401 {
                    var failed = entry
                    failed.streamFailed = true
                    try? await store.save(failed)
                }
                throw error
            }
        } else {
            let begin = try await api.beginJobProofUpload(
                jobId: entry.jobId,
                workDate: entry.workDate,
                phase: entry.phase,
                fileExtension: "mp4",
                clipId: clipId,
                byteSize: size
            )
            let uploaded = try await api.uploadProofMedia(localURL: localURL, begin: begin)
            if let parts = begin.parts, parts.count >= 2 {
                _ = try await api.completeJobProofUpload(
                    jobId: entry.jobId,
                    workDate: entry.workDate,
                    phase: entry.phase,
                    storagePath: begin.path,
                    partCount: parts.count
                )
            }
            storagePath = uploaded.storagePath
            byteSize = uploaded.byteSize
            hash = uploaded.sha256Hex
        }

        let recorded = try await api.completeJobProof(
            jobId: entry.jobId,
            body: .init(
                workDate: entry.workDate,
                phase: entry.phase,
                storagePath: storagePath,
                byteSize: byteSize,
                durationSeconds: entry.durationSeconds,
                contentHash: hash,
                capturedAt: entry.recordedAt,
                lat: entry.lat,
                lon: entry.lon,
                accuracyM: entry.accuracyM,
                clipId: clipId
            )
        )

        return UploadResult(
            storagePath: storagePath,
            byteSize: byteSize,
            contentHash: hash,
            proofId: recorded.proof?.id
        )
    }
}

extension Notification.Name {
    static let dayFilmQueueDidFile = Notification.Name("atm.field.dayFilmQueueDidFile")
}
