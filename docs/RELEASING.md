# Releasing

Anyone can build from source (see [BUILDING.md](BUILDING.md)). A ready-to-run download must be signed with a **Developer ID Application** certificate and notarized by Apple, or Gatekeeper blocks it and Safari only loads it with Allow Unsigned Extensions. That requires a paid Apple Developer Program membership.

## One-time setup

1. Create a Developer ID Application certificate: Xcode → Settings → Accounts → your team → Manage Certificates → + → **Developer ID Application**.
2. Configure the overlay with the release bundle prefix: `scripts/configure.sh --force --bundle-prefix <prefix> --team <TEAM ID>`. Keep the prefix stable; changing it later creates a different app, and users lose their saved settings and password.
3. Store notarization credentials in the keychain under the profile name `notary`, using an app-specific password from [account.apple.com](https://account.apple.com):

   ```sh
   xcrun notarytool store-credentials notary --apple-id <Apple ID> --team-id <TEAM ID>
   ```

## Version

1. Set the same `MARKETING_VERSION` (e.g. `1.1.0`) for both targets and increase `CURRENT_PROJECT_VERSION` in `project.pbxproj`, and set `"version"` in `Extension/manifest.json` to match.
2. Move the `## Unreleased` notes in `RELEASE_NOTES.md` under a `## 1.1.0` heading.
3. Run `bash scripts/test.sh`, commit, and tag: `git tag -a v1.1.0 -m "Send to Transmission 1.1.0"`.

## Archive, sign, notarize

```sh
VERSION=1.1.0
OUT="build/release/$VERSION"
PROJECT="macOS/Send to Transmission/Send to Transmission.xcodeproj"
TEAM="$(scripts/configure.sh --show | sed -n 's/^DEVELOPMENT_TEAM = //p')"
mkdir -p "$OUT"

xcodebuild -project "$PROJECT" -scheme "Send to Transmission" -configuration Release \
  -destination "generic/platform=macOS" -derivedDataPath "$OUT/DerivedData" \
  -archivePath "$OUT/Send to Transmission.xcarchive" -allowProvisioningUpdates archive

cat > "$OUT/ExportOptions.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>developer-id</string>
  <key>signingStyle</key><string>automatic</string>
  <key>teamID</key><string>$TEAM</string>
</dict></plist>
EOF

xcodebuild -exportArchive -archivePath "$OUT/Send to Transmission.xcarchive" \
  -exportPath "$OUT/export" -exportOptionsPlist "$OUT/ExportOptions.plist" -allowProvisioningUpdates

APP="$OUT/export/Send to Transmission.app"
ditto -c -k --keepParent "$APP" "$OUT/notarize.zip"
xcrun notarytool submit "$OUT/notarize.zip" --keychain-profile notary --wait
xcrun stapler staple "$APP"
spctl --assess --type execute -vv "$APP"     # expect: accepted, source=Notarized Developer ID
ditto -c -k --keepParent "$APP" "$OUT/Send-to-Transmission-$VERSION.zip"
```

If notarization fails, read the log with `xcrun notarytool log <submission ID> --keychain-profile notary`. The project already enables the hardened runtime and App Sandbox, which notarization requires.

Archiving can register a second copy of the extension with Safari. If Safari lists it twice, unregister the extra copy as described in [BUILDING.md → Troubleshooting](BUILDING.md#troubleshooting).

## Publish

```sh
git push --follow-tags origin main
gh release create "v$VERSION" "$OUT/Send-to-Transmission-$VERSION.zip" --title "$VERSION" \
  --notes-file <(awk -v v="## $VERSION" '$0 == v { on=1; next } on && /^## / { exit } on' RELEASE_NOTES.md)
```

Before announcing a release, download the zip on another Mac or a clean user account and confirm it opens without a Gatekeeper warning and the extension appears in Safari.
