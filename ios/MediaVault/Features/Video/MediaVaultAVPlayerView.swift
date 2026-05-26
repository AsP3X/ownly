import AVKit
import SwiftUI

// Human: UIKit AVPlayerViewController bridge for native transport controls and aspect-fit video.
// Agent: UIViewControllerRepresentable; READS AVPlayer; UPDATES videoGravity resizeAspect on layout changes.
struct MediaVaultAVPlayerView: UIViewControllerRepresentable {
    let player: AVPlayer

    func makeUIViewController(context: Context) -> AVPlayerViewController {
        let controller = AVPlayerViewController()
        controller.player = player
        controller.showsPlaybackControls = true
        controller.videoGravity = .resizeAspect
        controller.view.backgroundColor = .black
        return controller
    }

    func updateUIViewController(_ controller: AVPlayerViewController, context: Context) {
        if controller.player !== player {
            controller.player = player
        }
        controller.videoGravity = .resizeAspect
    }
}
