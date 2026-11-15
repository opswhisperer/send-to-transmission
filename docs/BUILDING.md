# Building Send to Transmission

This guide covers building the app and Safari extension from source. An Apple Developer account is required; the reason is explained below.

## Requirements

- macOS 12 or later. Safari 15.4 or later (Manifest V3).
- Xcode 27 or later. The project uses Xcode 27's project format.
- Node.js 18 or later for the JavaScript tests.
- Optional: Playwright with Chromium for `tests/ui.cjs` and `tests/click.cjs`.
- An Apple Developer account, signed in under Xcode → Settings → Accounts.

## Quick start

```sh
git clone https://github.com/opswhisperer/send-to-transmission.git
cd send-to-transmission
scripts/configure.sh --bundle-prefix com.yourname
bash scripts/test.sh
bash scripts/build.sh /Applications
```

`scripts/build.sh [DEST]` builds a Release copy and puts **Send to Transmission.app** in `DEST`, or in the repository folder when omitted. It replaces any previous copy there. Open the app once, then enable **Send to Transmission** in Safari → Settings → Extensions.

## Why a developer account is required

- The app can open magnet links and `.torrent` files itself, so links the Safari extension never sees still reach your server. To do that it needs the server address and RPC password you saved in the extension.
- macOS keeps a sandboxed app and its extension apart. The only supported ways to share between them are an app group (the settings) and a Keychain access group (the password).
- macOS grants both only to builds signed with a development team. An ad-hoc ("Sign to Run Locally") build that claims a Keychain access group is killed at launch, and ad-hoc builds cannot read or write an app group at all.

So a build without a team either will not start or cannot share anything, and there is no unsigned variant. `scripts/build.sh` stops with an explanation when no team is configured.

## How signing configuration works

The Xcode project contains no team ID or concrete bundle identifier. Signing values come from two xcconfig layers, like a base and an overlay:

| File | Tracked | Purpose |
| --- | --- | --- |
| `Config/Base.xcconfig` | yes | Placeholder defaults: no team, `com.example` prefix. Not runnable on its own. Ends with `#include? "Local.xcconfig"`. |
| `Config/Local.xcconfig` | **no** (gitignored) | Your overlay: Team ID, signing identity, bundle prefix, optional Keychain service names. |
| `Config/Local.xcconfig.example` | yes | Template for the overlay. |

The project-level Debug and Release configurations use `Base.xcconfig` as their base configuration, and both targets derive their identifiers from it:

- App: `$(BUNDLE_ID_PREFIX).SendToTransmission`
- Extension: `$(BUNDLE_ID_PREFIX).SendToTransmission.Extension`
- App group and Keychain access group, shared by both targets: your team ID followed by `$(BUNDLE_ID_PREFIX).SendToTransmission`.
- Keychain service for the RPC password: `$(TRANSMISSION_KEYCHAIN_SERVICE)`, defaulting to `$(BUNDLE_ID_PREFIX).SendToTransmission.rpc`. It is written into both `Info.plist` files as `TransmissionKeychainService` and read at runtime.

Values passed on the `xcodebuild` command line override both files, e.g. `xcodebuild … BUNDLE_ID_PREFIX=com.other`.

## `scripts/configure.sh`

The script writes `Config/Local.xcconfig` and prints the effective settings. It never modifies tracked files.

| Option | Effect |
| --- | --- |
| `--bundle-prefix PREFIX` | Required the first time. A reverse-DNS prefix you control, e.g. `com.yourname`. `com.example` is refused. |
| `--team ID` | Ten-character Team ID. When omitted, the script reads your Apple Development / Developer ID certificates and uses the only team found, or lists several and asks you to choose. |
| `--local` | Ad-hoc signing (`DEVELOPMENT_TEAM` empty, `CODE_SIGN_IDENTITY = -`), for checking that the project compiles. macOS will not launch the result. |
| `--keychain-service NAME` | Override the Keychain service name. |
| `--legacy-keychain-service NAME` | Service name an earlier build saved the password under; the extension moves it to the current one the first time it runs. |
| `--list-teams` | Print the teams found in your keychain. |
| `--show` | Print the effective `DEVELOPMENT_TEAM`, `CODE_SIGN_IDENTITY`, `PRODUCT_BUNDLE_IDENTIFIER`, and Keychain service. |
| `--force` | Replace an existing overlay. Without it the script refuses to overwrite. |

Your Team ID is shown at [developer.apple.com → Account → Membership details](https://developer.apple.com/account) and in Xcode → Settings → Accounts.

## Don't use Xcode's Signing & Capabilities team picker

Selecting a team there writes `DEVELOPMENT_TEAM = …` into `project.pbxproj` for each target. That overrides the overlay and would put your team ID in a commit. If you clicked it by accident:

```sh
git checkout -- "macOS/Send to Transmission/Send to Transmission.xcodeproj/project.pbxproj"
```

To change teams, rerun `scripts/configure.sh --force …` instead.

## Building

1. Sign in under Xcode → Settings → Accounts so an Apple Development certificate exists.
2. `scripts/configure.sh --bundle-prefix com.yourname`.
3. `bash scripts/build.sh /Applications`, or Run in Xcode. Automatic signing registers the bundle IDs and creates provisioning profiles on the first build.
4. Open the app once and enable the extension in Safari → Settings → Extensions.
5. Optional: `scripts/magnet-handler.sh --set` makes the installed app open magnet links from every app on your Mac. Without `--set` it reports which app does now. This is a script because macOS refuses the request from a sandboxed app, so the app cannot offer it as a button.

Bundle IDs are unique across all Apple developer accounts. If a prefix belongs to another team, signing fails with "No profiles for … were found" or "… is not available"; choose a prefix you own.

## Changing the bundle prefix or Keychain service

A different bundle prefix is a different app to macOS and Safari: settings and the saved RPC password don't carry over, so re-enter them in the extension's Settings. To carry over a password an earlier build saved under another service name, pass `--legacy-keychain-service <old name>`.

## Tests

```sh
bash scripts/test.sh         # JavaScript tests and Swift RPC tests
node tests/ui.cjs            # optional, needs Playwright + Chromium
node tests/click.cjs         # optional, needs Playwright + Chromium
```

Set `PLAYWRIGHT_PATH` if Playwright is not on Node's module path.

## Troubleshooting

**"Signing for … requires a development team."** The overlay sets `CODE_SIGN_IDENTITY = Apple Development` with an empty `DEVELOPMENT_TEAM`. Rerun `scripts/configure.sh --force` with `--team`.

**The app quits the moment it opens.** It was built without a development team. Rerun `scripts/configure.sh --force` so the overlay has a team, then rebuild.

**Two "Send to Transmission" entries in Safari.** Every copy of the app registers its own extension, e.g. one from `scripts/build.sh` and one from Xcode's Run. Keep one copy, or list and unregister the extras:

```sh
pluginkit -mAvvv -p com.apple.Safari.web-extension | grep -A3 SendToTransmission
pluginkit -r "/path/to/Other Copy.app/Contents/PlugIns/Send to Transmission Extension.appex"
```

**"The extension’s helper did not respond."** The native handler isn't running the current build. Rebuild, open the app once, and quit and reopen Safari.
