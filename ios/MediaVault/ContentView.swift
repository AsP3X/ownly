import SwiftUI

// Human: Signed-in home shell shown after onboarding completes.
// Agent: DISPLAYS connected server + user; PLACEHOLDER until drive UI ships.
struct ContentView: View {
    @Environment(SessionStore.self) private var session
    @Environment(ServerConfiguration.self) private var server

    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                Image(systemName: "externaldrive.fill")
                    .font(.system(size: 48))
                    .foregroundStyle(.tint)

                Text("MediaVault")
                    .font(.title.bold())

                Text("Drive UI coming next — you're connected and signed in.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)

                GlassCard {
                    VStack(alignment: .leading, spacing: 12) {
                        LabeledContent("Signed in as") {
                            Text(session.user?.email ?? "Unknown")
                                .font(.caption.monospaced())
                        }
                        LabeledContent("Server") {
                            Text(server.displayHost)
                                .font(.caption.monospaced())
                        }
                        LabeledContent("API base URL") {
                            Text(AppConfiguration.apiBaseURL.absoluteString)
                                .font(.caption.monospaced())
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                .padding(.horizontal)
            }
            .padding()
            .navigationTitle("Drive")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Sign out") {
                        session.signOut()
                    }
                }
            }
        }
    }
}

#Preview {
    ContentView()
        .environment(SessionStore.shared)
        .environment(ServerConfiguration.shared)
        .environment(OnboardingStore.shared)
}
