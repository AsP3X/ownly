import SwiftUI

// Human: Signed-in Files tab — hybrid explorer with recent cards followed by folder-first list navigation.
// Agent: OWNS DriveViewModel; BINDS appState.config + ConnectivityMonitor; RENDERS offline cache or connection error UI.
struct FilesView: View {
    @Environment(\.appState) private var appState
    var onSessionExpired: (() -> Void)? = nil

    @State private var viewModel = DriveViewModel()
    @State private var connectivity = ConnectivityMonitor.shared
    @State private var videoFileForPlayback: DriveFile?
    @State private var videoUnavailableMessage: String?
    @State private var showUploadTransferSheet = false
    @State private var detailsTarget: DriveActionTarget?
    @State private var deleteTarget: DriveActionTarget?
    @State private var activityShareItems: [Any] = []
    @State private var showActivityShare = false
    @State private var isPerformingDriveAction = false
    @State private var driveActionStatus = "Working…"
    @State private var successMessage: String?

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
                        if viewModel.isOfflineMode {
                            offlineBanner
                        }

                        if viewModel.showsConnectionError {
                            DriveConnectionErrorView(
                                isRetrying: viewModel.isRetryingConnection,
                                onRetry: {
                                    Task { await viewModel.retryConnection() }
                                }
                            )
                        } else {
                            explorerSummary
                        }

