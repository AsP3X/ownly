import SwiftUI

// Human: Upload transfer panel UI — phased progress bars matching the web upload-batch-view.
// Agent: READS UploadManager; RENDERS active stack + queue; CALLS cancelItem cancelAll dismissBatch.

struct UploadTransferSheet: View {
    @Bindable var uploadManager: UploadManager
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                UploadBatchProgressView(uploadManager: uploadManager)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
            }
            .background(DriveExplorerStyle.backgroundBottom)
            .navigationTitle("Uploads")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    if uploadManager.batchStatus == .complete {
                        Button("Done") {
                            uploadManager.dismissBatch()
                            dismiss()
                        }
                    } else {
                        Button("Minimize") { dismiss() }
                    }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }
}

struct UploadBatchProgressView: View {
    @Bindable var uploadManager: UploadManager

    private var activeItems: [UploadItem] {
        uploadManager.items.filter { $0.status == .uploading }
    }

    private var waitingItems: [UploadItem] {
        uploadManager.items.filter { $0.status == .queued }
    }

    private var failedItems: [UploadItem] {
        uploadManager.items.filter { $0.status == .error || $0.status == .cancelled }
    }

    private var doneCount: Int {
        uploadManager.items.filter { $0.status == .done }.count
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            headerSummary

            activeStack

            if !waitingItems.isEmpty {
                uploadListBox(title: "In queue · \(waitingItems.count)", items: waitingItems, style: .queued)
            }

            if !failedItems.isEmpty {
                uploadListBox(title: "Failed · \(failedItems.count)", items: failedItems, style: .failed)
            }

            if uploadManager.isUploading {
                Button("Cancel all", role: .destructive) {
                    uploadManager.cancelAll()
                }
                .font(.subheadline.weight(.semibold))
                .frame(maxWidth: .infinity)
            }
        }
    }

    private var headerSummary: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("\(doneCount + failedItems.count) of \(uploadManager.items.count) processed")
                    .font(.caption)
                    .foregroundStyle(DriveExplorerStyle.textSecondary)
                Spacer()
                Text("\(activeItems.count) active · \(waitingItems.count) queued")
                    .font(.caption)
                    .foregroundStyle(DriveExplorerStyle.textSecondary)
            }

            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(DriveExplorerStyle.surfaceMuted)
                    Capsule()
                        .fill(DriveExplorerStyle.accent)
                        .frame(width: geo.size.width * CGFloat(uploadManager.overallPercent) / 100)
                }
            }
            .frame(height: 6)
            .accessibilityLabel("Overall upload progress \(uploadManager.overallPercent) percent")
        }
    }

    private var activeStack: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("In progress · \(activeItems.count) of \(UploadManager.maxConcurrent)")
                .font(.caption.weight(.semibold))
                .foregroundStyle(DriveExplorerStyle.textSecondary)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(DriveExplorerStyle.surfaceMuted)

            if activeItems.isEmpty {
                Text("Preparing next files…")
                    .font(.subheadline)
                    .foregroundStyle(DriveExplorerStyle.textTertiary)
                    .frame(maxWidth: .infinity, minHeight: 72)
            } else {
                ForEach(activeItems) { item in
                    ActiveUploadRow(item: item) {
                        uploadManager.cancelItem(id: item.id)
                    }
                    Divider()
                }
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(DriveExplorerStyle.separator, lineWidth: 1)
        }
    }

    private enum ListStyle {
        case queued
        case failed
    }

    private func uploadListBox(title: String, items: [UploadItem], style: ListStyle) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(DriveExplorerStyle.textSecondary)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(DriveExplorerStyle.surfaceMuted)

            ForEach(items) { item in
                HStack(spacing: 8) {
                    Image(systemName: style == .failed ? "exclamationmark.circle" : "clock")
                        .font(.caption)
                        .foregroundStyle(style == .failed ? DriveExplorerStyle.warning : DriveExplorerStyle.textTertiary)
                    Text(item.fileName)
                        .font(.caption)
                        .lineLimit(1)
                        .foregroundStyle(DriveExplorerStyle.textPrimary)
                    Spacer()
                    if style == .failed {
                        Button {
                            uploadManager.removeItem(id: item.id)
                        } label: {
                            Image(systemName: "xmark")
                                .font(.caption.weight(.semibold))
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                Divider()
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(DriveExplorerStyle.separator, lineWidth: 1)
        }
    }
}

struct ActiveUploadRow: View {
    let item: UploadItem
    var onCancel: () -> Void

    @State private var phaseElapsedSec = 0
    @State private var phaseTimer: Task<Void, Never>?

    private var isPostUpload: Bool {
        item.phase == .processing || item.phase == .storing
    }

    private var isVideo: Bool {
        item.mimeType.lowercased().hasPrefix("video/")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                ProgressView()
                    .controlSize(.small)
                    .tint(phaseAccent)

                Text(item.fileName)
                    .font(.subheadline.weight(.medium))
                    .lineLimit(1)
                    .foregroundStyle(DriveExplorerStyle.textPrimary)

                Spacer()

                Text(percentLabel)
                    .font(.caption.weight(.semibold))
                    .monospacedDigit()
                    .foregroundStyle(phaseAccent)

                Button(action: onCancel) {
                    Image(systemName: "xmark")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(DriveExplorerStyle.textTertiary)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Cancel upload \(item.fileName)")
            }

            UploadPhaseProgressBar(
                value: item.progress,
                phase: item.phase,
                indeterminate: item.indeterminate
            )
            .id("\(item.id)-\(item.phase)-\(item.indeterminate)")

            Text(detailLine)
                .font(.caption2)
                .foregroundStyle(DriveExplorerStyle.textSecondary)
                .lineLimit(1)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(phaseBackground)
        .animation(nil, value: item.phase)
        .onAppear { startPhaseTimerIfNeeded() }
        .onChange(of: item.phase) { _, newPhase in
            phaseElapsedSec = 0
            if newPhase == .processing || newPhase == .storing {
                startPhaseTimerIfNeeded()
            } else {
                phaseTimer?.cancel()
                phaseTimer = nil
            }
        }
        .onDisappear {
            phaseTimer?.cancel()
            phaseTimer = nil
        }
    }

    private var percentLabel: String {
        if isPostUpload && item.indeterminate { return "Working…" }
        return "\(item.progress)%"
    }

    private var detailLine: String {
        let size = formatByteCount(item.fileSize)
        let status = phaseLabel
        if isPostUpload {
            let elapsed = item.phase == .processing && isVideo && !item.indeterminate
                ? "Encoding \(formatElapsed(phaseElapsedSec))"
                : formatElapsed(phaseElapsedSec)
            return "\(size) · \(status) · \(elapsed)"
        }
        return "\(size) · \(status)"
    }

    private var phaseLabel: String {
        switch item.phase {
        case .storing:
            return "Moving to storage"
        case .processing:
            return isVideo ? "Processing video" : "Processing"
        case .uploading:
            return "Uploading"
        }
    }

    private var phaseAccent: Color {
        switch item.phase {
        case .storing: Color(red: 5/255, green: 150/255, blue: 105/255)
        case .processing: Color(red: 109/255, green: 40/255, blue: 217/255)
        case .uploading: DriveExplorerStyle.accent
        }
    }

    private var phaseBackground: Color {
        switch item.phase {
        case .storing: Color(red: 236/255, green: 253/255, blue: 245/255)
        case .processing: Color(red: 245/255, green: 243/255, blue: 255/255)
        case .uploading: Color(red: 239/255, green: 246/255, blue: 255/255)
        }
    }

    private func startPhaseTimerIfNeeded() {
        phaseTimer?.cancel()
        guard isPostUpload else { return }
        phaseElapsedSec = 0
        phaseTimer = Task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(1))
                phaseElapsedSec += 1
            }
        }
    }
}

