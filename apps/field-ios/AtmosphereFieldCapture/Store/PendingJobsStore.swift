import Foundation

/// Phone-only job drafts — web `atm.field.pendingJobs` parity.
/// Recording can start against a local id; office POST remaps when signal returns.
enum PendingJobsStore {
    static let key = "atm.field.pendingJobs"

    static func isLocalJobId(_ id: String) -> Bool {
        id.hasPrefix("local-") || id.hasPrefix("new-")
    }

    static func draft(title: String, situation: String, address: String = "") -> ExpectedJob {
        let now = Int(Date().timeIntervalSince1970 * 1000)
        let rand = String(UInt32.random(in: 0 ... 0xffffff), radix: 36)
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        return ExpectedJob(
            id: "local-\(now)-\(rand)",
            number: "",
            name: trimmed.isEmpty ? "Job" : trimmed,
            address: address,
            at: "Today",
            placed: true,
            status: nil,
            filmed: false,
            pending: true,
            situation: situation.trimmingCharacters(in: .whitespacesAndNewlines),
            serverId: nil,
            title: trimmed
        )
    }

    static func read() -> [ExpectedJob] {
        guard let data = UserDefaults.standard.data(forKey: key) else { return [] }
        return (try? JSONDecoder().decode([ExpectedJob].self, from: data))?.filter { !$0.id.isEmpty } ?? []
    }

    static func write(_ jobs: [ExpectedJob]) {
        let clean = jobs.filter { !$0.id.isEmpty }
        if let data = try? JSONEncoder().encode(clean) {
            UserDefaults.standard.set(data, forKey: key)
        }
    }

    @discardableResult
    static func upsert(_ job: ExpectedJob) -> [ExpectedJob] {
        var next = read().filter { $0.id != job.id }
        next.insert(job, at: 0)
        write(next)
        return next
    }

    @discardableResult
    static func markSynced(localId: String) -> [ExpectedJob] {
        let next = read().filter { $0.id != localId }
        write(next)
        return next
    }

    static func clear() {
        UserDefaults.standard.removeObject(forKey: key)
    }

    /// Local drafts stay visible even when the office list is empty or stale.
    static func merge(serverJobs: [ExpectedJob], pendingJobs: [ExpectedJob]) -> [ExpectedJob] {
        var serverIds = Set<String>()
        for j in serverJobs {
            serverIds.insert(j.id)
            if let sid = j.serverId { serverIds.insert(sid) }
        }
        let extras = pendingJobs.filter { j in
            if let sid = j.serverId, serverIds.contains(sid) { return false }
            if serverIds.contains(j.id) { return false }
            return isLocalJobId(j.id) || j.pending == true
        }
        return extras + serverJobs
    }
}
