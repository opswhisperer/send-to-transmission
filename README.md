# Send to Transmission

A macOS Safari extension that sends magnet links and torrent URLs to your own [Transmission](https://transmissionbt.com) server. It is a single app with a native RPC handler: there is no separate daemon or helper to install.

- Right-click a link → **Send to Transmission**, paste a link into the toolbar popup, or optionally capture normal clicks on magnet and torrent links.
- The app can also be your Mac's magnet link handler, so magnet links from private windows, other browsers and other apps go to the same server. It opens `.torrent` files too.
- Choose a download directory on the server, reuse recent directories, and add torrents paused.
- HTTP or HTTPS, custom port and RPC path, optional login with the password stored in the macOS Keychain.
- Same-site torrent downloads that need a website login are fetched with Safari's session; website cookies are never sent to Transmission.

Requires macOS 12 or later, Safari 15.4 or later, and a reachable Transmission 3.x or 4.x server with RPC enabled.

## Install

There is no prebuilt download: you build the app from source. **An Apple Developer account is required to build it.** Here is why:

- The app can open magnet links and `.torrent` files itself, so links the Safari extension never sees still reach your server. To do that it needs the server address and RPC password you saved in the extension.
- macOS keeps a sandboxed app and its extension apart. The only supported ways to share between them are an app group (the settings) and a Keychain access group (the password).
- macOS grants both only to builds signed with a development team. An ad-hoc ("Sign to Run Locally") build that claims a Keychain access group is killed at launch, and ad-hoc builds cannot read or write an app group at all.

So a build without a team either will not start or cannot share anything, and there is no unsigned variant.

Full instructions are in [docs/BUILDING.md](docs/BUILDING.md). The short version:

```sh
scripts/configure.sh --bundle-prefix com.yourname   # finds the team from your Apple Development certificate
bash scripts/build.sh /Applications                # or omit to build into the repo folder
```

Open **Send to Transmission.app** once, then enable **Send to Transmission** in Safari → Settings → Extensions, and grant website access for sites where you want link capture to work. To catch magnet links outside Safari, choose **Open magnet links with Send to Transmission** in the app.

## Configure

Open the extension's toolbar popup → **Settings**:

- Server hostname, IP, or full HTTP(S) URL. A pasted URL sets the host, HTTPS toggle and port; a non-root URL path also sets the RPC path. IPv4 and IPv6 are accepted.
- Port: normally 9091 for HTTP, or 443 behind an HTTPS proxy.
- **Use SSL / HTTPS**; uncheck for plain HTTP.
- RPC path, normally `/transmission/rpc`.
- Optional username and password. The password stays in the macOS Keychain and is never returned to browser scripts. Leaving it blank keeps an existing password for the same endpoint and account. Disabling login deletes it; changing the endpoint or account requires entering it again.
- Default download directory, **Choose a directory before sending links**, and **Add paused by default**.
- Optional interception of normal clicks on magnet and recognizable torrent links. It applies as soon as you tick it. Over a web page, the toolbar popup says whether capture is on and working there, and offers to turn it on, allow website access, or reload the page.

**Save & test connection** confirms access and shows the server version and its default directory.

HTTPS uses normal macOS trust evaluation: a self-signed certificate must be trusted by macOS and valid for the hostname. There is no certificate-validation bypass. Plain HTTP is allowed because the endpoint is user-configurable; credentials sent over HTTP are not encrypted in transit.

## Send links

- **Right-click** a link → **Send to Transmission**. The send page always opens so you can review the directory and paused options. For same-site torrent links, the extension fetches the torrent with your Safari session, so the URL doesn't need a `.torrent` suffix. It sends the torrent contents, not your cookies, to Transmission. Redirects, cross-origin links, responses without torrent or generic binary headers, and files over 2 MB are rejected. Website access and a page reload are required.
- **Paste** a magnet or HTTP(S) torrent URL into the toolbar popup. Transmission fetches pasted URLs itself, without Safari's website login.
- **Click capture** (optional) handles magnet links and links whose path ends in `.torrent`, have a torrent `download` attribute, or carry a `.torrent` filename in a `file`, `filename`, or `download` query parameter. A link on the same website that describes itself as a torrent download is also tried: it is fetched with your Safari session and sent if the reply really is a torrent, otherwise the click proceeds as usual. A `.torrent` link from another website to an address on a private network always opens the send page first. Modified clicks (⌘, ⇧, ⌥, ⌃) keep their normal behavior. Check **Don't show this page again** on the send page to send captured clicks immediately with your saved defaults.
- **Everywhere else**, the app handles it. A content script only runs where Safari allows it, and never sees links opened by page scripts, private windows without permission, or other apps; those go to whichever app macOS has registered for `magnet:`. Open the app and choose **Open magnet links with Send to Transmission** to make it that app. It also opens `.torrent` files from the Finder's Open With menu, and uses the server and defaults saved in the extension.

Download directories are absolute paths **on the server**. Leave the field empty to use Transmission's default. This is not a Mac folder picker; Transmission RPC has no server filesystem browser. Up to ten successful directories are remembered. Adding a duplicate torrent never moves the existing one.

A notification appears at the top of the page as soon as you click a captured link, and updates when the send finishes: success notices close after 10 seconds, errors stay until dismissed. The toolbar badge shows OK or ! and clears when you open the popup or after 30 seconds.

Settings, including click capture, are device-local, shared by the app and every Safari profile, and not synced to iCloud. Pending links expire after 24 hours. Local file upload, torrent search, multiple server profiles, and torrent management are out of scope.

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

The Swift tests cover the session-token handshake, bounded retries, the 40-second time budget, authentication, directory and paused arguments, duplicates, HTTP/RPC errors, URL validation, settings decoding, and IPv6. UI tests use a mock native bridge, so they don't exercise Safari native messaging or the Keychain. Set `PLAYWRIGHT_PATH` if Playwright is not on Node's module path.

Source layout:

- `Extension/`: manifest, background routing, click capture, popup/settings UI, and icons.
- `macOS/Send to Transmission/`: Xcode project; the app (extension status, magnet / `.torrent` handler); `Shared/TransmissionService.swift`, the RPC client, settings and Keychain code compiled into both the app and the extension.
- `Config/`: shared build settings (`Base.xcconfig`) and your gitignored signing overlay.
- `scripts/`: configure, build, test, and icon generation.
- `tests/`: Swift transport tests, JavaScript validation, and mock browser UI checks.
- `docs/`: [building from source](docs/BUILDING.md) and [releasing](docs/RELEASING.md).

## License

[MIT](LICENSE)
