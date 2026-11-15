# Release notes

## Unreleased

- The app now opens `magnet:` links and `.torrent` files and sends them to the configured server, so links the Safari extension cannot see (private windows, pages without website access, links opened by scripts, other apps) no longer fall to another program. It shows which app owns magnet links and can make itself the default.
- Settings move to an app group and the password to a shared Keychain group so the app and extension use the same server; both are migrated the first time the updated extension runs. **Building now requires an Apple Developer account**, because macOS grants those groups only to team-signed builds.
- Click capture is saved with the native settings (shared by all Safari profiles, kept across reinstalls), applies as soon as it is ticked, and its state is shown in the toolbar popup with buttons to turn it on, allow website access, or reload the page.
- Clicking a captured link shows a notice immediately. A background page that is not answering is reported within 5 seconds rather than after 45.
- Capture every magnet link, including numbered topics (`xt.1`) and hash-less magnets that name a torrent file (`xs`); explain malformed ones on the page. Capture image-map and SVG links and links in `about:blank` frames.
- Normal clicks now send same-site torrent downloads whose address has no `.torrent` in it, when the link describes itself as a torrent download.
- A `.torrent` link from another website to a private-network address always opens the send page.
- Register the context menu on every background start.
- Fix: saved settings were discarded if a newer version added a setting. Fix: changing the server with a blank password stored an empty password and reported it as saved. Fix: the native request could outlast the scripts' timeouts and report a timeout for a send that succeeded.

## 1.0

First public release.

- Send magnet links and torrent URLs from Safari to a Transmission 3.x or 4.x server by right-clicking, pasting into the toolbar popup, or optional click capture.
- Configurable HTTP/HTTPS endpoint, port and RPC path, with optional login stored in the macOS Keychain.
- Choose a download directory on the server, reuse recent directories, and add torrents paused.
- Send authenticated same-site torrent downloads using Safari's session, including extensionless URLs and generic binary responses. Torrent contents are validated before being forwarded; website cookies stay in Safari.
- Top-of-page notifications with a Close button, and OK / ! toolbar badges.
- Help tab explaining setup, sending methods, directories, and troubleshooting.
- Signing team and bundle identifiers come from a local `Config/Local.xcconfig` overlay created by `scripts/configure.sh`. A fresh clone builds ad-hoc signed without a developer account.
