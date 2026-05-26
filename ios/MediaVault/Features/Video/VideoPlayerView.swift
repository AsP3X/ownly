import AVKit
import SwiftUI

// Human: In-app video player — portrait shows chrome; landscape fills the screen until rotated back.
// Agent: READS VideoPlayerViewModel; TOGGLES OrientationLock; USES GeometryReader width>height for fullscreen layout.
struct VideoPlayerView: View {
    let file: DriveFile
    let config: ServerConfig

    @Environment(\.dismiss) private var dismiss
    @State private var viewModel = VideoPlayerViewModel()
    @State private var exportURL: URL?
    @State private var showExportShare = false
    @State private var isExporting = false
    @State private var exportErrorMessage: String?

    var body: some View {
        GeometryReader { geometry in
            let isLandscapeFullscreen = geometry.size.width > geometry.size.height

            ZStack {
                Color.black.ignoresSafeArea()

                if isLandscapeFullscreen {
                    landscapePlayer
                } else {
                    portraitChrome
                }
            }
            .statusBarHidden(isLandscapeFullscreen)
            .persistentSystemOverlays(isLandscapeFullscreen ? .hidden : .automatic)
        }
        .task(id: file.id) {
            await viewModel.load(file: file, config: config)
        }
        .onAppear {
            OrientationLock.setVideoPlaybackActive(true)
        }
        .onDisappear {
            viewModel.player?.pause()
            OrientationLock.setVideoPlaybackActive(false)
        }
        .sheet(isPresented: $showExportShare) {
            if let exportURL {
                DriveActivityShareSheet(items: [exportURL])
                    .presentationDetents([.medium, .large])
            }
        }
        .alert(
            "Export failed",
            isPresented: Binding(
                get: { exportErrorMessage != nil },
                set: { if !$0 { exportErrorMessage = nil } }
            )
        ) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(exportErrorMessage ?? "")
        }
    }

    // MARK: - Layout modes

    @ViewBuilder
    private var portraitChrome: some View {
        VStack(spacing: 0) {
            portraitHeader
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .padding(.bottom, 12)

            playerSurface
                .frame(maxWidth: .infinity, maxHeight: .infinity)

            if let errorMessage = viewModel.errorMessage {
                Text(errorMessage)
                    .font(.subheadline)
                    .foregroundStyle(.white.opacity(0.85))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)
                    .padding(.bottom, 24)
            } else if viewModel.isLoading {
                loadingOverlay
                    .padding(.bottom, 32)
            } else {
                Text("Rotate to landscape for fullscreen")
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.55))
                    .padding(.bottom, 28)
            }
        }
    }

    @ViewBuilder
    private var landscapePlayer: some View {
        ZStack(alignment: .topTrailing) {
            playerSurface
                .ignoresSafeArea()

            if viewModel.isLoading || viewModel.errorMessage != nil {
                VStack(spacing: 12) {
                    if viewModel.isLoading {
                        ProgressView()
                            .tint(.white)
                    }
                    if let errorMessage = viewModel.errorMessage {
                        Text(errorMessage)
                            .font(.subheadline)
                            .foregroundStyle(.white)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 32)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color.black.opacity(0.55))
            }

            HStack(spacing: 12) {
                if file.isHlsStoredVideo {
                    exportButton
                }
                closeButton
            }
            .padding(.top, 12)
            .padding(.trailing, 16)
        }
    }

    private var portraitHeader: some View {
        HStack(spacing: 12) {
            closeButton

            VStack(alignment: .leading, spacing: 2) {
                Text(file.name)
                    .font(.headline)
                    .foregroundStyle(.white)
                    .lineLimit(2)

                if let duration = file.durationSeconds, duration > 0 {
                    Text(formatDuration(duration))
                        .font(.caption)
                        .foregroundStyle(.white.opacity(0.65))
                }
            }

            Spacer(minLength: 0)

            if file.isHlsStoredVideo {
                exportButton
            }
        }
    }

    @ViewBuilder
    private var playerSurface: some View {
        if let player = viewModel.player {
            MediaVaultAVPlayerView(player: player)
                .accessibilityLabel("Video playback for \(file.name)")
        } else if viewModel.isLoading {
            loadingOverlay
        } else {
            Color.clear
        }
    }

    private var loadingOverlay: some View {
        VStack(spacing: 10) {
            ProgressView()
                .tint(.white)
            Text("Loading stream…")
                .font(.subheadline.weight(.medium))
                .foregroundStyle(.white.opacity(0.85))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var closeButton: some View {
        Button {
            dismiss()
        } label: {
            Image(systemName: "xmark.circle.fill")
                .font(.system(size: 28))
                .symbolRenderingMode(.palette)
                .foregroundStyle(.white, .white.opacity(0.28))
        }
        .accessibilityLabel("Close video")
    }

    private var exportButton: some View {
        Button {
            Task { await exportVideo() }
        } label: {
            Group {
                if isExporting {
                    ProgressView()
                        .tint(.white)
                } else {
                    Image(systemName: "square.and.arrow.up")
                        .font(.system(size: 22, weight: .semibold))
                        .foregroundStyle(.white)
                }
            }
            .frame(width: 34, height: 34)
        }
        .disabled(isExporting)
        .accessibilityLabel("Export video")
    }

    private func exportVideo() async {
        guard !isExporting else { return }
        isExporting = true
        defer { isExporting = false }

        switch await DriveService.downloadFileForSharing(config: config, file: file) {
        case .failure(let error):
            exportErrorMessage = error.localizedDescription
        case .success(let url):
            exportURL = url
            showExportShare = true
        }
    }

    private func formatDuration(_ seconds: Int) -> String {
        let minutes = seconds / 60
        let remainder = seconds % 60
        return String(format: "%d:%02d", minutes, remainder)
    }
}
