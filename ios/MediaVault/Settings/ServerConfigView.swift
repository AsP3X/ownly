import SwiftUI

// Human: Server URL editor sheet bound to shared AppState config.
// Agent: WRITES host/port/https; SAVES UserDefaults on dismiss.
struct ServerConfigView: View {
    @Binding var config: ServerConfig
    @Environment(\.dismiss) private var dismiss
    @FocusState private var focusedField: Field?
    @State private var portText: String = ""

    enum Field { case host, port }

    var body: some View {
        NavigationStack {
            ZStack {
                LinearGradient(
                    colors: [MediaVaultColors.primary950, MediaVaultColors.neutral950],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
                .ignoresSafeArea()

                ScrollView {
                    VStack(alignment: .leading, spacing: 24) {
                        Text("Server configuration")
                            .font(.system(size: 28, weight: .bold))
                            .foregroundStyle(MediaVaultColors.textOnGradient)

                        Text("Point the app at your MediaVault API. The default works with Docker on this Mac.")
                            .font(.subheadline)
                            .foregroundStyle(MediaVaultColors.neutral400)

                        field(title: "Host", text: $config.host, field: .host)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()

                        field(title: "Port", text: portBinding, field: .port)
                            .keyboardType(.numberPad)

                        Toggle("Use HTTPS", isOn: $config.useHTTPS)
                            .tint(MediaVaultColors.primary500)
                            .foregroundStyle(MediaVaultColors.neutral100)

                        if let url = config.apiBaseURL?.absoluteString {
                            Text("API base URL")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(MediaVaultColors.neutral400)
                            Text(url)
                                .font(.caption.monospaced())
                                .foregroundStyle(MediaVaultColors.neutral200)
                                .textSelection(.enabled)
                                .padding(12)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .glassCard(cornerRadius: 12)
                        }
                    }
                    .padding(.horizontal, 20)
                    .padding(.vertical, 16)
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(.hidden, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        config.save()
                        dismiss()
                    }
                    .foregroundStyle(MediaVaultColors.primary400)
                }
            }
            .onAppear {
                portText = config.port > 0 ? "\(config.port)" : ""
            }
        }
    }

    private var portBinding: Binding<String> {
        Binding(
            get: { portText.isEmpty ? (config.port > 0 ? "\(config.port)" : "") : portText },
            set: { newValue in
                portText = newValue
                config.port = Int(newValue) ?? ServerConfig.defaultPort
            }
        )
    }

    private func field(title: String, text: Binding<String>, field: Field) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.system(size: 11, weight: .semibold))
                .tracking(0.6)
                .foregroundStyle(MediaVaultColors.neutral400)
            TextField(title, text: text)
                .focused($focusedField, equals: field)
                .foregroundStyle(MediaVaultColors.neutral100)
                .padding(.horizontal, 16)
                .padding(.vertical, 14)
                .glassField(cornerRadius: 10)
        }
    }
}

struct ServerHealthStatusView: View {
    let config: ServerConfig
    @Environment(\.dismiss) private var dismiss
    @State private var result: TenantHealthResult = .checking

    var body: some View {
        NavigationStack {
            ZStack {
                LinearGradient(
                    colors: [MediaVaultColors.primary950, MediaVaultColors.neutral950],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
                .ignoresSafeArea()

                VStack(alignment: .leading, spacing: 16) {
                    Text(config.apiBaseURL?.absoluteString ?? "No URL configured")
                        .font(.caption.monospaced())
                        .foregroundStyle(MediaVaultColors.neutral200)
                        .textSelection(.enabled)

                    Text(statusText)
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(MediaVaultColors.textOnGradient)

                    if case .unreachable(let message) = result, let message {
                        Text(message)
                            .font(.footnote)
                            .foregroundStyle(MediaVaultColors.error500)
                    }

                    Spacer()
                }
                .padding(24)
            }
            .navigationTitle("Server status")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(.hidden, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                        .foregroundStyle(MediaVaultColors.primary400)
                }
            }
            .task {
                result = .checking
                result = await TenantHealthChecker.check(config: config)
            }
        }
    }

    private var statusText: String {
        switch result {
        case .checking: "Checking connection…"
        case .healthy: "Server is reachable"
        case .degraded: "Server is degraded"
        case .unreachable: "Server is unreachable"
        }
    }
}
