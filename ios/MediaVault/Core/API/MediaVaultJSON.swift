import Foundation

// Human: Shared JSON decoding for MediaVault API responses (ISO8601 dates, snake_case keys).
// Agent: USED DriveService AuthService; DECODES backend timestamps with optional fractional seconds.
enum MediaVaultJSON {
    // Human: Decoder factory for drive API payloads — models use explicit CodingKeys for snake_case fields.
    // Agent: Returns a fresh JSONDecoder to avoid sharing non-Sendable decoder state across actor contexts.
    nonisolated static func makeDecoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom(decodeDate)
        return decoder
    }

    nonisolated static func makeEncoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .custom(encodeDate)
        return encoder
    }

    nonisolated private static func encodeDate(_ date: Date, into encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        try container.encode(formatter.string(from: date))
    }

    nonisolated private static func decodeDate(from decoder: Decoder) throws -> Date {
        let container = try decoder.singleValueContainer()
        let value = try container.decode(String.self)

        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFraction.date(from: value) {
            return date
        }

        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        if let date = plain.date(from: value) {
            return date
        }

        throw DecodingError.dataCorruptedError(
            in: container,
            debugDescription: "Invalid ISO8601 date: \(value)"
        )
    }
}
