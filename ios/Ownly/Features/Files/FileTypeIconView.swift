import SwiftUI

// Human: Mime-type tile icon used in list rows and grid cells (Nextcloud-style colored glyph on soft tint).
// Agent: READS FileKind from mime or folder flag; RENDERS SF Symbol in rounded glass-backed square.
struct FileTypeIconView: View {
    var mimeType: String?
    var isFolder: Bool = false
    var size: CGFloat = 40

    private var kind: FileKind {
        isFolder ? .folder : FileKind(mimeType: mimeType)
    }

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: size * 0.28, style: .continuous)
                .fill(kind.tileBackground)
                .overlay {
                    RoundedRectangle(cornerRadius: size * 0.28, style: .continuous)
                        .stroke(isFolder ? DriveExplorerStyle.accent.opacity(0.12) : DriveExplorerStyle.separator, lineWidth: 1)
                }

            Image(systemName: kind.systemImage)
                .font(.system(size: isFolder ? size * 0.48 : size * 0.40, weight: .semibold))
                .foregroundStyle(kind.iconColor)
                .symbolRenderingMode(.hierarchical)
        }
        .frame(width: size, height: size)
    }
}

// Human: Async image thumbnail for grid tiles — falls back to mime icon when download fails.
// Agent: CALLS DriveService.downloadImageData; READS config fileId; CACHES in memory via ThumbnailImageCache.
struct FileGridThumbnail: View {
    let file: DriveFile
    let config: ServerConfig

    @State private var image: UIImage?

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            } else {
                FileTypeIconView(mimeType: file.mimeType, size: 46)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .clipped()
        .task(id: file.id) {
            guard isImageMime(file.mimeType) else { return }
            if let cached = ThumbnailImageCache.shared.image(for: file.id) {
                image = cached
                return
            }
            if let data = await DriveService.downloadImageData(config: config, fileId: file.id),
               let uiImage = UIImage(data: data) {
                ThumbnailImageCache.shared.store(uiImage, for: file.id)
                image = uiImage
            }
        }
    }
}

// Human: In-memory thumbnail cache so scrolling the grid does not re-download previews.
// Agent: NSCache keyed by file id; READ/WRITE from FileGridThumbnail.
final class ThumbnailImageCache {
    static let shared = ThumbnailImageCache()
    private let cache = NSCache<NSString, UIImage>()

    private init() {
        cache.countLimit = 120
    }

    func image(for fileId: String) -> UIImage? {
        cache.object(forKey: fileId as NSString)
    }

    func store(_ image: UIImage, for fileId: String) {
        cache.setObject(image, forKey: fileId as NSString)
    }
}

#Preview {
    HStack {
        FileTypeIconView(mimeType: "image/png")
        FileTypeIconView(mimeType: "video/mp4")
        FileTypeIconView(isFolder: true)
    }
    .padding()
}
