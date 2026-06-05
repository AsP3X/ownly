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
                    colors: [OwnlyColors.primary950, OwnlyColors.neutral950],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
                .ignoresSafeArea()

                ScrollView {
                    VStack(alignment: .leading, spacing: 24) {
                        Text("Server configuration")
                            .font(.system(size: 28, weight: .bold))
                            .foregroundStyle(OwnlyColors.textOnGradient)

                        Text("Point the app at your Ownly API. The default works with Docker on this Mac.")
                            .font(.subheadline)
                            .foregroundStyle(OwnlyColors.neutral400)

                        field(title: "Host", text: $config.host, field: .host)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()

                        field(title: "Port", text: portBinding, field: .port)
                            .keyboardType(.numberPad)

                        Toggle("Use HTTPS", isOn: $config.useHTTPS)
                            .tint(OwnlyColors.primary500)
                            .foregroundStyle(OwnlyColors.neutral100)

                        if let url = config.apiBaseURL?.absoluteString {
                            Text("API base URL")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(OwnlyColors.neutral400)
                            Text(url)
                                .font(.caption.monospaced())
                                .foregroundStyle(OwnlyColors.neutral200)
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
                    .foregroundStyle(OwnlyColors.primary400)
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
                .foregroundStyle(OwnlyColors.neutral400)
            TextField(title, text: text)
                .focused($focusedField, equals: field)
                .foregroundStyle(OwnlyColors.neutral100)
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
                    colors: [OwnlyColors.primary950, OwnlyColors.neutral950],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
                .ignoresSafeArea()

                VStack(alignment: .leading, spacing: 16) {
                    Text(config.apiBaseURL?.absoluteString ?? "No URL configured")
                        .font(.caption.monospaced())
                        .foregroundStyle(OwnlyColors.neutral200)
                        .textSelection(.enabled)

                    Text(statusText)
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(OwnlyColors.textOnGradient)

                    if case .unreachable(let message) = result, let message {
                        Text(message)
                            .font(.footnote)
                            .foregroundStyle(OwnlyColors.error500)
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
                        .foregroundStyle(OwnlyColors.primary400)
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
