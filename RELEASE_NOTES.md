# Release notes

## Unreleased

## 1.0

First public release.

- Send magnet links and torrent URLs from Safari to a Transmission 3.x or 4.x server by right-clicking, pasting into the toolbar popup, or optional click capture.
- Configurable HTTP/HTTPS endpoint, port and RPC path, with optional login stored in the macOS Keychain.
- Choose a download directory on the server, reuse recent directories, and add torrents paused.
- Send authenticated same-site torrent downloads using Safari's session, including extensionless URLs and generic binary responses. Torrent contents are validated before being forwarded; website cookies stay in Safari.
- Top-of-page notifications with a Close button, and OK / ! toolbar badges.
- Help tab explaining setup, sending methods, directories, and troubleshooting.
- Signing team and bundle identifiers come from a local `Config/Local.xcconfig` overlay created by `scripts/configure.sh`. A fresh clone builds ad-hoc signed without a developer account.
