import CryptoKit
import Foundation

/// PUT day film bytes to a signed URL (or multipart parts when provided).
enum MediaUploadClient {
    static func uploadFile(
        localURL: URL,
        uploadURL: URL?,
        multipart: AtmosphereClient.BeginUploadResponse.Session.Multipart?
    ) async throws -> (byteSize: Int64, sha256Hex: String) {
        let data = try Data(contentsOf: localURL)
        let digest = SHA256.hash(data: data)
        let hex = digest.map { String(format: "%02x", $0) }.joined()
        let size = Int64(data.count)

        if let multipart, !multipart.parts.isEmpty {
            try await uploadMultipart(data: data, multipart: multipart)
        } else if let uploadURL {
            var request = URLRequest(url: uploadURL)
            request.httpMethod = "PUT"
            request.setValue("video/mp4", forHTTPHeaderField: "Content-Type")
            request.httpBody = data
            let (_, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, (200 ... 299).contains(http.statusCode) else {
                throw APIError.http(
                    status: (response as? HTTPURLResponse)?.statusCode ?? 0,
                    body: "upload failed"
                )
            }
        } else {
            throw APIError.http(status: 0, body: "No upload URL or multipart plan")
        }
        return (size, hex)
    }

    private static func uploadMultipart(
        data: Data,
        multipart: AtmosphereClient.BeginUploadResponse.Session.Multipart
    ) async throws {
        let partSize = max(1, multipart.partSizeBytes)
        for part in multipart.parts {
            let start = (part.partNumber - 1) * partSize
            guard start < data.count else { break }
            let end = min(data.count, start + partSize)
            let slice = data.subdata(in: start ..< end)
            guard let url = URL(string: part.url) else { continue }
            var request = URLRequest(url: url)
            request.httpMethod = "PUT"
            request.httpBody = slice
            let (_, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, (200 ... 299).contains(http.statusCode) else {
                throw APIError.http(
                    status: (response as? HTTPURLResponse)?.statusCode ?? 0,
                    body: "multipart part \(part.partNumber) failed"
                )
            }
        }
    }
}
