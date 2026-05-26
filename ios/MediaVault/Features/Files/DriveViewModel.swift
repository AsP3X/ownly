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
    /// Bumped on each refresh so stale/cancelled loads do not overwrite newer results or show errors.
    private var loadGeneration: UInt = 0

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

    /// True while the initial folder/file fetch is in flight and the list has been cleared.
    var isLoadingInitialContent: Bool {
        isRefreshing && folders.isEmpty && files.isEmpty
    }

    func bind(config: ServerConfig) {
        guard self.config != config else { return }
        self.config = config
        Task { await refresh() }
    }

    func refresh() async {
        guard let config else { return }
        let generation = beginRefresh()
        defer { endRefresh(generation) }

        if isSearching {
            await loadSearch(config: config, reset: true, generation: generation)
        } else {
            await loadBrowse(config: config, reset: true, generation: generation)
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

    func removeFile(id: String) {
        files.removeAll { $0.id == id }
    }

    func removeFolder(id: String) {
        folders.removeAll { $0.id == id }
    }

    func reportError(_ message: String) {
        errorMessage = message
    }

    func clearError() {
        errorMessage = nil
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

    private func loadBrowse(config: ServerConfig, reset: Bool, generation: UInt) async {
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
            guard isCurrentGeneration(generation) else { return }
            if reset {
                folders = response.folders
            } else {
                folders.append(contentsOf: response.folders)
            }
            hasMoreFolders = response.hasMore
        case .failure(let error):
            recordFailure(error, generation: generation)
        }

        switch await filesResult {
        case .success(let response):
            guard isCurrentGeneration(generation) else { return }
            if reset {
                files = response.files
            } else {
                files.append(contentsOf: response.files)
            }
            hasMoreFiles = response.hasMore
        case .failure(let error):
            recordFailure(error, generation: generation)
        }
    }

    private func loadSearch(config: ServerConfig, reset: Bool, generation: UInt) async {
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
            guard isCurrentGeneration(generation) else { return }
            if reset {
                files = response.files
            } else {
                files.append(contentsOf: response.files)
            }
            hasMoreFiles = response.hasMore
        case .failure(let error):
            recordFailure(error, generation: generation)
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
            recordFailure(error, generation: loadGeneration)
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
            recordFailure(error, generation: loadGeneration)
        }
    }

    private func beginRefresh() -> UInt {
        loadGeneration += 1
        isRefreshing = true
        errorMessage = nil
        return loadGeneration
    }

    private func endRefresh(_ generation: UInt) {
        if generation == loadGeneration {
            isRefreshing = false
        }
    }

    private func isCurrentGeneration(_ generation: UInt) -> Bool {
        generation == loadGeneration
    }

    /// Surfaces real failures only — ignores cancellation and superseded refresh generations.
    private func recordFailure(_ error: DriveServiceError, generation: UInt) {
        guard isCurrentGeneration(generation) else { return }
        guard !error.isCancellation else { return }
        errorMessage = error.localizedDescription
    }

}
