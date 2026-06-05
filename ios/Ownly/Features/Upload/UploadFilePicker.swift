import SwiftUI
import UniformTypeIdentifiers

// Human: Presents the system document picker for one or many files to upload to Ownly.
// Agent: BINDS isPresented; RETURNS security-scoped URLs to onPick; USED ContentView upload tab action.
// Human: Common upload UTIs — avoids overly broad `.item` that can trigger simulator icon lookup noise.
// Agent: USED fileImporter allowedContentTypes; STILL allows most user documents and media.
private let uploadPickerContentTypes: [UTType] = [
    .data,
    .content,
    .image,
    .movie,
    .video,
    .audio,
    .pdf,
    .zip,
    .archive,
    .text,
    .plainText,
    .spreadsheet,
    .presentation,
    .json,
]

struct UploadFilePickerModifier: ViewModifier {
    @Binding var isPresented: Bool
    var onPick: ([URL]) -> Void

    func body(content: Content) -> some View {
        content
            .fileImporter(
                isPresented: $isPresented,
                allowedContentTypes: uploadPickerContentTypes,
                allowsMultipleSelection: true
            ) { result in
                switch result {
                case .success(let urls):
                    onPick(urls)
                case .failure:
                    break
                }
            }
    }
}

extension View {
    func uploadFilePicker(isPresented: Binding<Bool>, onPick: @escaping ([URL]) -> Void) -> some View {
        modifier(UploadFilePickerModifier(isPresented: isPresented, onPick: onPick))
    }
}
