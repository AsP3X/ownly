# MediaVault iOS

Native iOS client for [MediaVault](../README.md), rebuilt from the **Cloudwrkz iOS 26** app shell.

## Requirements

- macOS with Xcode 26+ (uses `glassEffect` on iOS 26)
- iOS 26 deployment target
- A running MediaVault API (local Docker stack or remote instance)

## Open the project

```bash
cd ios
open MediaVault.xcodeproj
```

Select the **MediaVault** scheme and an iPhone simulator, then run (⌘R).

## Server configuration

Default API base URL: `http://127.0.0.1:3000/api/v1` (Docker on your Mac).

On auth screens, use the **gear** button to change host, port, and HTTPS. The status pill checks `GET /api/v1/setup/status`.

For a physical device, set the host to your Mac's LAN IP instead of `127.0.0.1`.

## Architecture (Cloudwrkz template)

```
ios/MediaVault/
├── App/                 # MediaVaultApp, RootView, SplashView, ContentView, AppState
├── Auth/                # AuthFlowController, Login/Register, AuthService, Keychain token
├── Core/                # AppIdentity (User-Agent)
├── Design/              # MediaVaultDesign (liquid glass, colors, motion)
└── Settings/            # ServerConfig, health pill, config sheet
```

**Routing:** `RootView` keeps `ContentView` mounted and layers splash/login/register on top with elastic slide transitions — same pattern as Cloudwrkz.

**Auth:** Keychain token → skip splash on cold start. Logout clears token and profile hints.

**Drive UI:** `FilesView` lists folders and files; pull-to-refresh reloads the current folder. The center **Upload** button opens the system file picker; uploads run in the background with the same phased progress as the web transfer panel (upload → encode → storage for video). Tap the circular progress control in the Files header to open the upload queue.

The web client lives in `frontend/`; mirror its `/api/v1` paths and `{ error: { code, message } }` envelope in `Auth/AuthService.swift`.
