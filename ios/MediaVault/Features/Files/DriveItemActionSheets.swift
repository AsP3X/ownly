import SwiftUI
import UIKit

// Human: Long-press context menus and sheets for file/folder actions (parity with web drive menus).
// Agent: CALLS DriveService + DriveFavouritesStore; PRESENTS details, share sheet, and system share UI.

enum DriveActionTarget: Identifiable, Equatable {
    case file(DriveFile)
    case folder(DriveFolder)

    var id: String {
        switch self {
        case .file(let file):
            "file-\(file.id)"
        case .folder(let folder):
            "folder-\(folder.id)"
        }
    }

    var name: String {
        switch self {
        case .file(let file):
            file.name
        case .folder(let folder):
            folder.name
        }
    }

    var isProcessing: Bool {
        if case .file(let file) = self {
            return FileProcessing.isProcessing(file)
        }
        return false
    }
}

enum DriveFileMenuAction {
    case details
    case download
    case toggleFavourite
    case shareLink
    case delete
}

enum DriveFolderMenuAction {
    case details
    case download
    case shareLink
    case delete
}

// MARK: - Context menus

extension View {
    func driveFileContextMenu(
        file: DriveFile,
        isFavourite: Bool,
        onAction: @escaping (DriveFileMenuAction) -> Void
    ) -> some View {
        let processing = FileProcessing.isProcessing(file)
        return contextMenu {
            if processing {
                Text("Processing — actions unavailable")
            }
            Button {
                onAction(.details)
            } label: {
                Label("Details", systemImage: "info.circle")
            }
            .disabled(processing)

            Button {
                onAction(.download)
            } label: {
                Label(
                    file.isHlsStoredVideo ? "Export video" : "Download",
                    systemImage: "arrow.down.circle"
                )
            }
            .disabled(processing)

            Button {
                onAction(.toggleFavourite)
            } label: {
                Label(
                    isFavourite ? "Remove from favourites" : "Add to favourites",
                    systemImage: isFavourite ? "star.fill" : "star"
                )
            }
            .disabled(processing)

            Button {
                onAction(.shareLink)
            } label: {
                Label("Copy public link", systemImage: "link")
            }
            .disabled(processing)

            Divider()

            Button(role: .destructive) {
                onAction(.delete)
            } label: {
                Label("Delete", systemImage: "trash")
            }
            .disabled(processing)
        }
    }

    func driveFolderContextMenu(
        folder: DriveFolder,
        onAction: @escaping (DriveFolderMenuAction) -> Void
    ) -> some View {
        contextMenu {
            Button {
                onAction(.details)
            } label: {
                Label("Details", systemImage: "info.circle")
            }

            Button {
                onAction(.download)
            } label: {
                Label("Download", systemImage: "arrow.down.circle")
            }

            Button {
                onAction(.shareLink)
            } label: {
                Label("Copy public link", systemImage: "link")
            }

            Divider()

            Button(role: .destructive) {
                onAction(.delete)
            } label: {
                Label("Delete", systemImage: "trash")
            }
        }
    }
}

// MARK: - Details sheet

struct DriveItemDetailsSheet: View {
    let target: DriveActionTarget
    let config: ServerConfig
    var onShareChanged: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var tab: DetailsTab = .details
    @State private var publicShare: ShareLink?
    @State private var pageURL: URL?
    @State private var loadingShare = false
    @State private var revokingShare = false
    @State private var errorMessage: String?
    @State private var copiedLink = false

    private enum DetailsTab: String, CaseIterable, Identifiable {
        case details = "Details"
        case sharing = "Sharing"

