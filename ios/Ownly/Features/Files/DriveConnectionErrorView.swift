import SwiftUI

// Human: Full-screen placeholder when the drive has no network and no cached top-level listing to show.
// Agent: RENDERS retry CTA; CALLS onRetry from FilesView / DriveViewModel.retryConnection.
struct DriveConnectionErrorView: View {
    var isRetrying: Bool
    var onRetry: () -> Void

    var body: some View {
        VStack(spacing: 18) {
            Image(systemName: "wifi.slash")
                .font(.system(size: 44, weight: .light))
                .foregroundStyle(DriveExplorerStyle.textTertiary)
                .accessibilityHidden(true)

            Text("No connection")
                .font(.title2.weight(.bold))
                .foregroundStyle(DriveExplorerStyle.textPrimary)

            Text("Connect to the internet to browse your files, or check again if you are already online.")
                .font(.subheadline)
                .foregroundStyle(DriveExplorerStyle.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 28)

            Button(action: onRetry) {
                Group {
                    if isRetrying {
                        ProgressView()
                            .tint(.white)
                    } else {
                        Text("Check again")
                    }
                }
                .font(.headline)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
            }
            .buttonStyle(.borderedProminent)
            .tint(DriveExplorerStyle.accent)
            .disabled(isRetrying)
            .padding(.horizontal, 40)
            .padding(.top, 8)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 56)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("No connection. Check again to retry.")
    }
}

#Preview {
    DriveConnectionErrorView(isRetrying: false, onRetry: {})
}
