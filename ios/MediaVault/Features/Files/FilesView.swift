import SwiftUI

// Human: Signed-in Files tab — hybrid explorer with recent cards followed by folder-first list navigation.
// Agent: OWNS DriveViewModel; BINDS appState.config; RENDERS DriveExplorerHeader RecentFilesCardView FileExplorerListView.
struct FilesView: View {
    @Environment(\.appState) private var appState
    @State private var viewModel = DriveViewModel()
    @State private var videoFileForPlayback: DriveFile?
    @State private var videoUnavailableMessage: String?
    @State private var showUploadTransferSheet = false

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [DriveExplorerStyle.backgroundTop, DriveExplorerStyle.backgroundBottom],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()

            VStack(spacing: 0) {
                DriveExplorerHeader(
                    viewModel: viewModel,
                    uploadManager: appState.uploadManager,
                    onOpenUploadQueue: { showUploadTransferSheet = true }
                )

                ScrollView {
                    VStack(spacing: 18) {
                        explorerSummary

                        if viewModel.isLoadingInitialContent {
                            loadingState
                                .padding(.top, 48)
                        } else if viewModel.isEmpty {
                            emptyState
                                .padding(.top, 28)
                        } else {
                            if !viewModel.isSearching {
                                RecentFilesCardView(
                                    files: viewModel.files,
                                    config: appState.config,
                                    onOpenVideo: openVideo
                                )
                            }

                            FileExplorerListView(
                                viewModel: viewModel,
                                config: appState.config,
                                onOpenVideo: openVideo
                            )
                        }

                        if viewModel.isLoadingMore {
                            HStack {
                                Spacer()
                                MediaVaultBouncingDots(tint: DriveExplorerStyle.accent)
                                Spacer()
                            }
                            .padding(.vertical, 20)
                        }
                    }
                    .padding(.top, 14)
                    .padding(.bottom, 28)
                }
                .refreshable {
                    await viewModel.refresh()
                }
            }
        }
        .padding(.bottom, 96)
        .preferredColorScheme(.light)
        .overlay(alignment: .bottom) {
            if let error = viewModel.errorMessage {
                errorBanner(error)
                    .padding(.horizontal, 22)
                    .padding(.bottom, 108)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.spring(response: 0.35, dampingFraction: 0.82), value: viewModel.errorMessage)
        .task {
            viewModel.bind(config: appState.config)
            appState.uploadManager.bind(config: appState.config)
            appState.uploadManager.targetFolderId = viewModel.currentFolderId
            appState.uploadManager.onFileUploaded = {
                Task { await viewModel.refresh() }
            }
        }
        .onChange(of: appState.config) { _, newConfig in
            viewModel.bind(config: newConfig)
            appState.uploadManager.bind(config: newConfig)
        }
        .onChange(of: viewModel.currentFolderId) { _, folderId in
            appState.uploadManager.targetFolderId = folderId
        }
        .sheet(isPresented: $showUploadTransferSheet) {
            UploadTransferSheet(uploadManager: appState.uploadManager)
        }
        .onChange(of: appState.uploadManager.hasBatch) { _, hasBatch in
            if hasBatch, !showUploadTransferSheet, appState.uploadManager.isUploading {
                showUploadTransferSheet = true
            }
        }
        .fullScreenCover(item: $videoFileForPlayback) { file in
            VideoPlayerView(file: file, config: appState.config)
        }
        .alert(
            "Video unavailable",
            isPresented: Binding(
                get: { videoUnavailableMessage != nil },
                set: { if !$0 { videoUnavailableMessage = nil } }
            )
        ) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(videoUnavailableMessage ?? "")
        }
    }

    // MARK: - Video playback

    private func openVideo(_ file: DriveFile) {
        guard isVideoMime(file.mimeType) else { return }

        if FileProcessing.isProcessing(file) {
            videoUnavailableMessage = FileProcessing.label(for: file)
            return
        }

        guard file.hlsReady else {
            if file.hlsEncodeStatus == "failed" {
                videoUnavailableMessage = file.hlsEncodeError ?? "Video processing failed."
            } else {
                videoUnavailableMessage = "This video is not ready for playback yet."
            }
            return
        }

        videoFileForPlayback = file
    }

    // MARK: - Loading, empty & error states

    private var loadingState: some View {
        MediaVaultBouncingDots(tint: DriveExplorerStyle.accent)
            .frame(maxWidth: .infinity)
            .accessibilityLabel("Loading files and folders")
    }

    private var explorerSummary: some View {
        HStack(spacing: 10) {
            Label("\(viewModel.folders.count) folders", systemImage: "folder.fill")
            Label("\(viewModel.files.count) files", systemImage: "doc.fill")
            Spacer(minLength: 0)
        }
        .font(.caption.weight(.semibold))
        .foregroundStyle(DriveExplorerStyle.textSecondary)
        .padding(.horizontal, 22)
    }

    private var emptyState: some View {
        VStack(spacing: 14) {
            Image(systemName: viewModel.isSearching ? "magnifyingglass" : "folder")
                .font(.system(size: 40, weight: .light))
                .foregroundStyle(DriveExplorerStyle.textTertiary)

            Text(viewModel.isSearching ? "No matching files" : "This folder is empty")
                .font(.headline)
                .foregroundStyle(DriveExplorerStyle.textPrimary)

            Text(viewModel.isSearching
                 ? "Try a different search term."
                 : "Tap Upload below to add files to this folder.")
                .font(.subheadline)
                .foregroundStyle(DriveExplorerStyle.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
        }
        .frame(maxWidth: .infinity)
    }

    private func errorBanner(_ message: String) -> some View {
        HStack(spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(DriveExplorerStyle.warning)
            Text(message)
                .font(.caption.weight(.medium))
                .foregroundStyle(DriveExplorerStyle.textPrimary)
                .lineLimit(2)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(DriveExplorerStyle.surfaceRaised, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(DriveExplorerStyle.warning.opacity(0.24), lineWidth: 1)
        }
    }
}

#Preview {
    ZStack {
        LinearGradient(
            colors: [DriveExplorerStyle.backgroundTop, DriveExplorerStyle.backgroundBottom],
            startPoint: .top,
            endPoint: .bottom
        )
        .ignoresSafeArea()

        FilesView()
            .environment(\.appState, AppState())
    }
}
