#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Use the same build location and signing settings as Xcode Run to avoid duplicate extensions.
xcodebuild -project 'macOS/Send to Transmission/Send to Transmission.xcodeproj' \
  -scheme 'Send to Transmission' -configuration Debug \
  build
