import Cocoa

@main
@MainActor
class AppDelegate: NSObject, NSApplicationDelegate {

    /// Links macOS delivered before the window was ready to show them.
    private var pending: [URL] = []
    private var finishedLaunching = false
    private var launchWasPlain = true
    private var receivedLinks = false
    /// True when macOS started the app only to open a link, so it can quit once the link is sent.
    private(set) var launchedForLinks = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        finishedLaunching = true
        launchWasPlain = notification.userInfo?[NSApplication.launchIsDefaultUserInfoKey] as? Bool ?? true
    }

    // Magnet links and .torrent files, from Safari or any other app.
    func application(_ application: NSApplication, open urls: [URL]) {
        // AppKit may deliver the launching link before or just after the app finishes launching.
        if !finishedLaunching || (!launchWasPlain && !receivedLinks) { launchedForLinks = true }
        receivedLinks = true
        pending += urls
        for window in application.windows {
            (window.contentViewController as? ViewController)?.drain()
        }
    }

    func takePending() -> [URL] {
        defer { pending = [] }
        return pending
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return true
    }

}
