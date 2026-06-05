import AVFoundation
import Foundation

// Human: Loads HLS stream metadata and plays video via native HTTP URLs (ticket-gated manifest from the API).
// Agent: CALLS DriveService.fetchVideoStreamURL; BUILDS AVURLAsset from resolveAPIURL; PLAYS on .readyToPlay.
@MainActor
@Observable
final class VideoPlayerViewModel {
    var player: AVPlayer?
    var isLoading = false
    var errorMessage: String?

    private var statusObservation: NSKeyValueObservation?

    func load(file: DriveFile, config: ServerConfig) async {
        player?.pause()
        player = nil
        statusObservation?.invalidate()
        statusObservation = nil
        errorMessage = nil

        guard isVideoMime(file.mimeType) else {
            errorMessage = "This file is not a video."
            return
        }

        if FileProcessing.isProcessing(file) {
            errorMessage = FileProcessing.label(for: file)
            return
        }

        guard file.hlsReady else {
            if file.hlsEncodeStatus == "failed" {
                errorMessage = file.hlsEncodeError ?? "Video processing failed."
            } else {
                errorMessage = "Video is not ready for playback yet."
            }
            return
        }

        isLoading = true
        defer { isLoading = false }

        let result = await DriveService.fetchVideoStreamURL(config: config, fileId: file.id)
        switch result {
        case .failure(let error):
            errorMessage = error.localizedDescription
        case .success(let response):
            guard let path = response.url, !path.isEmpty else {
                errorMessage = response.hlsEncodeError ?? "Video is not ready for playback."
                return
            }
            guard let playlistURL = config.resolveAPIURL(path) else {
                errorMessage = "Could not resolve the stream URL."
                return
            }

            let asset = AVURLAsset(url: playlistURL)
            let item = AVPlayerItem(asset: asset)
            let avPlayer = AVPlayer(playerItem: item)
            avPlayer.automaticallyWaitsToMinimizeStalling = true
            player = avPlayer

            observeItemStatus(item: item, player: avPlayer)
        }
    }

    private func observeItemStatus(item: AVPlayerItem, player: AVPlayer) {
        statusObservation = item.observe(\.status, options: [.initial, .new]) { [weak self] item, _ in
            Task { @MainActor in
                guard let self else { return }
                switch item.status {
                case .readyToPlay:
                    player.play()
                case .failed:
                    let reason = Self.describePlaybackError(item)
                    if self.errorMessage == nil {
                        self.errorMessage = reason
                    }
                default:
                    break
                }
            }
        }
    }

    private static func describePlaybackError(_ item: AVPlayerItem) -> String {
        if let log = item.errorLog(), !log.events.isEmpty {
            let details = log.events.map { event in
                let code = event.errorStatusCode
                let comment = event.errorComment ?? ""
                return comment.isEmpty ? "code \(code)" : "\(comment) (code \(code))"
            }.joined(separator: "; ")
            if !details.isEmpty {
                return details
            }
        }

        guard let error = item.error else { return "Playback failed." }
        let nsError = error as NSError
        if let underlying = nsError.userInfo[NSUnderlyingErrorKey] as? NSError {
            return "\(underlying.localizedDescription) (\(underlying.domain) \(underlying.code))"
        }
        if nsError.domain == NSOSStatusErrorDomain, nsError.code == -12_847 {
            return "The video playlist could not be read. Try again or use the web app for this file."
        }
        if !nsError.localizedDescription.isEmpty,
           nsError.localizedDescription != "The operation could not be completed." {
            return nsError.localizedDescription
        }
        return "Playback failed (\(nsError.domain) \(nsError.code))."
    }
}
