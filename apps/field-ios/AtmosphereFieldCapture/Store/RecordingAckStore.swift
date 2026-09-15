import Foundation

/// Phone-side cache of recording-on-property acknowledgments for the live disclosure version.
enum RecordingAckStore {
    private static let prefix = "atm.field.recordingAck:"

    private static func key(jobId: String, workDate: String, version: String) -> String {
        "\(prefix)\(jobId):\(workDate):\(version)"
    }

    static func hasAck(
        jobId: String,
        workDate: String,
        version: String = AtmosphereClient.recordingDisclosureVersion
    ) -> Bool {
        UserDefaults.standard.bool(forKey: key(jobId: jobId, workDate: workDate, version: version))
    }

    static func mark(
        jobId: String,
        workDate: String,
        version: String = AtmosphereClient.recordingDisclosureVersion
    ) {
        UserDefaults.standard.set(true, forKey: key(jobId: jobId, workDate: workDate, version: version))
    }

    static func clear(jobId: String, workDate: String, version: String = AtmosphereClient.recordingDisclosureVersion) {
        UserDefaults.standard.removeObject(forKey: key(jobId: jobId, workDate: workDate, version: version))
    }
}
