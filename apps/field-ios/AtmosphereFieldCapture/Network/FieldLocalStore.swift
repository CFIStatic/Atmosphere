import Foundation

/// Jobs this login already measured — do not keep asking.
enum MeasuredJobStore {
    private static let key = "atmosphere.field.measuredJobIds"

    static func ids() -> Set<String> {
        Set(UserDefaults.standard.stringArray(forKey: key) ?? [])
    }

    static func contains(_ jobId: String) -> Bool {
        ids().contains(jobId)
    }

    static func add(_ jobId: String) {
        var next = ids()
        next.insert(jobId)
        UserDefaults.standard.set(Array(next), forKey: key)
    }

    static func clear() {
        UserDefaults.standard.removeObject(forKey: key)
    }
}

/// Invite opened while signed out — show it after this login connects.
enum PendingInviteStore {
    private static let key = "atmosphere.field.pendingInviteToken"

    static func save(_ token: String) {
        UserDefaults.standard.set(token, forKey: key)
    }

    static func load() -> String? {
        UserDefaults.standard.string(forKey: key)
    }

    static func clear() {
        UserDefaults.standard.removeObject(forKey: key)
    }
}

struct AcceptedInviteJob: Codable, Equatable {
    var job: ExpectedJob
    var shareToken: String
}

/// Jobs accepted from invites on this login. Survives Today refresh.
enum AcceptedInviteStore {
    private static let key = "atmosphere.field.acceptedInviteJobs"

    static func load() -> [AcceptedInviteJob] {
        guard let data = UserDefaults.standard.data(forKey: key) else { return [] }
        return (try? JSONDecoder().decode([AcceptedInviteJob].self, from: data)) ?? []
    }

    static func save(_ items: [AcceptedInviteJob]) {
        if let data = try? JSONEncoder().encode(items) {
            UserDefaults.standard.set(data, forKey: key)
        }
    }

    static func upsert(_ item: AcceptedInviteJob) {
        var items = load().filter { $0.job.id != item.job.id && $0.shareToken != item.shareToken }
        items.insert(item, at: 0)
        save(items)
    }

    static func token(for jobId: String) -> String? {
        load().first(where: { $0.job.id == jobId })?.shareToken
    }

    static func clear() {
        UserDefaults.standard.removeObject(forKey: key)
    }
}
