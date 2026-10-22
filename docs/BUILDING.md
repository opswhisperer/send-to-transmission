# Building Send to Transmission

This guide covers building the app and Safari extension from source, with or without an Apple Developer account.

## Requirements

- macOS 12 or later. Safari 15.4 or later (Manifest V3).
- Xcode 27 or later. The project uses Xcode 27's project format.
- Node.js 18 or later for the JavaScript tests.
- Optional: Playwright with Chromium for `tests/ui.cjs` and `tests/click.cjs`.
- Optional: an Apple Developer account. Without one, the app is ad-hoc signed and Safari needs **Allow Unsigned Extensions** (see below).

## Quick start

```sh
git clone https://github.com/opswhisperer/send-to-transmission.git
cd send-to-transmission
scripts/configure.sh --bundle-prefix com.yourname   # add --local if you have no developer account
bash scripts/test.sh
bash scripts/build.sh
```

Open the built app once (in Xcode: Product → Show Build Folder in Finder, or just Run), then enable **Send to Transmission** in Safari → Settings → Extensions.

## How signing configuration works

The Xcode project contains no team ID or concrete bundle identifier. Signing values come from two xcconfig layers, like a base and an overlay:

| File | Tracked | Purpose |
| --- | --- | --- |
| `Config/Base.xcconfig` | yes | Shared defaults: no team, ad-hoc signing, `com.example` prefix. Ends with `#include? "Local.xcconfig"`. |
| `Config/Local.xcconfig` | **no** (gitignored) | Your overlay: Team ID, signing identity, bundle prefix, optional Keychain service. |
| `Config/Local.xcconfig.example` | yes | Template for the overlay. |

The project-level Debug and Release configurations use `Base.xcconfig` as their base configuration, and both targets derive their identifiers from it:

- App: `$(BUNDLE_ID_PREFIX).SendToTransmission`
- Extension: `$(BUNDLE_ID_PREFIX).SendToTransmission.Extension`
- Keychain service for the RPC password: `$(TRANSMISSION_KEYCHAIN_SERVICE)`, defaulting to `$(BUNDLE_ID_PREFIX).SendToTransmission.rpc`. It is written into the extension's `Info.plist` as `TransmissionKeychainService` and read at runtime.

Values passed on the `xcodebuild` command line override both files, e.g. `xcodebuild … BUNDLE_ID_PREFIX=com.other`.

## `scripts/configure.sh`

The script writes `Config/Local.xcconfig` and prints the effective settings. It never modifies tracked files.

| Option | Effect |
| --- | --- |
| `--bundle-prefix PREFIX` | Required the first time. A reverse-DNS prefix you control, e.g. `com.yourname`. `com.example` is refused. |
| `--team ID` | Ten-character Team ID. When omitted, the script reads your Apple Development / Developer ID certificates and uses the only team found, or lists several and asks you to choose. |
| `--local` | No developer account: `DEVELOPMENT_TEAM` empty and `CODE_SIGN_IDENTITY = -`. |
| `--keychain-service NAME` | Override the Keychain service name, e.g. to keep a password saved by an older build. |
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

## Building without a developer account

1. `scripts/configure.sh --local --bundle-prefix com.yourname`. You can skip this: a fresh clone already builds ad-hoc as `com.example.*`.
2. `bash scripts/build.sh`, then open the built app once.
3. In Safari → Settings → Advanced, enable **Show features for web developers** (older Safari: **Show Develop menu in menu bar**).
4. Choose **Develop → Allow Unsigned Extensions**. Safari asks for your password and resets this every time it quits.
5. Enable the extension in Safari → Settings → Extensions.

## Building with a developer account

1. Sign in under Xcode → Settings → Accounts so an Apple Development certificate exists.
2. `scripts/configure.sh --bundle-prefix com.yourname`.
3. `bash scripts/build.sh`, or Run in Xcode. Automatic signing registers the bundle IDs and creates provisioning profiles on the first build.

Bundle IDs are unique across all Apple developer accounts. If a prefix belongs to another team, signing fails with "No profiles for … were found" or "… is not available"; choose a prefix you own.

## Changing the bundle prefix or Keychain service

A different bundle prefix is a different app to macOS and Safari: settings and the saved RPC password don't carry over, so re-enter them in the extension's Settings. To keep a password saved under an older service name, pass `--keychain-service <old name>`.

## Tests

```sh
bash scripts/test.sh         # JavaScript tests and Swift RPC tests
node tests/ui.cjs            # optional, needs Playwright + Chromium
node tests/click.cjs         # optional, needs Playwright + Chromium
```

Set `PLAYWRIGHT_PATH` if Playwright is not on Node's module path.

## Troubleshooting

**"Signing for … requires a development team."** The overlay sets `CODE_SIGN_IDENTITY = Apple Development` with an empty `DEVELOPMENT_TEAM`. Rerun `scripts/configure.sh --force` with `--team` or `--local`.

**Two "Send to Transmission" entries in Safari.** Copies built in different folders each register an extension. Build in one place (`scripts/build.sh` uses Xcode's default DerivedData, the same as Run), or list and unregister the extras:

```sh
pluginkit -mAvvv -p com.apple.Safari.web-extension | grep -A3 SendToTransmission
pluginkit -r "/path/to/Other Copy.app/Contents/PlugIns/Send to Transmission Extension.appex"
```

**The unsigned extension disappeared.** Safari turned off **Allow Unsigned Extensions** when it quit. Turn it on again.

**"The extension did not respond."** The native handler isn't running the current build. Rebuild, open the app once, and reopen the Safari popup.
