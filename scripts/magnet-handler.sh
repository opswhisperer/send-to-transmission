#!/bin/bash
# Shows, or with --set changes, which app opens magnet: links on this Mac.
#
# The app cannot do this itself: macOS refuses the request from a sandboxed app
# (LaunchServices error -54), so it has to come from outside the sandbox.
#
# Usage: scripts/magnet-handler.sh [--set] [APP]
#   APP defaults to /Applications/Send to Transmission.app
set -euo pipefail

MODE=show
APP="/Applications/Send to Transmission.app"
while (($#)); do
    case "$1" in
        --set) MODE=set ;;
        -h|--help) sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        -*) echo "Unknown option: $1" >&2; exit 2 ;;
        *) APP="$1" ;;
    esac
    shift
done

MAGNET_MODE="$MODE" MAGNET_APP="$APP" exec swift - <<'SWIFT'
import AppKit

let environment = ProcessInfo.processInfo.environment
let probe = URL(string: "magnet:?xt=urn:btih:0000000000000000000000000000000000000000")!
func current() -> String { NSWorkspace.shared.urlForApplication(toOpen: probe)?.path ?? "no app" }

print("Magnet links open in: \(current())")
guard environment["MAGNET_MODE"] == "set" else { exit(0) }

let app = URL(fileURLWithPath: environment["MAGNET_APP"] ?? "")
let types = Bundle(url: app)?.infoDictionary?["CFBundleURLTypes"] as? [[String: Any]] ?? []
guard types.contains(where: { ($0["CFBundleURLSchemes"] as? [String] ?? []).contains("magnet") }) else {
    FileHandle.standardError.write(Data("Error: \(app.path) is not a copy of Send to Transmission. Build it first with scripts/build.sh.\n".utf8))
    exit(1)
}
final class Outcome: @unchecked Sendable { var error: Error? }
let outcome = Outcome()
let finished = DispatchSemaphore(value: 0)
NSWorkspace.shared.setDefaultApplication(at: app, toOpenURLsWithScheme: "magnet") { error in
    outcome.error = error
    finished.signal()
}
finished.wait()
if let error = outcome.error {
    FileHandle.standardError.write(Data("Error: \(error.localizedDescription)\n".utf8))
    exit(1)
}
print("Changed to:           \(current())")
SWIFT