                        if viewModel.showsConnectionError {
                            EmptyView()
                        } else if viewModel.isLoadingInitialContent {
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
                                    favouriteIds: DriveFavouritesStore.shared.ids,
                                    onOpenVideo: openVideo,
                                    onFileAction: handleFileMenuAction
                                )
                            }

                            FileExplorerListView(
                                viewModel: viewModel,
                                config: appState.config,
                                favouriteIds: DriveFavouritesStore.shared.ids,
                                onOpenVideo: openVideo,
                                onFileAction: handleFileMenuAction,
                                onFolderAction: handleFolderMenuAction
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
                // Agent: Detached task avoids SwiftUI cancelling URLSession when the pull gesture ends.
                .refreshable {
                    await Task.detached { @MainActor in
                        if viewModel.showsConnectionError {
                            await viewModel.retryConnection()
                        } else {
                            await viewModel.refresh()
                        }
                    }.value
                }
            }
        }
        .padding(.bottom, 96)
        .preferredColorScheme(.light)
        .overlay(alignment: .bottom) {
            VStack(spacing: 10) {
                if isPerformingDriveAction {
                    performingBanner
                }
                if let successMessage {
                    successBanner(successMessage)
                }
                if let error = viewModel.errorMessage {
                    errorBanner(error)
                }
            }
            .padding(.horizontal, 22)
            .padding(.bottom, 108)
            .animation(.spring(response: 0.35, dampingFraction: 0.82), value: viewModel.errorMessage)
            .animation(.spring(response: 0.35, dampingFraction: 0.82), value: successMessage)
            .animation(.spring(response: 0.35, dampingFraction: 0.82), value: isPerformingDriveAction)
        }
        .task {
            viewModel.onSessionExpired = onSessionExpired
            viewModel.bind(config: appState.config)
            appState.uploadManager.bind(config: appState.config)
            appState.uploadManager.targetFolderId = viewModel.currentFolderId
            appState.uploadManager.onFileUploaded = {
                Task { await viewModel.refresh() }
            }
        }
        .onChange(of: connectivity.isOnline) { wasOnline, isOnline in
            if wasOnline, !isOnline {
                viewModel.handleConnectivityLost()
            }
        }
        .onChange(of: connectivity.onlineRestoredGeneration) { _, generation in
            Task {
                await viewModel.observeConnectivityRestored(generation: generation)
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
        .sheet(item: $detailsTarget) { target in
            DriveItemDetailsSheet(target: target, config: appState.config) {
                Task { await viewModel.refresh() }
            }
        }
        .sheet(isPresented: $showActivityShare) {
            DriveActivityShareSheet(items: activityShareItems)
                .presentationDetents([.medium, .large])
        }
        .confirmationDialog(
            deleteDialogTitle,
            isPresented: Binding(
                get: { deleteTarget != nil },
                set: { if !$0 { deleteTarget = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) {
                guard let target = deleteTarget else { return }
                deleteTarget = nil
                Task { await performDelete(target) }
            }
            Button("Cancel", role: .cancel) {
                deleteTarget = nil
            }
        } message: {
            Text(deleteDialogMessage)
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

    // MARK: - Context menu actions

    private var deleteDialogTitle: String {
        guard let deleteTarget else { return "Delete?" }
        switch deleteTarget {
        case .file:
            return "Delete file?"
        case .folder:
            return "Delete folder?"
        }
    }

    private var deleteDialogMessage: String {
        guard let deleteTarget else { return "" }
        return "“\(deleteTarget.name)” will be removed permanently."
    }

    private func handleFileMenuAction(file: DriveFile, action: DriveFileMenuAction) {
        switch action {
        case .details:
            detailsTarget = .file(file)
        case .download:
            Task { await downloadFile(file) }
        case .toggleFavourite:
            let favourited = DriveFavouritesStore.shared.toggle(file.id)
            flashSuccess(favourited ? "Added to favourites" : "Removed from favourites")
        case .shareLink:
            Task { await copyPublicLink(resourceType: "file", resourceId: file.id, name: file.name) }
        case .delete:
            deleteTarget = .file(file)
        }
    }

    private func handleFolderMenuAction(folder: DriveFolder, action: DriveFolderMenuAction) {
        switch action {
        case .details:
            detailsTarget = .folder(folder)
        case .download:
            Task { await downloadFolder(folder) }
        case .shareLink:
            Task { await copyPublicLink(resourceType: "folder", resourceId: folder.id, name: folder.name) }
        case .delete:
            deleteTarget = .folder(folder)
        }
    }

    private func copyPublicLink(resourceType: String, resourceId: String, name: String) async {
        isPerformingDriveAction = true
        defer { isPerformingDriveAction = false }

        switch await DriveService.ensurePublicSharePageURL(
            config: appState.config,
            resourceType: resourceType,
            resourceId: resourceId
        ) {
        case .failure(let error):
            viewModel.reportError(error.localizedDescription)
        case .success(let url):
            UIPasteboard.general.string = url.absoluteString
            flashSuccess("Link copied for “\(name)”")
            await viewModel.refresh()
        }
    }

    private func downloadFile(_ file: DriveFile) async {
        isPerformingDriveAction = true
        driveActionStatus = file.isHlsStoredVideo ? "Preparing export…" : "Downloading…"
        defer {
            isPerformingDriveAction = false
            driveActionStatus = "Working…"
        }

        switch await DriveService.downloadFileForSharing(
            config: appState.config,
            file: file,
            onExportProgress: { percent in
                Task { @MainActor in
                    driveActionStatus = "Preparing export \(percent)%"
                }
            }
        ) {
        case .failure(let error):
            viewModel.reportError(error.localizedDescription)
        case .success(let destination):
            activityShareItems = [destination]
            showActivityShare = true
        }
    }

    private func downloadFolder(_ folder: DriveFolder) async {
        isPerformingDriveAction = true
        defer { isPerformingDriveAction = false }

        switch await DriveService.downloadFolderArchive(config: appState.config, folder: folder) {
        case .failure(let error):
            viewModel.reportError(error.localizedDescription)
        case .success(let url):
            activityShareItems = [url]
            showActivityShare = true
        }
    }

    private func performDelete(_ target: DriveActionTarget) async {
        isPerformingDriveAction = true
        defer { isPerformingDriveAction = false }

        switch target {
        case .file(let file):
            switch await DriveService.deleteFile(config: appState.config, fileId: file.id) {
            case .failure(let error):
                viewModel.reportError(error.localizedDescription)
            case .success:
                DriveFavouritesStore.shared.remove(file.id)
                viewModel.removeFile(id: file.id)
                flashSuccess("File deleted")
            }
        case .folder(let folder):
            switch await DriveService.deleteFolder(config: appState.config, folderId: folder.id) {
            case .failure(let error):
                viewModel.reportError(error.localizedDescription)
            case .success:
                viewModel.removeFolder(id: folder.id)
                flashSuccess("Folder deleted")
            }
        }
    }

    private func flashSuccess(_ message: String) {
        successMessage = message
        Task {
            try? await Task.sleep(for: .seconds(2.5))
            if successMessage == message {
                successMessage = nil
            }
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

    private var offlineBanner: some View {
        HStack(spacing: 10) {
            Image(systemName: "wifi.slash")
                .foregroundStyle(DriveExplorerStyle.warning)
            Text("Offline — showing saved folder and file names from your last visit.")
                .font(.caption.weight(.medium))
                .foregroundStyle(DriveExplorerStyle.textPrimary)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(DriveExplorerStyle.surfaceRaised, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(DriveExplorerStyle.warning.opacity(0.22), lineWidth: 1)
        }
        .padding(.horizontal, 22)
    }

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

    private var performingBanner: some View {
        HStack(spacing: 10) {
            ProgressView()
                .tint(DriveExplorerStyle.accent)
            Text(driveActionStatus)
                .font(.caption.weight(.medium))
                .foregroundStyle(DriveExplorerStyle.textPrimary)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(DriveExplorerStyle.surfaceRaised, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(DriveExplorerStyle.separator, lineWidth: 1)
        }
    }

    private func successBanner(_ message: String) -> some View {
        HStack(spacing: 10) {
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(DriveExplorerStyle.accent)
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
                .stroke(DriveExplorerStyle.accent.opacity(0.24), lineWidth: 1)
        }
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