struct UploadPhaseProgressBar: View {
    let value: Int
    let phase: UploadPhase
    let indeterminate: Bool

    var body: some View {
        // Human: One bar at a time — uploading (blue), processing (violet), storing (emerald); no cross-fade.
        // Agent: SWITCH on phase; SHIMMER only for indeterminate processing; STABLE .id per phase.
        Group {
            switch displayMode {
            case .uploading:
                UploadDeterminatePhaseBar(value: value, fill: DriveExplorerStyle.accent)
            case .processingIndeterminate:
                UploadShimmerBar(tint: Color(red: 109/255, green: 40/255, blue: 217/255))
            case .processingDeterminate:
                UploadDeterminatePhaseBar(
                    value: value,
                    fill: Color(red: 109/255, green: 40/255, blue: 217/255)
                )
            case .storing:
                UploadDeterminatePhaseBar(
                    value: value,
                    fill: Color(red: 5/255, green: 150/255, blue: 105/255)
                )
            }
        }
        .frame(height: 6)
        .animation(nil, value: displayMode)
    }

    private enum DisplayMode: Hashable {
        case uploading
        case processingIndeterminate
        case processingDeterminate
        case storing
    }

    private var displayMode: DisplayMode {
        switch phase {
        case .uploading:
            .uploading
        case .processing:
            indeterminate ? .processingIndeterminate : .processingDeterminate
        case .storing:
            .storing
        }
    }
}

