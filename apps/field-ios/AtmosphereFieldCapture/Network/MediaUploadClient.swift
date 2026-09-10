import CryptoKit
import Foundation

/// PUT day film bytes to a signed URL from Field app / job-share proof upload.
/// Prefers streaming from disk (and a background-capable session when useful)
/// so multi‑GB films never need the whole file in RAM first.
enum MediaUploadClient {
    /// Match web / BFF chunk plan defaults (8 MB floor; server may return larger).
    static let defaultPartBytes = 8 * 1024 * 1024
    static let maxAssembleBytes = 512 * 1024 * 1024
    static let maxParts = 128

    /// Long-timeout session that streams from disk and waits for connectivity.
    /// True `URLSessionConfiguration.background` still needs an app-delegate
    /// completion handler for suspended multi‑GB transfers; the durable queue
    /// + waitsForConnectivity covers kill / signal loss like web IndexedDB.
    private static let sessionForLargeUpload: URLSession = {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 120
        config.timeoutIntervalForResource = 60 * 60 * 12
        config.waitsForConnectivity = true
        return URLSession(configuration: config)
    }()

    static func sha256Hex(ofFile url: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        var hasher = SHA256()
        while true {
            let chunk = try handle.read(upToCount: 1024 * 1024) ?? Data()
            if chunk.isEmpty { break }
            hasher.update(data: chunk)
        }
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }

    static func byteSize(ofFile url: URL) throws -> Int64 {
        let attrs = try FileManager.default.attributesOfItem(atPath: url.path)
        return (attrs[.size] as? NSNumber)?.int64Value ?? 0
    }

    static func uploadFile(
        localURL: URL,
        uploadURL: URL,
        method: String = "PUT",
        headers: [String: String] = [:]
    ) async throws -> (byteSize: Int64, sha256Hex: String) {
        let size = try byteSize(ofFile: localURL)
        let hex = try sha256Hex(ofFile: localURL)
        try await putFile(localURL: localURL, uploadURL: uploadURL, method: method, headers: headers)
        return (size, hex)
    }

    /// PUT a byte range of `localURL` (multipart part) without loading the film into RAM.
    static func uploadFileRange(
        localURL: URL,
        range: Range<Int64>,
        uploadURL: URL,
        headers: [String: String] = [:]
    ) async throws {
        let handle = try FileHandle(forReadingFrom: localURL)
        defer { try? handle.close() }
        try handle.seek(toOffset: UInt64(range.lowerBound))
        let length = Int(range.upperBound - range.lowerBound)
        guard length > 0 else { return }
        let data = try handle.read(upToCount: length) ?? Data()
        guard data.count == length else {
            throw APIError.http(status: 0, body: "Could not read upload part from disk.")
        }

        var request = URLRequest(url: uploadURL)
        request.httpMethod = "PUT"
        if headers["Content-Type"] == nil {
            request.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
        }
        for (key, value) in headers {
            request.setValue(value, forHTTPHeaderField: key)
        }
        request.httpBody = data
        let (responseData, response) = try await sessionForLargeUpload.data(for: request)
        guard let http = response as? HTTPURLResponse, (200 ... 299).contains(http.statusCode) else {
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            let body = String(data: responseData, encoding: .utf8)?
                .trimmingCharacters(in: .whitespacesAndNewlines)
            throw APIError.http(
                status: status,
                body: (body?.isEmpty == false) ? String(body!.prefix(240)) : "upload part failed"
            )
        }
    }

    static func putFile(
        localURL: URL,
        uploadURL: URL,
        method: String = "PUT",
        headers: [String: String] = [:]
    ) async throws {
        var request = URLRequest(url: uploadURL)
        request.httpMethod = method
        if headers["Content-Type"] == nil {
            request.setValue("video/mp4", forHTTPHeaderField: "Content-Type")
        }
        for (key, value) in headers {
            request.setValue(value, forHTTPHeaderField: key)
        }
        // Stream from disk when PUT; POST fallback paths still use fromFile.
        let (responseData, response) = try await sessionForLargeUpload.upload(for: request, fromFile: localURL)
        guard let http = response as? HTTPURLResponse, (200 ... 299).contains(http.statusCode) else {
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            let body = String(data: responseData, encoding: .utf8)?
                .trimmingCharacters(in: .whitespacesAndNewlines)
            throw APIError.http(
                status: status,
                body: (body?.isEmpty == false) ? String(body!.prefix(240)) : "upload failed"
            )
        }
    }

    /// Slice plan matching BFF `planProofChunks` / web STREAM_PART_BYTES.
    static func shouldMultipart(byteSize: Int64) -> Bool {
        byteSize > Int64(defaultPartBytes) && byteSize <= Int64(maxAssembleBytes)
    }

    static func partRanges(byteSize: Int64, partBytes: Int = defaultPartBytes) -> [Range<Int64>] {
        let slice = Int64(max(4096, partBytes))
        guard byteSize > 0 else { return [] }
        var ranges: [Range<Int64>] = []
        var offset: Int64 = 0
        while offset < byteSize {
            let end = min(byteSize, offset + slice)
            ranges.append(offset ..< end)
            offset = end
            if ranges.count >= maxParts { break }
        }
        return ranges
    }
}
