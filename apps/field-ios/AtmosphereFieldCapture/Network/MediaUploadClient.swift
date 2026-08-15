import CryptoKit
import Foundation

/// PUT / POST a local file without loading it into RAM.
///
/// Day films can be multi-GB. A background `URLSession` upload-from-file
/// survives leaving the app; if the PUT dies, we retry the same file
/// (storage upserts) after minting a fresh signed URL.
final class MediaUploadClient: NSObject, URLSessionTaskDelegate {
    static let shared = MediaUploadClient()

    var onProgress: ((Double) -> Void)?

    private var continuations: [Int: CheckedContinuation<(Int64, String), Error>] = [:]
    private var expectedBytes: [Int: Int64] = [:]
    private var hashes: [Int: String] = [:]
    private let lock = NSLock()

    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.background(
            withIdentifier: "com.atmosphere.fieldcapture.dayfilm"
        )
        config.isDiscretionary = false
        config.sessionSendsLaunchEvents = true
        config.allowsCellularAccess = true
        config.waitsForConnectivity = true
        config.timeoutIntervalForRequest = 300
        config.timeoutIntervalForResource = 86_400
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()

    static func hashFile(_ localURL: URL) throws -> (byteSize: Int64, sha256Hex: String) {
        let handle = try FileHandle(forReadingFrom: localURL)
        defer { try? handle.close() }
        var hasher = SHA256()
        var size: Int64 = 0
        while true {
            let chunk = handle.readData(ofLength: 1_048_576)
            if chunk.isEmpty { break }
            hasher.update(data: chunk)
            size += Int64(chunk.count)
        }
        let hex = hasher.finalize().map { String(format: "%02x", $0) }.joined()
        return (size, hex)
    }

    func uploadFile(
        localURL: URL,
        uploadURL: URL,
        method: String = "PUT",
        headers: [String: String] = [:],
        contentType: String = "video/mp4"
    ) async throws -> (byteSize: Int64, sha256Hex: String) {
        let hashed = try Self.hashFile(localURL)
        var request = URLRequest(url: uploadURL)
        request.httpMethod = method
        request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        for (key, value) in headers {
            request.setValue(value, forHTTPHeaderField: key)
        }
        return try await withCheckedThrowingContinuation { continuation in
            let task = session.uploadTask(with: request, fromFile: localURL)
            lock.lock()
            continuations[task.taskIdentifier] = continuation
            expectedBytes[task.taskIdentifier] = hashed.byteSize
            hashes[task.taskIdentifier] = hashed.sha256Hex
            lock.unlock()
            task.resume()
        }
    }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didSendBodyData bytesSent: Int64,
        totalBytesSent: Int64,
        totalBytesExpectedToSend: Int64
    ) {
        let expected = totalBytesExpectedToSend > 0
            ? totalBytesExpectedToSend
            : (expectedBytes[task.taskIdentifier] ?? 0)
        guard expected > 0 else { return }
        let fraction = min(1, Double(totalBytesSent) / Double(expected))
        DispatchQueue.main.async { [weak self] in
            self?.onProgress?(fraction)
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        lock.lock()
        let continuation = continuations.removeValue(forKey: task.taskIdentifier)
        let expected = expectedBytes.removeValue(forKey: task.taskIdentifier)
        let hash = hashes.removeValue(forKey: task.taskIdentifier) ?? ""
        lock.unlock()
        guard let continuation else { return }
        if let error {
            continuation.resume(throwing: error)
            return
        }
        let status = (task.response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200 ... 299).contains(status) else {
            continuation.resume(throwing: APIError.http(status: status, body: "upload failed"))
            return
        }
        let size = expected ?? task.countOfBytesSent
        continuation.resume(returning: (size, hash))
    }
}