private struct UploadDeterminatePhaseBar: View {
    let value: Int
    let fill: Color

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(DriveExplorerStyle.surfaceMuted)
                Capsule()
                    .fill(fill)
                    .frame(width: geo.size.width * CGFloat(min(100, max(0, value))) / 100)
            }
        }
        .animation(.easeOut(duration: 0.15), value: value)
    }
}

private struct UploadShimmerBar: View {
    let tint: Color
    @State private var offset: CGFloat = -1

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(tint.opacity(0.2))
                Capsule()
                    .fill(tint)
                    .frame(width: geo.size.width * 0.4)
                    .offset(x: offset * geo.size.width)
            }
            .clipShape(Capsule())
            .onAppear {
                withAnimation(.easeInOut(duration: 1.4).repeatForever(autoreverses: true)) {
                    offset = 0.6
                }
            }
        }
        .frame(height: 6)
        .accessibilityLabel("Processing video")
    }
}

struct UploadHeaderProgressButton: View {
    let percent: Int
    let isActive: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack {
                Circle()
                    .stroke(DriveExplorerStyle.separator, lineWidth: 2)
                Circle()
                    .trim(from: 0, to: CGFloat(min(100, max(0, percent))) / 100)
                    .stroke(
                        DriveExplorerStyle.accent,
                        style: StrokeStyle(lineWidth: 2.5, lineCap: .round)
                    )
                    .rotationEffect(.degrees(-90))
                    .animation(.easeOut(duration: 0.3), value: percent)

                if isActive {
                    Image(systemName: "arrow.up")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(DriveExplorerStyle.accent)
                } else {
                    Image(systemName: "checkmark")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(Color(red: 5/255, green: 150/255, blue: 105/255))
                }
            }
            .frame(width: 34, height: 34)
            .background(DriveExplorerStyle.surfaceRaised, in: Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(isActive ? "Uploads in progress, \(percent) percent" : "Uploads complete")
    }
}

private func formatByteCount(_ bytes: Int64) -> String {
    ByteCountFormatter.string(fromByteCount: bytes, countStyle: .file)
}

private func formatElapsed(_ seconds: Int) -> String {
    if seconds < 60 { return "\(seconds)s" }
    let mins = seconds / 60
    let secs = seconds % 60
    return "\(mins)m \(secs)s"
}
