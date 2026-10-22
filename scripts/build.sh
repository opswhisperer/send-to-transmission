#!/bin/bash
# Builds a Release copy of the app and puts it in DEST (default: the repository root).
# Usage: scripts/build.sh [DEST]     e.g. scripts/build.sh /Applications
set -euo pipefail
cd "$(dirname "$0")/.."

DEST="${1:-.}"
[[ -d "$DEST" ]] || { echo "Error: $DEST is not a directory." >&2; exit 1; }
DEST="$(cd "$DEST" && pwd)"
LSREGISTER=/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister
PRODUCTS=build/DerivedData/Build/Products/Release
APP="Send to Transmission.app"
EXTENSION="Send to Transmission Extension.appex"

xcodebuild -project 'macOS/Send to Transmission/Send to Transmission.xcodeproj' \
  -scheme 'Send to Transmission' -configuration Release -destination 'generic/platform=macOS' \
  -derivedDataPath build/DerivedData -quiet build

# Unregister the intermediate copies so Safari only sees the installed app.
"$LSREGISTER" -u "$PRODUCTS/$APP" 2>/dev/null || true
pluginkit -r "$PRODUCTS/$APP/Contents/PlugIns/$EXTENSION" 2>/dev/null || true
pluginkit -r "$PRODUCTS/$EXTENSION" 2>/dev/null || true

rm -rf "${DEST:?}/$APP"
ditto "$PRODUCTS/$APP" "$DEST/$APP"
"$LSREGISTER" -f "$DEST/$APP"

echo "Built $DEST/$APP"
echo "Open it once, then enable Send to Transmission in Safari → Settings → Extensions."
