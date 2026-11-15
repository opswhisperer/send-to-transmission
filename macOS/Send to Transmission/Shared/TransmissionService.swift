import Foundation
import Security

// Compiled into both the app (magnet / .torrent handler) and the Safari extension.

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
    /// Click capture. Nil until chosen, so the extension can adopt the value older versions kept in Safari storage.
    var intercept: Bool?

    init() {}
    // Saved settings must survive new fields: a missing key keeps its default instead of failing the decode.
    init(from decoder: Decoder) throws {
        self.init()
        let values = try decoder.container(keyedBy: CodingKeys.self)
        func read<T: Decodable>(_ key: CodingKeys, _ value: inout T) throws {
            if let stored = try values.decodeIfPresent(T.self, forKey: key) { value = stored }
        }
        try read(.host, &host); try read(.port, &port); try read(.ssl, &ssl); try read(.path, &path)
        try read(.auth, &auth); try read(.username, &username); try read(.directory, &directory)
        try read(.askDirectory, &askDirectory); try read(.paused, &paused); try read(.recentDirectories, &recentDirectories)
        intercept = try values.decodeIfPresent(Bool.self, forKey: .intercept)
    }

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

/// Storage both targets can reach: the app group for settings, a shared Keychain group for the password.
enum SharedStore {
    static let settingsKey = "serverSettings"
    private static func entitlement(_ name: String) -> [String] {
        #if RPC_TESTING
        return []
        #else
        guard let task = SecTaskCreateFromSelf(nil) else { return [] }
        return SecTaskCopyValueForEntitlement(task, name as CFString, nil) as? [String] ?? []
        #endif
    }
    static let appGroup = entitlement("com.apple.security.application-groups").first
    static let keychainGroup = entitlement("keychain-access-groups").first
    /// Falls back to this process's own defaults in builds signed without the app group (the command-line tests).
    static let defaults: UserDefaults = appGroup.flatMap { UserDefaults(suiteName: $0) } ?? .standard
    static var isExtension: Bool { Bundle.main.bundleURL.pathExtension == "appex" }

    /// Versions before 1.1 kept everything inside the extension's own container, which the app cannot read.
    /// Only the extension can move it: the old password item belongs to it, and the app would be prompted.
    static let migrated: Void = {
        guard isExtension, appGroup != nil else { return }
        if defaults.data(forKey: settingsKey) == nil, let old = UserDefaults.standard.data(forKey: settingsKey) {
            defaults.set(old, forKey: settingsKey)
            UserDefaults.standard.removeObject(forKey: settingsKey)
        }
        PasswordStore.adoptLegacyItem()
    }()
}

