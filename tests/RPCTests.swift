import Foundation

final class MockRPC: URLProtocol, @unchecked Sendable {
    static var handler: ((URLRequest) throws -> (Int, [String: String], [String: Any]))!
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            let (status, headers, body) = try Self.handler(request)
            let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: headers)!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: try JSONSerialization.data(withJSONObject: body))
            client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}
func expect(_ condition: @autoclosure () -> Bool, _ message: String) throws {
    if !condition() { throw ExtensionFailure("TEST FAILED: " + message) }
}
func body(_ request: URLRequest) throws -> [String: Any] {
    if let data = request.httpBody { return try JSONSerialization.jsonObject(with: data) as! [String: Any] }
    guard let stream = request.httpBodyStream else { throw ExtensionFailure("Missing request body") }
    stream.open(); defer { stream.close() }
    var data = Data(); var buffer = [UInt8](repeating: 0, count: 4096)
    while stream.hasBytesAvailable { let count = stream.read(&buffer, maxLength: buffer.count); if count <= 0 { break }; data.append(contentsOf: buffer.prefix(count)) }
    return try JSONSerialization.jsonObject(with: data) as! [String: Any]
}
@main struct Tests {
    static func main() async throws {
        var settings = ServerSettings(); settings.host = "127.0.0.1"
        if CommandLine.arguments.contains("--live") {
            settings.host = "transmission.example.com"; settings.port = 443; settings.ssl = true
            let response = try await TransmissionClient(settings: settings, password: nil).rpc("session-get", arguments: ["fields": ["version", "rpc-version", "download-dir"]])
            print("Live native RPC:", response)
            return
        }
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [MockRPC.self]
        func client(_ value: ServerSettings = settings, password: String? = nil) -> TransmissionClient {
            TransmissionClient(settings: value, password: password, session: URLSession(configuration: config))
        }
        let magnet = "magnet:?xt=urn:btih:0123456789012345678901234567890123456789&dn=Example%20Linux&tr=https%3A%2F%2Fexample.com"
        var calls = 0
        MockRPC.handler = { request in
            calls += 1
            let payload = try body(request)
            try expect(payload["method"] as? String == "torrent-add", "RPC method")
            let args = payload["arguments"] as! [String: Any]
            try expect(args["filename"] as? String == magnet, "magnet parameters preserved")
            try expect(args["download-dir"] as? String == "/downloads/linux", "server path forwarded")
            try expect(args["paused"] as? Bool == true, "paused forwarded")
            try expect(request.value(forHTTPHeaderField: "Authorization") == nil, "no auth when disabled")
            if calls == 1 { return (409, ["X-Transmission-Session-Id": "test-token"], [:]) }
            try expect(request.value(forHTTPHeaderField: "X-Transmission-Session-Id") == "test-token", "409 token retry")
            return (200, [:], ["result": "success", "arguments": ["torrent-added": ["name": "Example Linux"]]])
        }
        let added = try await client().add(link: magnet, directory: "/downloads/linux", paused: true)
        try expect(added == "Added paused: Example Linux" && calls == 2, "successful add after handshake")
        MockRPC.handler = { request in
            let args = try body(request)["arguments"] as! [String: Any]
            try expect(args["download-dir"] == nil, "empty directory uses server default")
            return (200, [:], ["result": "success", "arguments": ["torrent-duplicate": ["name": "Linux"]]])
        }
        let duplicate = try await client().add(link: "https://example.com/file.torrent?token=abc", directory: "", paused: false)
        try expect(duplicate.contains("Already in Transmission"), "duplicate message")
        let metainfo = Data("d4:infod6:lengthi0e4:name4:demo12:piece lengthi16384e6:pieces0:ee".utf8).base64EncodedString()
        MockRPC.handler = { request in
            let args = try body(request)["arguments"] as! [String: Any]
            try expect(args["metainfo"] as? String == metainfo && args["filename"] == nil, "metainfo replaces URL")
            try expect(request.value(forHTTPHeaderField: "Cookie") == nil, "no website cookies")
            return (200, [:], ["result": "success", "arguments": ["torrent-added": ["name": "demo"]]])
        }
        _ = try await client().add(link: "https://example.com/download", directory: "/downloads", paused: true, metainfo: metainfo)
        for invalid in ["<html>login</html>", "de", "d4:info3:bade", "d4:infodeejunk", "d4:infod4:name99:xe"] {
            do { try TransmissionClient.validateMetainfo(Data(invalid.utf8).base64EncodedString()); throw ExtensionFailure("Unexpected success") }
            catch { try expect(!error.localizedDescription.contains("Unexpected success"), "invalid metainfo rejected") }
        }
        var authenticated = settings; authenticated.auth = true; authenticated.username = "test"
        MockRPC.handler = { request in
            try expect(request.value(forHTTPHeaderField: "Authorization") == "Basic dGVzdDpwYXNz", "basic auth encoding")
            return (401, [:], [:])
        }
        do { _ = try await client(authenticated, password: "pass").rpc("session-get"); throw ExtensionFailure("Expected 401") }
        catch { try expect(error.localizedDescription.contains("Login rejected"), "401 error") }
        calls = 0
        MockRPC.handler = { _ in calls += 1; return (409, ["X-Transmission-Session-Id": "new"], [:]) }
        do { _ = try await client().rpc("session-get"); throw ExtensionFailure("Expected session rejection") }
        catch { try expect(calls == 3, "retry bounded to three requests") }
        for code in [403, 421, 302, 500] {
            MockRPC.handler = { _ in (code, [:], [:]) }
            do { _ = try await client().rpc("session-get"); throw ExtensionFailure("Unexpected success") }
            catch { try expect(!error.localizedDescription.contains("Unexpected success"), "HTTP failure \(code)") }
        }
        MockRPC.handler = { _ in (200, [:], ["result": "permission denied"]) }
        do { _ = try await client().rpc("torrent-add"); throw ExtensionFailure("Unexpected success") }
        catch { try expect(error.localizedDescription.contains("permission denied"), "RPC failure") }
        for invalid in ["file:///tmp/file.torrent", "javascript:alert(1)", "magnet:?dn=test", "https://user:pass@example.com/a"] {
            do { try TransmissionClient.validateLink(invalid); throw ExtensionFailure("Unexpected success") }
            catch { try expect(!error.localizedDescription.contains("Unexpected success"), "invalid link rejected") }
        }
        for directory in ["/downloads/test", "C:\\Downloads", ""] { try ServerSettings.validateDirectory(directory) }
        do { try ServerSettings.validateDirectory("relative/path"); throw ExtensionFailure("Unexpected success") }
        catch { try expect(!error.localizedDescription.contains("Unexpected success"), "relative server path rejected") }
        settings.host = "https://example.com"
        do { try settings.validate(); throw ExtensionFailure("Unexpected success") }
        catch { try expect(!error.localizedDescription.contains("Unexpected success"), "scheme in hostname rejected") }
        settings.host = "::1"
        let endpoint = try settings.endpoint
        try expect(endpoint.absoluteString == "http://[::1]:9091/transmission/rpc", "IPv6 endpoint")
        print("PASS: native RPC handshake, add, duplicate, directory, auth, errors, bounded retry, validation, IPv6")
    }
}
