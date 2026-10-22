# Send to Transmission

A macOS Safari extension that sends magnet links and torrent URLs to your own [Transmission](https://transmissionbt.com) server. It is a single app with a native RPC handler: there is no separate daemon or helper to install.

- Right-click a link → **Send to Transmission**, paste a link into the toolbar popup, or optionally capture normal clicks on magnet / `.torrent` links.
- Choose a download directory on the server, reuse recent directories, and add torrents paused.
- HTTP or HTTPS, custom port and RPC path, optional login with the password stored in the macOS Keychain.
- Same-site torrent downloads that need a website login are fetched with Safari's session; website cookies are never sent to Transmission.

Requires macOS 12 or later, Safari 15.4 or later, and a reachable Transmission 3.x or 4.x server with RPC enabled.

## Install

Download the latest release from the [Releases](../../releases) page, unzip it, move **Send to Transmission.app** to /Applications, and open it once. Then enable **Send to Transmission** in Safari → Settings → Extensions, and grant website access for sites where you want link capture to work.

To build it yourself, see [docs/BUILDING.md](docs/BUILDING.md). The short version:

```sh
scripts/configure.sh --bundle-prefix com.yourname          # with an Apple Developer account
scripts/configure.sh --local --bundle-prefix com.yourname  # without one
bash scripts/build.sh /Applications                       # or omit to build into the repo folder
```

## Configure

Open the extension's toolbar popup → **Settings**:

- Server hostname, IP, or full HTTP(S) URL. A pasted URL sets the host, HTTPS toggle and port; a non-root URL path also sets the RPC path. IPv4 and IPv6 are accepted.
- Port: normally 9091 for HTTP, or 443 behind an HTTPS proxy.
- **Use SSL / HTTPS**; uncheck for plain HTTP.
- RPC path, normally `/transmission/rpc`.
- Optional username and password. The password stays in the macOS Keychain and is never returned to browser scripts. Leaving it blank keeps an existing password for the same endpoint and account. Disabling login deletes it; changing the endpoint or account requires entering it again.
- Default download directory, **Choose a directory before sending links**, and **Add paused by default**.
- Optional interception of normal clicks on recognizable magnet / `.torrent` links.

**Save & test connection** confirms access and shows the server version and its default directory.

HTTPS uses normal macOS trust evaluation: a self-signed certificate must be trusted by macOS and valid for the hostname. There is no certificate-validation bypass. Plain HTTP is allowed because the endpoint is user-configurable; credentials sent over HTTP are not encrypted in transit.

## Send links

- **Right-click** a link → **Send to Transmission**. The send page always opens so you can review the directory and paused options. For same-site torrent links, the extension fetches the torrent with your Safari session, so the URL doesn't need a `.torrent` suffix. It sends the torrent contents, not your cookies, to Transmission. Redirects, cross-origin links, responses without torrent or generic binary headers, and files over 2 MB are rejected. Website access and a page reload are required.
- **Paste** a magnet or HTTP(S) torrent URL into the toolbar popup. Transmission fetches pasted URLs itself, without Safari's website login.
- **Click capture** (optional) handles magnet links and links whose path ends in `.torrent`, have a torrent `download` attribute, or carry a `.torrent` filename in a `file`, `filename`, or `download` query parameter. Modified clicks (⌘, ⇧, ⌥, ⌃) keep their normal behavior. Check **Don't show this page again** on the send page to send captured clicks immediately with your saved defaults.

Download directories are absolute paths **on the server**. Leave the field empty to use Transmission's default. This is not a Mac folder picker; Transmission RPC has no server filesystem browser. Up to ten successful directories are remembered. Adding a duplicate torrent never moves the existing one.

After sending, a notification appears at the top of the page: success notices close after 10 seconds, errors stay until dismissed. The toolbar badge shows OK or ! and clears when you open the popup or after 30 seconds.

Settings are device-local, shared across this extension's Safari profiles, and not synced to iCloud. Pending links expire after 24 hours. Local file upload, torrent search, multiple server profiles, and torrent management are out of scope.

## Privacy and security

- The native handler accepts only settings, connection-test, and add commands. It never logs messages, passwords, or links.
- RPC redirects are rejected so credentials can't be forwarded to another endpoint.
- The extension talks only to the server you configure and, for right-click sends, to the website hosting the link.

## Development

```sh
bash scripts/test.sh     # JavaScript link validation + Swift RPC tests with a mocked transport
node tests/ui.cjs        # optional browser UI tests (Playwright + Chromium)
node tests/click.cjs     # optional click-capture tests (Playwright + Chromium)
```

The Swift tests cover the session-token handshake, bounded retries, authentication, directory and paused arguments, duplicates, HTTP/RPC errors, URL validation, and IPv6. UI tests use a mock native bridge, so they don't exercise Safari native messaging or the Keychain. Set `PLAYWRIGHT_PATH` if Playwright is not on Node's module path.

Source layout:

- `Extension/`: manifest, background routing, click capture, popup/settings UI, and icons.
- `macOS/Send to Transmission/`: Xcode project, host app, native RPC/Keychain handler.
- `Config/`: shared build settings (`Base.xcconfig`) and your gitignored signing overlay.
- `scripts/`: configure, build, test, and icon generation.
- `tests/`: Swift transport tests, JavaScript validation, and mock browser UI checks.
- `docs/`: [building from source](docs/BUILDING.md) and [releasing](docs/RELEASING.md).

## License

[MIT](LICENSE)
