import SwiftUI

// Human: Compact server health pill shown on auth screens.
// Agent: CALLS TenantHealthChecker.check on appear; optional tap opens health sheet.
struct TenantStatusView: View {
    let config: ServerConfig
    var onTap: (() -> Void)? = nil

    @State private var result: TenantHealthResult = .checking

    var body: some View {
        let content = HStack(spacing: 6) {
            statusIcon
            Text(statusLabel)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(statusColor)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .glassPanel(cornerRadius: 20, tint: statusColor, tintOpacity: 0.12)

        Group {
            if let onTap {
                Button(action: onTap) { content }
                    .buttonStyle(.plain)
            } else {
                content
            }
        }
        .onAppear { performCheck() }
        .onChange(of: config) { _, _ in performCheck() }
    }

    @ViewBuilder
    private var statusIcon: some View {
        switch result {
        case .checking:
            MediaVaultSpinner(tint: MediaVaultColors.neutral400)
                .scaleEffect(0.7)
        case .healthy:
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 12))
                .foregroundStyle(MediaVaultColors.success500)
        case .degraded:
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 12))
                .foregroundStyle(MediaVaultColors.warning500)
        case .unreachable:
            Image(systemName: "xmark.circle.fill")
                .font(.system(size: 12))
                .foregroundStyle(MediaVaultColors.error500)
        }
    }

    private var statusLabel: String {
        switch result {
        case .checking: "Checking…"
        case .healthy: "Server reachable"
        case .degraded: "Degraded"
        case .unreachable: "Unreachable"
        }
    }

    private var statusColor: Color {
        switch result {
        case .checking: MediaVaultColors.neutral400
        case .healthy: MediaVaultColors.success500
        case .degraded: MediaVaultColors.warning500
        case .unreachable: MediaVaultColors.error500
        }
    }

    private func performCheck() {
        result = .checking
        Task {
            let next = await TenantHealthChecker.check(config: config)
            await MainActor.run { result = next }
        }
    }
}
