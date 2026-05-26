import Foundation
import Network
import Observation

// Human: Tracks device network reachability so the drive can show cached listings offline and resync when back online.
// Agent: NWPathMonitor on background queue; WRITES isOnline + onlineRestoredGeneration on MainActor; READ by DriveViewModel FilesView.
@Observable
@MainActor
final class ConnectivityMonitor {
    static let shared = ConnectivityMonitor()

    private(set) var isOnline = false
    /// Bumped when the path becomes satisfied after it was not (used to trigger session validation + refresh).
    private(set) var onlineRestoredGeneration: UInt = 0

    private let monitor = NWPathMonitor()
    private let queue = DispatchQueue(label: "mediavault.connectivity.monitor")

    private init() {
        isOnline = monitor.currentPath.status == .satisfied

        monitor.pathUpdateHandler = { [weak self] path in
            let online = path.status == .satisfied
            Task { @MainActor in
                guard let self else { return }
                let wasOnline = self.isOnline
                self.isOnline = online
                if !wasOnline, online {
                    self.onlineRestoredGeneration += 1
                }
            }
        }
        monitor.start(queue: queue)
    }
}
