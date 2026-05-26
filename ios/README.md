# MediaVault iOS

Native iOS client for [MediaVault](../README.md). This folder is the starting point for the SwiftUI app.

## Requirements

- macOS with [Xcode 15+](https://developer.apple.com/xcode/)
- iOS 17+ deployment target (adjust in the Xcode project if you need older OS support)
- A running MediaVault API (local Docker stack or remote instance)

## Open the project

```bash
cd ios
open MediaVault.xcodeproj
```

Select the **MediaVault** scheme and an iPhone simulator, then run (⌘R).

## API base URL

The app reads `API_BASE_URL` from `Info.plist` (default: `http://127.0.0.1:3000/api/v1`).

For a simulator talking to the Docker API on your Mac, that default is usually correct. For a physical device, set the host to your machine's LAN IP (not `127.0.0.1`).

Override at build time with an `.xcconfig` or Xcode build setting if needed.

## Layout

```
ios/
├── MediaVault.xcodeproj/     # Xcode project
└── MediaVault/
    ├── MediaVaultApp.swift   # App entry point
    ├── ContentView.swift     # Signed-in drive shell (placeholder)
    ├── Core/
    │   ├── Configuration/    # API URL and app constants
    │   ├── Security/         # Keychain helpers
    │   ├── Auth/             # Session + auth models
    │   ├── Onboarding/       # Onboarding completion flags
    │   └── API/              # HTTP client aligned with backend error shape
    ├── Design/
    │   └── Glass/            # Frosted-glass UI primitives
    └── Features/
        ├── Root/             # Onboarding vs drive routing
        └── Onboarding/       # First-use onboarding flow (6 steps)
```

## First-use onboarding

On first launch the app walks through:

1. Welcome
2. Connect to your MediaVault server (`/api/v1` URL)
3. Sign in (or create account when registration is enabled)
4. Photos permission (skippable)
5. Feature highlights (skippable)
6. Ready → Drive shell

Server URL and auth token are stored in Keychain. Onboarding completion flags live in `UserDefaults`. After sign-out, returning users resume at the sign-in step.

Run in the simulator with your Docker API on `http://127.0.0.1:3000/api/v1` (default in `Info.plist`).

The web client lives in `frontend/`; mirror its API paths and `{ error: { code, message } }` handling in `Core/API/`.
