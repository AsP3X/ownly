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
    ├── ContentView.swift     # Root UI shell
    ├── Core/
    │   ├── Configuration/    # API URL and app constants
    │   └── API/              # HTTP client aligned with backend error shape
    └── Assets.xcassets/
```

## Next steps

- Auth flow (login, token storage in Keychain)
- Drive file list and upload
- Share extension / background downloads (later)

The web client lives in `frontend/`; mirror its API paths and `{ error: { code, message } }` handling in `Core/API/`.
