import SwiftUI

// Human: Two recent file cards shown above the folder/file list in the hybrid explorer.
// Agent: SORTS files by updatedAt descending; USES FileGridThumbnail for image previews; fixed heights keep card rows aligned.
struct RecentFilesCardView: View {
    let files: [DriveFile]
    let config: ServerConfig
    var favouriteIds: Set<String> = []
    var onOpenVideo: ((DriveFile) -> Void)? = nil
    var onFileAction: ((DriveFile, DriveFileMenuAction) -> Void)? = nil

    private let columns = [
        GridItem(.flexible(), spacing: 14),
        GridItem(.flexible(), spacing: 14),
    ]

    private var recentFiles: [DriveFile] {
        files
            .sorted { $0.updatedAt > $1.updatedAt }
            .prefix(2)
            .map { $0 }
    }

    var body: some View {
        if !recentFiles.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                Text("RECENT")
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(DriveExplorerStyle.textTertiary)
                    .padding(.leading, 4)

                LazyVGrid(columns: columns, spacing: 14) {
                    ForEach(recentFiles) { file in
                        RecentFileCard(
                            file: file,
                            config: config,
                            isFavourite: favouriteIds.contains(file.id),
                            onOpenVideo: onOpenVideo,
                            onFileAction: onFileAction
                        )
                    }
                }
            }
            .padding(.horizontal, 22)
        }
    }
}

// Human: Fixed-height recent file card matching the current card treatment without affecting list row heights.
// Agent: READS DriveFile mime/processing state; RENDERS preview well + constrained title/metadata.
private struct RecentFileCard: View {
    let file: DriveFile
    let config: ServerConfig
    var isFavourite: Bool = false
    var onOpenVideo: ((DriveFile) -> Void)? = nil
    var onFileAction: ((DriveFile, DriveFileMenuAction) -> Void)? = nil

    var body: some View {
        Group {
            if isVideoMime(file.mimeType), let onOpenVideo {
                Button {
                    onOpenVideo(file)
                } label: {
                    cardBody
                }
                .buttonStyle(.plain)
            } else {
                cardBody
            }
        }
        .driveFileContextMenu(file: file, isFavourite: isFavourite) { action in
            onFileAction?(file, action)
        }
    }

    private var cardBody: some View {
        VStack(alignment: .leading, spacing: 8) {
            preview
                .frame(height: 118)
                .frame(maxWidth: .infinity)
                .background(DriveExplorerStyle.surfaceRaised, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 20, style: .continuous)
                        .stroke(DriveExplorerStyle.separator, lineWidth: 1)
                }
                .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))

            VStack(alignment: .leading, spacing: 2) {
                Text(file.name)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(DriveExplorerStyle.textPrimary)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)

                Text(FileFormatting.formatBytes(file.sizeBytes))
                    .font(.caption2)
                    .foregroundStyle(DriveExplorerStyle.textSecondary)
                    .lineLimit(1)
            }
            .frame(height: 44, alignment: .topLeading)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(height: 170, alignment: .top)
    }

    @ViewBuilder
    private var preview: some View {
        ZStack {
            if isImageMime(file.mimeType) {
                FileGridThumbnail(file: file, config: config)
            } else {
                FileTypeIconView(mimeType: file.mimeType, size: 52)
            }

            if isVideoMime(file.mimeType),
               file.hlsReady,
               !FileProcessing.isProcessing(file) {
                Image(systemName: "play.circle.fill")
                    .font(.system(size: 36))
                    .symbolRenderingMode(.palette)
                    .foregroundStyle(.white, DriveExplorerStyle.video.opacity(0.85))
                    .shadow(color: .black.opacity(0.35), radius: 6, y: 2)
            }

            if FileProcessing.isProcessing(file) {
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .fill(.black.opacity(0.26))
                MediaVaultBouncingDots(tint: .white, dotSize: 6, bounceHeight: 4)
            }
        }
    }
}

#Preview {
    RecentFilesCardView(files: [], config: .defaults)
        .padding()
}