enum PasswordStore {
    // Both names come from Config/Base.xcconfig (or the local overlay) through Info.plist.
    private static func setting(_ key: String) -> String? {
        let value = Bundle.main.object(forInfoDictionaryKey: key) as? String
        return value?.isEmpty == false ? value : nil
    }
    private static let service = setting("TransmissionKeychainService") ?? "SendToTransmission.rpc"
    /// The item an earlier build kept in the extension's own keychain, if this build names one.
    private static let legacy: [String: Any]? = setting("TransmissionLegacyKeychainService").map {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: $0,
         kSecAttrAccount as String: "server"]
    }
    private static var query: [String: Any] {
        var q: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                kSecAttrService as String: service,
                                kSecAttrAccount as String: "server"]
        if let group = SharedStore.keychainGroup {
            q[kSecAttrAccessGroup as String] = group
            q[kSecUseDataProtectionKeychain as String] = true
        }
        return q
    }
    private static func read(_ base: [String: Any]) throws -> String? {
        var q = base
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(q as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else { throw ExtensionFailure("Could not read the password from Keychain (\(status)).") }
        return String(data: data, encoding: .utf8)
    }
    static func read() throws -> String? { try read(query) }
    /// An empty item is the same as none; older versions stored one when the server changed.
    static func hasPassword() throws -> Bool { try read()?.isEmpty == false }
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
    /// If this fails the old item stays put and the user is asked for the password again.
    static func adoptLegacyItem() {
        guard SharedStore.keychainGroup != nil, let legacy, let old = try? read(legacy) else { return }
        if old.isEmpty || (try? write(old)) != nil { SecItemDelete(legacy as CFDictionary) }
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
    /// Whole-call limit, kept under the 45 s the extension's scripts wait for a native reply.
    var budget: TimeInterval = 40
    private struct OutOfTime: Error {}

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

    private func fetch(_ request: URLRequest, within seconds: TimeInterval) async throws -> (Data, URLResponse) {
        let session = self.session
        return try await withThrowingTaskGroup(of: (Data, URLResponse).self) { group in
            group.addTask { try await session.data(for: request) }
            group.addTask {
                try await Task.sleep(nanoseconds: UInt64(max(seconds, 0) * 1_000_000_000))
                throw OutOfTime()
            }
            defer { group.cancelAll() }
            return try await group.next()!
        }
    }

    func rpc(_ method: String, arguments: [String: Any] = [:]) async throws -> [String: Any] {
        let deadline = Date().addingTimeInterval(budget)
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
            do { (data, response) = try await fetch(request, within: deadline.timeIntervalSinceNow) }
            catch is OutOfTime {
                throw ExtensionFailure("Transmission did not answer within \(Int(budget)) seconds. An interrupted add may already have succeeded; retrying will report a duplicate.")
            }
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
    private static func validateWeb(_ link: String) throws {
        guard let parts = URLComponents(string: link), let scheme = parts.scheme?.lowercased(),
              ["http", "https"].contains(scheme), parts.host?.isEmpty == false, parts.user == nil, parts.password == nil else {
            throw ExtensionFailure("Use an HTTP(S) torrent URL without embedded login details, or a magnet link.")
        }
    }
    /// Returns what Transmission should be given: the link itself, or the torrent URL a hash-less magnet points at.
    @discardableResult
    static func validateLink(_ link: String) throws -> String {
        guard link.utf8.count <= 65536, let parts = URLComponents(string: link), let scheme = parts.scheme?.lowercased() else {
            throw ExtensionFailure("Enter a valid magnet link or torrent URL.")
        }
        guard scheme == "magnet" else { try validateWeb(link); return link }
        let items = parts.queryItems ?? []
        // Multi-torrent magnets number their topics: xt.1, xt.2, …
        let hasTopic = items.contains {
            $0.name.range(of: #"^xt(\.\d+)?$"#, options: .regularExpression) != nil &&
            $0.value?.range(of: #"^urn:(btih|btmh):.+$"#, options: [.regularExpression, .caseInsensitive]) != nil
        }
        if hasTopic { return link }
        if let source = items.first(where: { $0.name == "xs" })?.value, (try? validateWeb(source)) != nil { return source }
        throw ExtensionFailure("The magnet link is missing its torrent identifier.")
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
    /// `link` may be empty when `metainfo` comes from a local .torrent file.
    func add(link: String, directory: String, paused: Bool, metainfo: String? = nil) async throws -> String {
        let source = try (metainfo != nil && link.isEmpty) ? link : Self.validateLink(link)
        try ServerSettings.validateDirectory(directory)
        var args: [String: Any] = ["paused": paused]
        if let metainfo {
            try Self.validateMetainfo(metainfo)
            args["metainfo"] = metainfo
        } else { args["filename"] = source }
        if !directory.isEmpty { args["download-dir"] = directory }
        let response = try await rpc("torrent-add", arguments: args)
        if let torrent = response["torrent-duplicate"] as? [String: Any] {
            return "Already in Transmission: \(torrent["name"] as? String ?? "torrent"). Its existing directory was kept."
        }
        guard let torrent = response["torrent-added"] as? [String: Any] else { throw ExtensionFailure("Transmission did not confirm that the torrent was added.") }
        return "Added\(paused ? " paused" : ""): \(torrent["name"] as? String ?? "torrent")"
    }
}

actor TransmissionService {
    static let shared = TransmissionService()
    private static let connectionKeys = ["host", "port", "ssl", "path", "auth", "username"]
    private var settings: ServerSettings {
        get {
            guard let data = SharedStore.defaults.data(forKey: SharedStore.settingsKey), let value = try? JSONDecoder().decode(ServerSettings.self, from: data) else { return ServerSettings() }
            return value
        }
        set { SharedStore.defaults.set(try? JSONEncoder().encode(newValue), forKey: SharedStore.settingsKey) }
    }
    func handle(_ message: [String: Any]) async throws -> [String: Any] {
        _ = SharedStore.migrated
        switch message["action"] as? String {
        case "getSettings":
            return ["ok": true, "settings": settings.dictionary, "hasPassword": try PasswordStore.hasPassword()]
        case "saveSettings":
            guard let input = message["settings"] as? [String: Any] else { throw ExtensionFailure("Missing settings.") }
            let current = settings
            var merged = current.dictionary
            for key in Self.connectionKeys + ["directory", "askDirectory", "paused", "intercept"] {
                if let value = input[key] { merged[key] = value }
            }
            let updated = try JSONDecoder().decode(ServerSettings.self, from: JSONSerialization.data(withJSONObject: merged))
            var passwordCleared = false
            // Preferences such as click capture can change before a server is configured.
            if Self.connectionKeys.contains(where: { input[$0] != nil }) {
                try updated.validate()
                let password = message["password"] as? String ?? ""
                if !updated.auth { try PasswordStore.write(nil) }
                else if !password.isEmpty { try PasswordStore.write(password) }
                else if current.host != updated.host || current.port != updated.port || current.ssl != updated.ssl || current.path != updated.path || current.username != updated.username {
                    // Saved credentials must not silently move to another endpoint/account.
                    passwordCleared = try PasswordStore.hasPassword()
                    try PasswordStore.write(nil)
                }
            } else { try ServerSettings.validateDirectory(updated.directory) }
            settings = updated
            return ["ok": true, "settings": updated.dictionary, "hasPassword": try PasswordStore.hasPassword(), "passwordCleared": passwordCleared]
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
            if message["metainfo"] != nil && !(message["metainfo"] is String) { throw ExtensionFailure("Invalid torrent data.") }
            let metainfo = message["metainfo"] as? String
            guard let link = message["link"] as? String ?? (metainfo == nil ? nil : "") else { throw ExtensionFailure("Missing torrent link.") }
            let directory = message["directory"] as? String ?? snapshot.directory
            let text = try await client.add(link: link, directory: directory, paused: message["paused"] as? Bool ?? snapshot.paused, metainfo: metainfo)
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