        var id: String { rawValue }
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                Picker("Section", selection: $tab) {
                    ForEach(DetailsTab.allCases) { section in
                        Text(section.rawValue).tag(section)
                    }
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, 20)
                .padding(.vertical, 12)

                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        switch tab {
                        case .details:
                            detailsContent
                        case .sharing:
                            sharingContent
                        }
                    }
                    .padding(.horizontal, 20)
                    .padding(.bottom, 24)
                }
            }
            .navigationTitle(target.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .task(id: target.id) {
                await loadShare()
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    @ViewBuilder
    private var detailsContent: some View {
        switch target {
        case .file(let file):
            detailRow(label: "Type", value: file.mimeType ?? "File")
            detailRow(label: "Size", value: FileFormatting.formatBytes(file.sizeBytes))
            detailRow(label: "Modified", value: FileFormatting.formatOpened(file.updatedAt))
            detailRow(label: "Public link", value: file.sharePublic ? "Active" : "None")
            if FileProcessing.isProcessing(file) {
                detailRow(label: "Status", value: FileProcessing.label(for: file))
            }
        case .folder(let folder):
            detailRow(label: "Type", value: "Folder")
            detailRow(label: "Modified", value: FileFormatting.formatOpened(folder.updatedAt))
            detailRow(label: "Public link", value: folder.sharePublic ? "Active" : "None")
        }
    }

    @ViewBuilder
    private var sharingContent: some View {
        if loadingShare {
            ProgressView("Loading share link…")
                .frame(maxWidth: .infinity)
                .padding(.top, 24)
        } else if let errorMessage {
            Text(errorMessage)
                .font(.subheadline)
                .foregroundStyle(DriveExplorerStyle.warning)
        } else if let pageURL {
            VStack(alignment: .leading, spacing: 12) {
                Text(pageURL.absoluteString)
                    .font(.caption)
                    .foregroundStyle(DriveExplorerStyle.textSecondary)
                    .textSelection(.enabled)

                HStack(spacing: 10) {
                    Button {
                        UIPasteboard.general.string = pageURL.absoluteString
                        copiedLink = true
                    } label: {
                        Label(copiedLink ? "Copied" : "Copy link", systemImage: copiedLink ? "checkmark" : "doc.on.doc")
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(DriveExplorerStyle.accent)

                    if publicShare != nil {
                        Button(role: .destructive) {
                            Task { await revokeShare() }
                        } label: {
                            if revokingShare {
                                ProgressView()
                            } else {
                                Label("Revoke", systemImage: "link.badge.minus")
                            }
                        }
                        .buttonStyle(.bordered)
                        .disabled(revokingShare)
                    }
                }
            }
        } else {
            Button("Create public link") {
                Task { await createShare() }
            }
            .buttonStyle(.borderedProminent)
            .tint(DriveExplorerStyle.accent)
            .padding(.top, 8)
        }
    }

    private func detailRow(label: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label.uppercased())
                .font(.caption2.weight(.bold))
                .foregroundStyle(DriveExplorerStyle.textTertiary)
            Text(value)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(DriveExplorerStyle.textPrimary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 4)
    }

    private func loadShare() async {
        loadingShare = true
        errorMessage = nil
        defer { loadingShare = false }

        let result = await DriveService.fetchResourceShares(
            config: config,
            fileId: targetFileId,
            folderId: targetFolderId
        )

        switch result {
        case .failure(let error):
            errorMessage = error.localizedDescription
            publicShare = nil
            pageURL = nil
        case .success(let response):
            publicShare = response.publicShare
            if let token = response.publicShare?.token {
                pageURL = config.publicSharePageURL(token: token)
            } else {
                pageURL = nil
            }
        }
    }

    private func createShare() async {
        loadingShare = true
        errorMessage = nil
        defer { loadingShare = false }

        let resourceType: String
        let resourceId: String
        switch target {
        case .file(let file):
            resourceType = "file"
            resourceId = file.id
        case .folder(let folder):
            resourceType = "folder"
            resourceId = folder.id
        }

        let result = await DriveService.ensurePublicSharePageURL(
            config: config,
            resourceType: resourceType,
            resourceId: resourceId
        )

        switch result {
        case .failure(let error):
            errorMessage = error.localizedDescription
        case .success(let url):
            pageURL = url
            onShareChanged()
            await loadShare()
        }
    }

    private func revokeShare() async {
        guard let shareId = publicShare?.id else { return }
        revokingShare = true
        errorMessage = nil
        defer { revokingShare = false }

        switch await DriveService.revokePublicShare(config: config, shareId: shareId) {
        case .failure(let error):
            errorMessage = error.localizedDescription
        case .success:
            publicShare = nil
            pageURL = nil
            copiedLink = false
            onShareChanged()
        }
    }

    private var targetFileId: String? {
        if case .file(let file) = target { return file.id }
        return nil
    }

    private var targetFolderId: String? {
        if case .folder(let folder) = target { return folder.id }
        return nil
    }
}

// MARK: - System share sheet

struct DriveActivityShareSheet: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}
