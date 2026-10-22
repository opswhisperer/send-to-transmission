import Foundation
import SafariServices
import Security

struct ExtensionFailure: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}

struct ServerSettings: Codable {
    var host = ""
    var port = 9091
    var ssl = false
    var path = "/transmission/rpc"
    var auth = false
    var username = ""
    var directory = ""
    var askDirectory = true
    var paused = false
    var recentDirectories: [String] = []

    var endpoint: URL {
        get throws {
            guard !host.isEmpty, !host.contains(where: { $0.isWhitespace }),
                  !host.contains("/"), !host.contains("@"), !host.contains("?"), !host.contains("#"),
                  (1...65535).contains(port), path.hasPrefix("/"),
                  !path.contains("?"), !path.contains("#") else {
                throw ExtensionFailure("Enter a server hostname or IP, a port from 1–65535, and an RPC path beginning with /.")
            }
            var parts = URLComponents()
            parts.scheme = ssl ? "https" : "http"
            parts.host = host.contains(":") && !host.hasPrefix("[") ? "[\(host)]" : host
            parts.port = port
            parts.path = path
            guard let url = parts.url, url.host != nil else { throw ExtensionFailure("The server address is invalid. Enter the host without a scheme or port.") }
            return url
        }
    }
    func validate() throws {
        _ = try endpoint
        try Self.validateDirectory(directory)
        if auth && (username.isEmpty || username.contains(":")) { throw ExtensionFailure("Enter a username without a colon.") }
    }
    static func validateDirectory(_ value: String) throws {
        guard !value.contains(where: { $0.isNewline || $0 == "\0" }), value.utf8.count <= 4096 else {
            throw ExtensionFailure("The download directory is invalid.")
        }
        guard value.isEmpty || value.hasPrefix("/") || value.range(of: #"^[A-Za-z]:[\\/]"#, options: .regularExpression) != nil || value.hasPrefix("\\\\") else {
            throw ExtensionFailure("Use an absolute path on the Transmission server, or leave it empty for the server default.")
        }
    }
    var dictionary: [String: Any] {
        (try? JSONSerialization.jsonObject(with: JSONEncoder().encode(self))) as? [String: Any] ?? [:]
    }
}

enum PasswordStore {
    // Set from TRANSMISSION_KEYCHAIN_SERVICE in Config/Base.xcconfig (or the local overlay).
    private static let service = Bundle.main.object(forInfoDictionaryKey: "TransmissionKeychainService") as? String ?? "SendToTransmission.rpc"
    private static var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: "server"]
    }
    static func read() throws -> String? {
        var q = query
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(q as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else { throw ExtensionFailure("Could not read the password from Keychain (\(status)).") }
        return String(data: data, encoding: .utf8)
    }
    static func write(_ password: String?) throws {
        guard let password else {
            let status = SecItemDelete(query as CFDictionary)
            guard status == errSecSuccess || status == errSecItemNotFound else { throw ExtensionFailure("Could not remove the saved password (\(status)).") }
            return
        }
        let values = [kSecValueData as String: Data(password.utf8)]
        var status = SecItemUpdate(query as CFDictionary, values as CFDictionary)
        if status == errSecItemNotFound {
            var q = query.merging(values) { _, new in new }
            q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            status = SecItemAdd(q as CFDictionary, nil)
        }
        guard status == errSecSuccess else { throw ExtensionFailure("Could not save the password in Keychain (\(status)).") }
    }
}

// Never forward RPC credentials to a redirect target. Users configure the final endpoint.
final class NoRedirect: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

final class TransmissionClient {
    let settings: ServerSettings
    let password: String?
    let session: URLSession
    private var sessionID: String?
    init(settings: ServerSettings, password: String?, session: URLSession? = nil) {
        self.settings = settings; self.password = password
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 20
        config.timeoutIntervalForResource = 30
        config.httpShouldSetCookies = false
        config.urlCredentialStorage = nil
        self.session = session ?? URLSession(configuration: config, delegate: NoRedirect(), delegateQueue: nil)
    }
    deinit { session.invalidateAndCancel() }

