import SwiftUI

// Human: Drive explorer chrome — title, breadcrumbs, and search for the light hybrid file browser.
// Agent: BINDS DriveViewModel searchQuery folderStack; CALLS navigate/goUp/refresh callbacks.
struct DriveExplorerHeader: View {
    @Bindable var viewModel: DriveViewModel
    @Bindable var uploadManager: UploadManager
    var onOpenUploadQueue: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            titleRow
            if !viewModel.isSearching {
                breadcrumbRow
            }
            if !viewModel.isOfflineMode {
                searchField
            }
        }
        .padding(.horizontal, 22)
        .padding(.top, 18)
        .padding(.bottom, 10)
        .background {
            Rectangle()
                .fill(.ultraThinMaterial)
                .opacity(0.72)
                .ignoresSafeArea(edges: .top)
        }
    }

    // MARK: - Title

    private var titleRow: some View {
        HStack(spacing: 12) {
            if !viewModel.folderStack.isEmpty, !viewModel.isSearching {
                Button(action: viewModel.goUpOneLevel) {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(DriveExplorerStyle.accent)
                        .frame(width: 34, height: 34)
                        .background(DriveExplorerStyle.surfaceRaised, in: Circle())
                        .overlay(Circle().stroke(DriveExplorerStyle.separator, lineWidth: 1))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Back")
            }

            VStack(alignment: .leading, spacing: 2) {
                Text("Browse")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(DriveExplorerStyle.textTertiary)

                Text(viewModel.currentTitle)
                    .font(.system(size: 32, weight: .bold))
                    .foregroundStyle(DriveExplorerStyle.textPrimary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.85)
            }

            Spacer(minLength: 0)

            if uploadManager.hasBatch {
                UploadHeaderProgressButton(
                    percent: uploadManager.overallPercent,
                    isActive: uploadManager.isUploading,
                    action: onOpenUploadQueue
                )
                .accessibilityHint("Opens upload queue")
            }
        }
    }

    // MARK: - Breadcrumbs

    private var breadcrumbRow: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 4) {
                breadcrumbButton(title: "All files", index: -1, isLast: viewModel.folderStack.isEmpty)

                ForEach(Array(viewModel.folderStack.enumerated()), id: \.element.id) { index, crumb in
                    Image(systemName: "chevron.right")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(DriveExplorerStyle.textTertiary)

                    breadcrumbButton(
                        title: crumb.name,
                        index: index,
                        isLast: index == viewModel.folderStack.count - 1
                    )
                }
            }
            .padding(.vertical, 2)
        }
    }

    private func breadcrumbButton(title: String, index: Int, isLast: Bool) -> some View {
        Button {
            viewModel.navigateToCrumb(at: index)
        } label: {
            Text(title)
                .font(.caption.weight(isLast ? .semibold : .medium))
                .foregroundStyle(isLast ? DriveExplorerStyle.accent : DriveExplorerStyle.textSecondary)
                .lineLimit(1)
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(isLast ? DriveExplorerStyle.accentSoft : DriveExplorerStyle.surfaceMuted, in: Capsule())
        }
        .buttonStyle(.plain)
        .disabled(isLast)
    }

    // MARK: - Search

    private var searchField: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(DriveExplorerStyle.textTertiary)

            TextField("Search files", text: $viewModel.searchQuery)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .foregroundStyle(DriveExplorerStyle.textPrimary)
                .tint(DriveExplorerStyle.accent)

            if !viewModel.searchQuery.isEmpty {
                Button {
                    viewModel.searchQuery = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(DriveExplorerStyle.textTertiary)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity)
        .background(DriveExplorerStyle.surfaceRaised, in: RoundedRectangle(cornerRadius: 13, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 13, style: .continuous)
                .stroke(DriveExplorerStyle.separator, lineWidth: 1)
        }
    }
}

#Preview {
    DriveExplorerHeader(
        viewModel: DriveViewModel(),
        uploadManager: UploadManager(),
        onOpenUploadQueue: {}
    )
        .background(
            LinearGradient(
                colors: [DriveExplorerStyle.backgroundTop, DriveExplorerStyle.backgroundBottom],
                startPoint: .top,
                endPoint: .bottom
            )
        )
}
