import UIKit

// Human: Global orientation mask so the app stays portrait except during video playback.
// Agent: READ by AppDelegate; WRITES mask when VideoPlayerView appears/disappears; CALLS attemptRotationToDeviceOrientation.
enum OrientationLock {
    private(set) static var mask: UIInterfaceOrientationMask = .portrait

    static func setVideoPlaybackActive(_ active: Bool) {
        mask = active ? [.portrait, .landscapeLeft, .landscapeRight] : .portrait
        guard let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first else {
            return
        }
        scene.keyWindow?.rootViewController?.setNeedsUpdateOfSupportedInterfaceOrientations()

        if !active {
            let preferences = UIWindowScene.GeometryPreferences.iOS(interfaceOrientations: .portrait)
            scene.requestGeometryUpdate(preferences) { _ in }
        }
    }
}

// Human: App delegate hook so UIKit honors OrientationLock while SwiftUI owns the window.
// Agent: application supportedInterfaceOrientationsFor returns OrientationLock.mask.
final class MediaVaultAppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        supportedInterfaceOrientationsFor window: UIWindow?
    ) -> UIInterfaceOrientationMask {
        OrientationLock.mask
    }
}
