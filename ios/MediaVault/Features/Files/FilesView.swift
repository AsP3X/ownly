import SwiftUI

// Human: Signed-in Files tab — hybrid explorer with recent cards followed by folder-first list navigation.
// Agent: OWNS DriveViewModel; BINDS appState.config; RENDERS DriveExplorerHeader RecentFilesCardView FileExplorerListView.
struct FilesView: View {
    @Environment(\.appState) private var appState
    @State private var viewModel = DriveViewModel()

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [DriveExplorerStyle.backgroundTop, DriveExplorerStyle.backgroundBottom],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()

            VStack(spacing: 0) {
                DriveExplorerHeader(viewModel: viewModel)

                ScrollView {
                    VStack(spacing: 18) {
                        explorerSummary

                        if viewModel.isEmpty {
                            emptyState
                                .padding(.top, 28)
                        } else {
                            if !viewModel.isSearching {
                                RecentFilesCardView(files: viewModel.files, config: appState.config)
                            }

                            FileExplorerListView(viewModel: viewModel, config: appState.config)
                        }

                        if viewModel.isLoadingMore {
                            HStack {
                                Spacer()
                                MediaVaultSpinner(tint: DriveExplorerStyle.accent)
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
        }
        .onChange(of: appState.config) { _, newConfig in
            viewModel.bind(config: newConfig)
        }
    }

    // MARK: - Empty & error states

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
                 : "Upload files or create folders from the web app for now.")
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
