import Foundation

// Human: Client-side starred files — same key as the web drive until the API tracks favourites.
// Agent: READS/WRITES UserDefaults `Ownly_favourite_files`; USED context menu + Home-style picks later.
@Observable
@MainActor
final class DriveFavouritesStore {
    static let shared = DriveFavouritesStore()

    private static let storageKey = "Ownly_favourite_files"

    private(set) var ids: Set<String> = []

    private init() {
        reload()
    }

    func reload() {
        guard let raw = UserDefaults.standard.string(forKey: Self.storageKey),
              let data = raw.data(using: .utf8),
              let decoded = try? JSONDecoder().decode([String].self, from: data) else {
            ids = []
            return
        }
        ids = Set(decoded)
    }

    func isFavourite(_ fileId: String) -> Bool {
        ids.contains(fileId)
    }

    /// Toggles starred state; returns whether the file is favourited after the toggle.
    @discardableResult
    func toggle(_ fileId: String) -> Bool {
        if ids.contains(fileId) {
            ids.remove(fileId)
        } else {
            ids.insert(fileId)
        }
        persist()
        return ids.contains(fileId)
    }

    func remove(_ fileId: String) {
        guard ids.contains(fileId) else { return }
        ids.remove(fileId)
        persist()
    }

    private func persist() {
        let ordered = Array(ids)
        guard let data = try? JSONEncoder().encode(ordered),
              let raw = String(data: data, encoding: .utf8) else { return }
        UserDefaults.standard.set(raw, forKey: Self.storageKey)
    }
}
