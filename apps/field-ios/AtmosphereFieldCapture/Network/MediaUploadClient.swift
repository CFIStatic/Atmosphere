import CryptoKit
import Foundation

/// PUT day film bytes to a signed URL from Field app / job-share proof upload.
enum MediaUploadClient {
    static func uploadFile(
        localURL: URL,
        uploadURL: URL,
        method: String = "PUT",
        headers: [String: String] = [:]
    ) async throws -> (byteSize: Int64, sha256Hex: String) {
        let data = try Data(contentsOf: localURL)
        let digest = SHA256.hash(data: data)
        let hex = digest.map { String(format: "%02x", $0) }.joined()
        let size = Int64(data.count)

        var request = URLRequest(url: uploadURL)
        request.httpMethod = method
        if headers["Content-Type"] == nil {
            request.setValue("video/mp4", forHTTPHeaderField: "Content-Type")
        }
        for (key, value) in headers {
            request.setValue(value, forHTTPHeaderField: key)
        }
        request.httpBody = data
        let (_, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200 ... 299).contains(http.statusCode) else {
            throw APIError.http(
                status: (response as? HTTPURLResponse)?.statusCode ?? 0,
                body: "upload failed"
            )
        }
        return (size, hex)
    }
}
