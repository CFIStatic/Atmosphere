import Foundation

/**
 * One-time platform account link for Field Capture.
 *
 * Connect when the app is first installed; tokens live in Keychain and the
 * phone stays signed in across launches. Crew should not sign in every day —
 * only again if they explicitly disconnect or the org revokes the session.
 */
@MainActor
final class AuthSession: ObservableObject {
    /// True after the phone has been linked (Keychain has a refresh token).
    @Published private(set) var isLinked = false
    @Published private(set) var email: String?
    @Published private(set) var orgName: String?
    @Published private(set) var fullName: String?
    @Published var lastError: String?
    /// Soft banner while linked but the network/profile refresh failed.
    @Published var restoreWarning: String?

    private let accessAccount = "accessToken"
    private let refreshAccount = "refreshToken"
    private let emailAccount = "email"
    private let orgAccount = "orgName"
    private let nameAccount = "fullName"
    private let linkedFlagKey = "atmosphere.field.accountLinked"

    let api: AtmosphereClient

    /// Back-compat for views that still read `isSignedIn`.
    var isSignedIn: Bool { isLinked }

    init(api: AtmosphereClient) {
        self.api = api
        hydrateFromStore()
    }

    /// Wire after both objects exist (avoids capturing `self` during `init`).
    func bindAPIRefresh() {
        api.onUnauthorized = { [weak self] in
            guard let self else { return }
            try await self.refreshAccessToken()
        }
    }

    /// Call on every cold start. Never clears the link for a network blip.
    func restore() async {
        guard isLinked else { return }
        restoreWarning = nil
        do {
            try await ensureFreshAccess()
            let me = try await api.fieldMe()
            applyProfile(me)
            lastError = nil
        } catch {
            if isUnauthorized(error) {
                do {
                    try await ensureFreshAccess(forceRefresh: true)
                    let me = try await api.fieldMe()
                    applyProfile(me)
                    lastError = nil
                } catch {
                    if isUnauthorized(error) {
                        // Session truly dead — only then ask to connect again.
                        clearLink()
                        lastError = "This phone was disconnected. Connect your Atmosphere account once to continue."
                    } else {
                        restoreWarning = "Couldn’t refresh jobs right now. You’re still connected — try again when you have signal."
                    }
                }
            } else {
                restoreWarning = "Couldn’t refresh jobs right now. You’re still connected — try again when you have signal."
            }
        }
    }

    /// First-install (or re-connect) only — same email/password as the website.
    func connectAccount(email: String, password: String) async {
        lastError = nil
        do {
            let result = try await api.login(email: email, password: password)
            guard let session = result.session else {
                throw APIError.http(
                    status: 0,
                    body: "Signed in on the website account, but no session came back. Confirm your email if Atmosphere asked you to."
                )
            }
            persist(session: session, email: result.user.email ?? email)
            UserDefaults.standard.set(true, forKey: linkedFlagKey)
            isLinked = true
            do {
                let me = try await api.fieldMe()
                applyProfile(me)
            } catch {
                restoreWarning =
                    "Signed in with your dashboard account. If jobs don’t appear, link this login to the office on the website."
            }
        } catch {
            lastError = Self.friendlyConnectError(error)
            isLinked = KeychainStore.get(account: refreshAccount) != nil
        }
    }

    private static func friendlyConnectError(_ error: Error) -> String {
        if let urlErr = error as? URLError {
            switch urlErr.code {
            case .notConnectedToInternet, .networkConnectionLost:
                return "No network. Connect to the internet and try again."
            case .cannotFindHost, .dnsLookupFailed:
                return "Can’t reach Atmosphere right now. Check your connection and try again."
            case .timedOut:
                return "Atmosphere timed out. Try again in a moment."
            default:
                break
            }
        }
        if case let APIError.http(status, body) = error {
            if status == 401 {
                return "Wrong email or password — use the same login as your Atmosphere website."
            }
            if status == 0 || status >= 500 {
                return body.isEmpty
                    ? "Couldn’t reach Atmosphere. Try again in a moment."
                    : body
            }
            if body.localizedCaseInsensitiveContains("invalid") {
                return "Wrong email or password — use the same login as your Atmosphere website."
            }
            return body.isEmpty ? "Sign-in failed (\(status))." : String(body.prefix(240))
        }
        return error.localizedDescription
    }

    /// Explicit disconnect — the only way to return to the connect screen.
    func disconnectAccount() async {
        await api.logout()
        clearLink()
    }

    /// Used by the API client when a request gets 401 mid-session.
    func refreshAccessToken() async throws {
        try await ensureFreshAccess(forceRefresh: true)
    }

    // MARK: - Private

    private func hydrateFromStore() {
        let refresh = KeychainStore.get(account: refreshAccount)
        let access = KeychainStore.get(account: accessAccount)
        let flagged = UserDefaults.standard.bool(forKey: linkedFlagKey)
        let linked = refresh != nil || access != nil || flagged

        api.refreshToken = refresh
        api.accessToken = access
        email = KeychainStore.get(account: emailAccount)
        orgName = UserDefaults.standard.string(forKey: orgAccount)
        fullName = UserDefaults.standard.string(forKey: nameAccount)
        isLinked = linked && (refresh != nil || access != nil)

        // Repair flag if Keychain still has tokens from an older build.
        if isLinked, !flagged {
            UserDefaults.standard.set(true, forKey: linkedFlagKey)
        }
    }

    private func applyProfile(_ me: AtmosphereClient.FieldMe) {
        email = me.user.email
        fullName = me.user.fullName
        orgName = me.org.name
        if let email { KeychainStore.set(email, account: emailAccount) }
        if let fullName { UserDefaults.standard.set(fullName, forKey: nameAccount) }
        UserDefaults.standard.set(me.org.name, forKey: orgAccount)
    }

    private func persist(session: AtmosphereClient.SessionTokens, email: String) {
        KeychainStore.set(session.accessToken, account: accessAccount)
        KeychainStore.set(session.refreshToken, account: refreshAccount)
        KeychainStore.set(email, account: emailAccount)
        api.accessToken = session.accessToken
        api.refreshToken = session.refreshToken
    }

    private func clearLink() {
        KeychainStore.delete(account: accessAccount)
        KeychainStore.delete(account: refreshAccount)
        KeychainStore.delete(account: emailAccount)
        UserDefaults.standard.removeObject(forKey: orgAccount)
        UserDefaults.standard.removeObject(forKey: nameAccount)
        UserDefaults.standard.set(false, forKey: linkedFlagKey)
        api.accessToken = nil
        api.refreshToken = nil
        isLinked = false
        email = nil
        orgName = nil
        fullName = nil
    }

    private func ensureFreshAccess(forceRefresh: Bool = false) async throws {
        let refresh = api.refreshToken ?? KeychainStore.get(account: refreshAccount)
        if !forceRefresh, api.accessToken != nil || KeychainStore.get(account: accessAccount) != nil {
            if api.accessToken == nil {
                api.accessToken = KeychainStore.get(account: accessAccount)
            }
            return
        }
        guard let refresh else {
            throw APIError.http(status: 401, body: "no refresh token")
        }
        let result = try await api.refresh(refreshToken: refresh)
        guard let session = result.session else {
            throw APIError.http(status: 401, body: "refresh failed")
        }
        persist(session: session, email: email ?? KeychainStore.get(account: emailAccount) ?? "")
    }

    private func isUnauthorized(_ error: Error) -> Bool {
        if case let APIError.http(status, _) = error { return status == 401 || status == 403 }
        return false
    }
}
