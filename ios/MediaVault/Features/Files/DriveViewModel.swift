import Observation
import SwiftUI

// Human: Drive browser state — folder stack, search, and pagination for the hybrid Files tab.
// Agent: CALLS DriveService listFolders listFiles; WRITES folders files folderStack; READS ServerConfig from bind().
@Observable
@MainActor
final class DriveViewModel {
    private(set) var folders: [DriveFolder] = []
    private(set) var files: [DriveFile] = []
    private(set) var folderStack: [FolderCrumb] = []
    private(set) var hasMoreFolders = false
    private(set) var hasMoreFiles = false
    private(set) var isRefreshing = false
    private(set) var isLoadingMore = false
    private(set) var errorMessage: String?

    var searchQuery = "" {
        didSet {
            guard searchQuery != oldValue else { return }
            scheduleSearchRefresh()
        }
    }

    private var config: ServerConfig?
    private var searchTask: Task<Void, Never>?

    var isSearching: Bool {
        !searchQuery.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var currentTitle: String {
        if isSearching { return "Search" }
        return folderStack.last?.name ?? "All files"
    }

    var currentFolderId: String? {
        folderStack.last?.id
    }

    var isEmpty: Bool {
        folders.isEmpty && files.isEmpty && !isRefreshing
    }

    func bind(config: ServerConfig) {
        guard self.config != config else { return }
        self.config = config
        Task { await refresh() }
    }

    func refresh() async {
        guard let config else { return }
        isRefreshing = true
        errorMessage = nil
        defer { isRefreshing = false }

        if isSearching {
            await loadSearch(config: config, reset: true)
        } else {
            await loadBrowse(config: config, reset: true)
        }
    }

    func loadMoreIfNeeded(currentItemId: String) async {
        guard let config, !isLoadingMore, !isRefreshing else { return }

        if !isSearching, folders.contains(where: { $0.id == currentItemId }), hasMoreFolders {
            await loadMoreFolders(config: config)
            return
        }

        if files.contains(where: { $0.id == currentItemId }), hasMoreFiles {
            await loadMoreFiles(config: config)
        }
    }

    func openFolder(_ folder: DriveFolder) {
        folderStack.append(FolderCrumb(id: folder.id, name: folder.name))
        searchQuery = ""
        Task { await refresh() }
    }

    func navigateToRoot() {
        guard !folderStack.isEmpty || isSearching else { return }
        folderStack.removeAll()
        searchQuery = ""
        Task { await refresh() }
    }

    func navigateToCrumb(at index: Int) {
        guard index >= -1, index < folderStack.count else { return }
        if index == -1 {
            navigateToRoot()
            return
        }
        folderStack = Array(folderStack.prefix(index + 1))
        searchQuery = ""
        Task { await refresh() }
    }

    func goUpOneLevel() {
        guard !folderStack.isEmpty else { return }
        folderStack.removeLast()
        Task { await refresh() }
    }

    // MARK: - Private loading

    private func scheduleSearchRefresh() {
        searchTask?.cancel()
        searchTask = Task {
            try? await Task.sleep(for: .milliseconds(350))
            guard !Task.isCancelled else { return }
            await refresh()
        }
    }

    private func loadBrowse(config: ServerConfig, reset: Bool) async {
        if reset {
            folders = []
            files = []
            hasMoreFolders = false
            hasMoreFiles = false
        }

        let parentId = currentFolderId

        async let foldersResult = DriveService.listFolders(
            config: config,
            parentId: parentId,
            offset: reset ? 0 : folders.count
        )
        async let filesResult = DriveService.listFiles(
            config: config,
            folderId: parentId,
            offset: reset ? 0 : files.count
        )

        switch await foldersResult {
        case .success(let response):
            if reset {
                folders = response.folders
            } else {
                folders.append(contentsOf: response.folders)
            }
            hasMoreFolders = response.hasMore
        case .failure(let error):
            errorMessage = error.localizedDescription
        }

        switch await filesResult {
        case .success(let response):
            if reset {
                files = response.files
            } else {
                files.append(contentsOf: response.files)
            }
            hasMoreFiles = response.hasMore
        case .failure(let error):
            errorMessage = error.localizedDescription
        }
    }

    private func loadSearch(config: ServerConfig, reset: Bool) async {
        folders = []
        hasMoreFolders = false

        if reset {
            files = []
            hasMoreFiles = false
        }

        let result = await DriveService.listFiles(
            config: config,
            folderId: nil,
            query: searchQuery,
            offset: reset ? 0 : files.count
        )

        switch result {
        case .success(let response):
            if reset {
                files = response.files
            } else {
                files.append(contentsOf: response.files)
            }
            hasMoreFiles = response.hasMore
        case .failure(let error):
            errorMessage = error.localizedDescription
        }
    }

    private func loadMoreFolders(config: ServerConfig) async {
        isLoadingMore = true
        defer { isLoadingMore = false }

        let result = await DriveService.listFolders(
            config: config,
            parentId: currentFolderId,
            offset: folders.count
        )

        switch result {
        case .success(let response):
            folders.append(contentsOf: response.folders)
            hasMoreFolders = response.hasMore
        case .failure(let error):
            errorMessage = error.localizedDescription
        }
    }

    private func loadMoreFiles(config: ServerConfig) async {
        isLoadingMore = true
        defer { isLoadingMore = false }

        let result = await DriveService.listFiles(
            config: config,
            folderId: isSearching ? nil : currentFolderId,
            query: isSearching ? searchQuery : nil,
            offset: files.count
        )

        switch result {
        case .success(let response):
            files.append(contentsOf: response.files)
            hasMoreFiles = response.hasMore
        case .failure(let error):
            errorMessage = error.localizedDescription
        }
    }

}