    func rpc(_ method: String, arguments: [String: Any] = [:]) async throws -> [String: Any] {
        for attempt in 0..<3 {
            var request = URLRequest(url: try settings.endpoint)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            if let sessionID { request.setValue(sessionID, forHTTPHeaderField: "X-Transmission-Session-Id") }
            if settings.auth {
                request.setValue("Basic " + Data("\(settings.username):\(password ?? "")".utf8).base64EncodedString(), forHTTPHeaderField: "Authorization")
            }
            request.httpBody = try JSONSerialization.data(withJSONObject: ["method": method, "arguments": arguments, "tag": 1])
            let data: Data
            let response: URLResponse
            do { (data, response) = try await session.data(for: request) }
            catch {
                throw ExtensionFailure("Could not reach Transmission: \(error.localizedDescription) Check the address, port, local-network permission, and TLS certificate. An interrupted add may already have succeeded; retrying will report a duplicate.")
            }
            guard let http = response as? HTTPURLResponse else { throw ExtensionFailure("The server did not return an HTTP response.") }
            if http.statusCode == 409, let token = http.value(forHTTPHeaderField: "X-Transmission-Session-Id"), attempt < 2 {
                sessionID = token; continue
            }
            switch http.statusCode {
            case 200: break
            case 401: throw ExtensionFailure("Login rejected. Check the username and password.")
            case 403: throw ExtensionFailure("Access denied. Check Transmission’s RPC IP allowlist and local-network access.")
            case 409: throw ExtensionFailure("Transmission kept rejecting its session token. Try the connection test again.")
            case 421: throw ExtensionFailure("Transmission rejected the hostname. Check its RPC host allowlist.")
            case 300..<400: throw ExtensionFailure("The RPC address redirects. Set the final address and path in Settings.")
            default: throw ExtensionFailure("Transmission returned HTTP \(http.statusCode). Check the RPC path and server configuration.")
            }
            guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let result = json["result"] as? String else {
                throw ExtensionFailure("The response is not a supported Transmission RPC response. Check the RPC path and server version.")
            }
            guard result == "success" else { throw ExtensionFailure("Transmission: \(result)") }
            return json["arguments"] as? [String: Any] ?? [:]
        }
        throw ExtensionFailure("Could not establish a Transmission session.")
    }
    static func validateLink(_ link: String) throws {
        guard link.utf8.count <= 65536, let parts = URLComponents(string: link), let scheme = parts.scheme?.lowercased() else {
            throw ExtensionFailure("Enter a valid magnet link or torrent URL.")
        }
        if scheme == "magnet" {
            guard parts.queryItems?.contains(where: { $0.name == "xt" && $0.value?.range(of: #"^urn:(btih|btmh):.+$"#, options: [.regularExpression, .caseInsensitive]) != nil }) == true else {
                throw ExtensionFailure("The magnet link is missing its torrent identifier.")
            }
        } else {
            guard ["http", "https"].contains(scheme), parts.host?.isEmpty == false, parts.user == nil, parts.password == nil else {
                throw ExtensionFailure("Use an HTTP(S) torrent URL without embedded login details, or a magnet link.")
            }
        }
    }
    static func validateMetainfo(_ encoded: String) throws {
        guard encoded.utf8.count <= 2796204, let data = Data(base64Encoded: encoded),
              !data.isEmpty, data.count <= 2 * 1024 * 1024 else { throw ExtensionFailure("Invalid torrent file size or encoding.") }
        let bytes = Array(data)
        var index = 0
        var hasInfo = false
        func invalid() -> ExtensionFailure { ExtensionFailure("The downloaded file is not valid torrent metainfo.") }
        func string() throws -> String {
            let start = index
            while index < bytes.count && bytes[index] >= 48 && bytes[index] <= 57 { index += 1 }
            guard index > start, index < bytes.count, bytes[index] == 58,
                  let length = Int(String(decoding: bytes[start..<index], as: UTF8.self)),
                  length <= bytes.count - index - 1 else { throw invalid() }
            index += 1
            let value = String(decoding: bytes[index..<index+length], as: UTF8.self)
            index += length
            return value
        }
        func value(_ depth: Int) throws {
            guard depth < 64, index < bytes.count else { throw invalid() }
            let kind = bytes[index]
            if kind >= 48 && kind <= 57 { _ = try string(); return }
            index += 1
            if kind == 105 {
                let start = index
                while index < bytes.count && bytes[index] != 101 { index += 1 }
                guard index < bytes.count, Int64(String(decoding: bytes[start..<index], as: UTF8.self)) != nil else { throw invalid() }
                index += 1; return
            }
            guard kind == 100 || kind == 108 else { throw invalid() }
            while index < bytes.count && bytes[index] != 101 {
                if kind == 100 {
                    let key = try string()
                    if depth == 0 && key == "info" {
                        guard !hasInfo, index < bytes.count, bytes[index] == 100 else { throw invalid() }
                        hasInfo = true
                    }
                }
                try value(depth + 1)
            }
            guard index < bytes.count else { throw invalid() }
            index += 1
        }
        guard bytes.first == 100 else { throw invalid() }
        try value(0)
        guard index == bytes.count, hasInfo else { throw invalid() }
    }
    func add(link: String, directory: String, paused: Bool, metainfo: String? = nil) async throws -> String {
        try Self.validateLink(link)
        try ServerSettings.validateDirectory(directory)
        var args: [String: Any] = ["paused": paused]
        if let metainfo {
            try Self.validateMetainfo(metainfo)
            args["metainfo"] = metainfo
        } else { args["filename"] = link }
        if !directory.isEmpty { args["download-dir"] = directory }
        let response = try await rpc("torrent-add", arguments: args)
        if let torrent = response["torrent-duplicate"] as? [String: Any] {
            return "Already in Transmission: \(torrent["name"] as? String ?? "torrent"). Its existing directory was kept."
        }
        guard let torrent = response["torrent-added"] as? [String: Any] else { throw ExtensionFailure("Transmission did not confirm that the torrent was added.") }
        return "Added\(paused ? " paused" : ""): \(torrent["name"] as? String ?? "torrent")"
    }
}

actor ExtensionService {
    static let shared = ExtensionService()
    private var settings: ServerSettings {
        get {
            guard let data = UserDefaults.standard.data(forKey: "serverSettings"), let value = try? JSONDecoder().decode(ServerSettings.self, from: data) else { return ServerSettings() }
            return value
        }
        set { UserDefaults.standard.set(try? JSONEncoder().encode(newValue), forKey: "serverSettings") }
    }
    func handle(_ message: [String: Any]) async throws -> [String: Any] {
        switch message["action"] as? String {
        case "getSettings":
            return ["ok": true, "settings": settings.dictionary, "hasPassword": try PasswordStore.read() != nil]
        case "saveSettings":
            guard let input = message["settings"] as? [String: Any] else { throw ExtensionFailure("Missing settings.") }
            var merged = settings.dictionary
            for key in ["host", "port", "ssl", "path", "auth", "username", "directory", "askDirectory", "paused"] {
                if let value = input[key] { merged[key] = value }
            }
            let updated = try JSONDecoder().decode(ServerSettings.self, from: JSONSerialization.data(withJSONObject: merged))
            try updated.validate()
            let password = message["password"] as? String ?? ""
            if !updated.auth { try PasswordStore.write(nil) }
            else if !password.isEmpty { try PasswordStore.write(password) }
            else if settings.host != updated.host || settings.port != updated.port || settings.ssl != updated.ssl || settings.path != updated.path || settings.username != updated.username {
                // Saved credentials must not silently move to another endpoint/account.
                try PasswordStore.write("")
            }
            settings = updated
            return ["ok": true, "settings": updated.dictionary, "hasPassword": try PasswordStore.read() != nil]
        case "test", "add":
            let snapshot = settings
            try snapshot.validate()
            let client = TransmissionClient(settings: snapshot, password: snapshot.auth ? try PasswordStore.read() : nil)
            if message["action"] as? String == "test" {
                let response = try await client.rpc("session-get")
                guard let version = response["version"] as? String, let rpcVersion = response["rpc-version"] as? Int, rpcVersion >= 15 else {
                    throw ExtensionFailure("This extension requires Transmission 3.00 or later with the legacy RPC API enabled.")
                }
                let directory = response["download-dir"] as? String ?? "unknown"
                return ["ok": true, "text": "Connected to Transmission \(version).\nServer default directory: \(directory)"]
            }
            guard let link = message["link"] as? String else { throw ExtensionFailure("Missing torrent link.") }
            if message["metainfo"] != nil && !(message["metainfo"] is String) { throw ExtensionFailure("Invalid torrent data.") }
            let directory = message["directory"] as? String ?? snapshot.directory
            let text = try await client.add(link: link, directory: directory, paused: message["paused"] as? Bool ?? snapshot.paused, metainfo: message["metainfo"] as? String)
            if !directory.isEmpty {
                var current = settings
                if current.host == snapshot.host && current.port == snapshot.port && current.path == snapshot.path && current.ssl == snapshot.ssl {
                    current.recentDirectories = Array(([directory] + current.recentDirectories.filter { $0 != directory }).prefix(10))
                    settings = current
                }
            }
            return ["ok": true, "text": text]
        default: throw ExtensionFailure("Unknown extension command.")
        }
    }
}

#if !RPC_TESTING
class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    func beginRequest(with context: NSExtensionContext) {
        let item = context.inputItems.first as? NSExtensionItem
        let message = item?.userInfo?[SFExtensionMessageKey] as? [String: Any] ?? [:]
        Task {
            let reply: [String: Any]
            do { reply = try await ExtensionService.shared.handle(message) }
            catch { reply = ["ok": false, "error": error.localizedDescription] }
            let response = NSExtensionItem()
            response.userInfo = [SFExtensionMessageKey: reply]
            context.completeRequest(returningItems: [response], completionHandler: nil)
        }
    }
}
#endif
