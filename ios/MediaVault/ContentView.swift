import SwiftUI

// Human: Placeholder root screen until auth and drive UI are implemented.
// Agent: DISPLAYS configured API base URL; CALLS no network APIs yet.
struct ContentView: View {
    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                Image(systemName: "externaldrive.fill")
                    .font(.system(size: 48))
                    .foregroundStyle(.tint)

                Text("MediaVault")
                    .font(.title.bold())

                Text("iOS app scaffold — connect to your instance and build from here.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)

                LabeledContent("API base URL") {
                    Text(AppConfiguration.apiBaseURL.absoluteString)
                        .font(.caption.monospaced())
                        .foregroundStyle(.secondary)
                }
                .padding(.top, 8)
            }
            .padding()
            .navigationTitle("MediaVault")
        }
    }
}

#Preview {
    ContentView()
}
