import Cocoa
import SafariServices
import WebKit

let extensionBundleIdentifier = Bundle.main.bundleIdentifier! + ".Extension"

/// One magnet link or .torrent file handed to the app by macOS.
struct IncomingLink {
    var link = ""           // empty for a local file
    var metainfo: String?   // base64 contents of a .torrent file
    var name: String
    var problem: String?

    init(_ url: URL) {
        guard url.isFileURL else {
            link = url.absoluteString
            let label = URLComponents(string: link)?.queryItems?.first { $0.name == "dn" }?.value?.replacingOccurrences(of: "+", with: " ")
            name = label?.isEmpty == false ? label! : "Magnet link"
            return
        }
        name = url.lastPathComponent
        do {
            let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
            guard size > 0, size <= 2 * 1024 * 1024 else { throw ExtensionFailure("This is not a torrent file of 2 MB or less.") }
            metainfo = try Data(contentsOf: url).base64EncodedString()
        } catch { problem = error.localizedDescription }
    }
}

@MainActor
class ViewController: NSViewController, WKNavigationDelegate, WKScriptMessageHandler {

    @IBOutlet var webView: WKWebView!

    private var pageReady = false
    private var queue: [IncomingLink] = []
    private var current: IncomingLink?
    private var failed: IncomingLink?
    private var failures = 0
    private var quit: DispatchWorkItem?
    private var appDelegate: AppDelegate? { NSApp.delegate as? AppDelegate }

    override func viewDidLoad() {
        super.viewDidLoad()

        self.webView.navigationDelegate = self

        self.webView.configuration.userContentController.add(self, name: "controller")

        self.webView.loadFileURL(Bundle.main.url(forResource: "Main", withExtension: "html")!, allowingReadAccessTo: Bundle.main.resourceURL!)

        // The magnet link app is changed outside this app (scripts/magnet-handler.sh), so look again on return.
        NotificationCenter.default.addObserver(forName: NSApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.page("handler", self?.handlerState() ?? [:]) }
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        pageReady = true
        page("handler", handlerState())
        SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier: extensionBundleIdentifier) { state, error in
            let enabled: Any = error == nil ? state?.isEnabled ?? NSNull() : NSNull()
            DispatchQueue.main.async {
                var modern = false
                if #available(macOS 13, *) { modern = true }
                self.page("extension", ["enabled": enabled, "modern": modern])
            }
        }
        drain()
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let action = body["action"] as? String else { return }
        switch action {
        case "open-preferences":
            SFSafariApplication.showPreferencesForExtension(withIdentifier: extensionBundleIdentifier) { error in
                DispatchQueue.main.async {
                    NSApplication.shared.terminate(nil)
                }
            }
        case "send":
            guard let item = current else { return }
            Task { await send(item, options: body) }
        case "retry":
            guard current == nil, let item = failed else { return }
            failed = nil; failures -= 1
            queue.insert(item, at: 0)
            next()
        case "skip", "cancel", "done":
            current = nil; failed = nil
            if !queue.isEmpty { next() }
            else if action == "cancel", appDelegate?.launchedForLinks == true, failures == 0 { NSApp.terminate(nil) }
            else { page("idle") }
        default: break
        }
    }

    /// Picks up whatever macOS has handed to the app delegate.
    func drain() {
        guard pageReady, let urls = appDelegate?.takePending(), !urls.isEmpty else { return }
        queue += urls.map(IncomingLink.init)
        view.window?.makeKeyAndOrderFront(nil)
        next()
    }

    private func next() {
        guard current == nil, !queue.isEmpty else { return }
        quit?.cancel()
        let item = queue.removeFirst()
        current = item; failed = nil
        page("begin", ["name": item.name, "remaining": queue.count])
        if let problem = item.problem { return finish(problem, failed: true) }
        Task {
            do {
                let settings = try await TransmissionService.shared.handle(["action": "getSettings"])["settings"] as? [String: Any] ?? [:]
                guard settings["host"] as? String ?? "" != "" else {
                    throw ExtensionFailure("Set up your Transmission server first: in Safari, click the Send to Transmission toolbar button and open Settings.")
                }
                if settings["askDirectory"] as? Bool ?? true {
                    page("review", ["directory": settings["directory"] ?? "", "paused": settings["paused"] ?? false, "recent": settings["recentDirectories"] ?? [String]()])
                } else { await send(item, options: [:]) }
            } catch { finish(error.localizedDescription, failed: true) }
        }
    }

    private func send(_ item: IncomingLink, options: [String: Any]) async {
        page("status", ["text": "Sending…"])
        var message: [String: Any] = ["action": "add", "link": item.link]
        if let metainfo = item.metainfo { message["metainfo"] = metainfo }
        if let directory = options["directory"] as? String { message["directory"] = directory }
        if let paused = options["paused"] as? Bool { message["paused"] = paused }
        do {
            let reply = try await TransmissionService.shared.handle(message)
            if options["remember"] as? Bool == true {
                _ = try? await TransmissionService.shared.handle(["action": "saveSettings", "settings": ["askDirectory": false]])
            }
            finish(reply["text"] as? String ?? "Sent to Transmission.", failed: false)
        } catch { finish(error.localizedDescription, failed: true) }
    }

    private func finish(_ text: String, failed didFail: Bool) {
        if didFail { failures += 1; failed = current }
        current = nil
        // A launch that only existed to send links ends itself; anything that failed stays on screen.
        let closing = !didFail && queue.isEmpty && failures == 0 && appDelegate?.launchedForLinks == true
        page("result", ["text": text, "failed": didFail, "remaining": queue.count, "closing": closing])
        if closing {
            let work = DispatchWorkItem { NSApp.terminate(nil) }
            quit = work
            DispatchQueue.main.asyncAfter(deadline: .now() + 4, execute: work)
        } else if !didFail && !queue.isEmpty {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { self.next() }
        }
    }

    private func handlerState() -> [String: Any] {
        guard let probe = URL(string: "magnet:?xt=urn:btih:0000000000000000000000000000000000000000"),
              let app = NSWorkspace.shared.urlForApplication(toOpen: probe) else { return ["isDefault": false, "current": ""] }
        // Compare identifiers, not paths: development builds can exist in several places.
        return ["isDefault": Bundle(url: app)?.bundleIdentifier == Bundle.main.bundleIdentifier,
                "current": FileManager.default.displayName(atPath: app.path)]
    }

    private func page(_ event: String, _ payload: [String: Any] = [:]) {
        guard pageReady, let data = try? JSONSerialization.data(withJSONObject: ["event": event, "payload": payload]),
              let json = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("receive(\(json))")
    }

}
