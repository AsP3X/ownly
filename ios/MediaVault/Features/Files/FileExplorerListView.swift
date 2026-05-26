import SwiftUI

// Human: Nextcloud-style grouped list — folders first, then files, inside glass card sections.
// Agent: READS DriveViewModel; CALLS openFolder loadMoreIfNeeded; RENDERS FileListRow for each item.
struct FileExplorerListView: View {
    @Bindable var viewModel: DriveViewModel
    let config: ServerConfig
    var favouriteIds: Set<String> = []
    var onOpenVideo: ((DriveFile) -> Void)? = nil
    var onFileAction: ((DriveFile, DriveFileMenuAction) -> Void)? = nil
    var onFolderAction: ((DriveFolder, DriveFolderMenuAction) -> Void)? = nil

    var body: some View {
        LazyVStack(alignment: .leading, spacing: 24, pinnedViews: []) {
            if !viewModel.isSearching, !viewModel.folders.isEmpty {
                explorerSection(title: "Folders") {
                    ForEach(Array(viewModel.folders.enumerated()), id: \.element.id) { index, folder in
                        folderRow(folder)
                        if index < viewModel.folders.count - 1 {
                            rowDivider
                        }
                    }
                }
            }

            if !viewModel.files.isEmpty {
                explorerSection(title: viewModel.isSearching ? "Results" : "Files") {
                    ForEach(Array(viewModel.files.enumerated()), id: \.element.id) { index, file in
                        fileRow(file)
                        if index < viewModel.files.count - 1 {
                            rowDivider
                        }
                    }
                }
            }
        }
        .padding(.horizontal, 22)
    }

    // MARK: - Rows

    private func folderRow(_ folder: DriveFolder) -> some View {
        Button {
            viewModel.openFolder(folder)
        } label: {
            FileListRow(
                title: folder.name,
                subtitle: "Folder",
                mimeType: nil,
                isFolder: true,
                sharePublic: folder.sharePublic,
                processingLabel: nil
            ) {
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(DriveExplorerStyle.textTertiary)
            }
        }
        .buttonStyle(.plain)
        .driveFolderContextMenu(folder: folder) { action in
            onFolderAction?(folder, action)
        }
        .onAppear {
            Task { await viewModel.loadMoreIfNeeded(currentItemId: folder.id) }
        }
    }

    private func fileRow(_ file: DriveFile) -> some View {
        Group {
            if isVideoMime(file.mimeType), let onOpenVideo {
                Button {
                    onOpenVideo(file)
                } label: {
                    fileRowContent(file)
                }
                .buttonStyle(.plain)
            } else {
                fileRowContent(file)
            }
        }
        .driveFileContextMenu(file: file, isFavourite: favouriteIds.contains(file.id)) { action in
            onFileAction?(file, action)
        }
        .onAppear {
            Task { await viewModel.loadMoreIfNeeded(currentItemId: file.id) }
        }
    }

    private func fileRowContent(_ file: DriveFile) -> some View {
        FileListRow(
            title: file.name,
            subtitle: fileSubtitle(file),
            mimeType: file.mimeType,
            isFolder: false,
            sharePublic: file.sharePublic,
            processingLabel: FileProcessing.isProcessing(file) ? FileProcessing.label(for: file) : nil
        ) {
            if isVideoMime(file.mimeType), file.hlsReady, !FileProcessing.isProcessing(file) {
                Image(systemName: "play.circle.fill")
                    .font(.title3)
                    .foregroundStyle(DriveExplorerStyle.video)
            }
        }
    }

    private func fileSubtitle(_ file: DriveFile) -> String {
        "\(FileFormatting.formatBytes(file.sizeBytes)) · \(FileFormatting.formatOpened(file.updatedAt))"
    }

    // MARK: - Section chrome

    private func explorerSection<Content: View>(title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title.uppercased())
                .font(.caption2.weight(.bold))
                .foregroundStyle(DriveExplorerStyle.textTertiary)
                .padding(.leading, 4)

            VStack(spacing: 0) {
                content()
            }
            .background(DriveExplorerStyle.surfaceRaised, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .stroke(DriveExplorerStyle.separator, lineWidth: 1)
            }
        }
    }

    private var rowDivider: some View {
        Rectangle()
            .fill(DriveExplorerStyle.separator)
            .frame(height: 1)
            .padding(.leading, 72)
    }
}

// Human: Single list row layout shared by folder and file entries.
// Agent: RENDERS FileTypeIconView + title/subtitle + optional trailing accessory.
struct FileListRow<Trailing: View>: View {
    let title: String
    let subtitle: String
    let mimeType: String?
    var isFolder: Bool = false
    var sharePublic: Bool = false
    var processingLabel: String?
    @ViewBuilder var trailing: () -> Trailing

    init(
        title: String,
        subtitle: String,
        mimeType: String?,
        isFolder: Bool = false,
        sharePublic: Bool = false,
        processingLabel: String? = nil,
        @ViewBuilder trailing: @escaping () -> Trailing = { EmptyView() }
    ) {
        self.title = title
        self.subtitle = subtitle
        self.mimeType = mimeType
        self.isFolder = isFolder
        self.sharePublic = sharePublic
        self.processingLabel = processingLabel
        self.trailing = trailing
    }

    var body: some View {
        HStack(spacing: 14) {
            FileTypeIconView(mimeType: mimeType, isFolder: isFolder, size: 44)

            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(title)
                        .font(.body.weight(.semibold))
                        .foregroundStyle(DriveExplorerStyle.textPrimary)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)

                    if sharePublic {
                        Image(systemName: "link")
                            .font(.caption2.weight(.bold))
                            .foregroundStyle(DriveExplorerStyle.accent)
                    }
                }

                if let processingLabel {
                    Text(processingLabel)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(DriveExplorerStyle.warning)
                } else {
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(DriveExplorerStyle.textSecondary)
                }
            }

            Spacer(minLength: 8)

            trailing()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .contentShape(Rectangle())
    }
}

#Preview {
    ScrollView {
        FileExplorerListView(viewModel: DriveViewModel(), config: .defaults)
    }
}
