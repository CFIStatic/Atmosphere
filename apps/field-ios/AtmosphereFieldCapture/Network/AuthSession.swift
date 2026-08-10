import Foundation

/**
 * Platform account link for Field Capture.
 *
 * Supports **Sign in** (existing Atmosphere account) and **Create account**
 * (signup + join/create company). Tokens live in Keychain; the phone stays
 * signed in across launches until Disconnect.
 */
@MainActor
final class AuthSession: ObservableObject {
    /// True after the phone has been linked (Keychain has a refresh token + org).
    @Published private(set) var isLinked = false
    /// Account exists / session held, but the user still needs to join or create a company.
    @Published private(set) var needsOrgSetup = false
    @Published private(set) var email: String?
    @Published private(set) var orgName: String?
    @Published private(set) var fullName: String?
    @Published var lastError: String?
    @Published var infoMessage: String?
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
        guard isLinked || needsOrgSetup || api.refreshToken != nil else { return }
        restoreWarning = nil
        do {
            try await ensureFreshAccess()
            try await finishLinkIfPossible()
            lastError = nil
        } catch {
            if isUnauthorized(error) {
                do {
                    try await ensureFreshAccess(forceRefresh: true)
                    try await finishLinkIfPossible()
                    lastError = nil
                } catch {
                    if isUnauthorized(error) {
                        clearLink()
                        lastError = "This phone was disconnected. Sign in or create an account to continue."
                    } else if isNoOrganization(error) {
                        needsOrgSetup = true
                        isLinked = false
                        infoMessage = "Account is ready — join your company with a code, or start a new company."
                    } else {
                        restoreWarning = "Couldn’t refresh jobs right now. You’re still connected — try again when you have signal."
                    }
                }
            } else if isNoOrganization(error) {
                needsOrgSetup = true
                isLinked = false
                infoMessage = "Account is ready — join your company with a code, or start a new company."
            } else {
                restoreWarning = "Couldn’t refresh jobs right now. You’re still connected — try again when you have signal."
            }
        }
    }

    /// Sign in with an existing Atmosphere website account.
    func connectAccount(email: String, password: String, apiBase: String) async {
        lastError = nil
        infoMessage = nil
        do {
            try api.useAPIBase(apiBase)
            let result = try await api.login(email: email, password: password)
            guard let session = result.session else {
                throw APIError.http(
                    status: 0,
                    body: "Signed in, but no session came back. Confirm your email if Atmosphere asked you to."
                )
            }
            persist(session: session, email: result.user.email ?? email)
            try await finishLinkIfPossible()
        } catch {
            if isNoOrganization(error) {
                needsOrgSetup = true
                isLinked = false
                infoMessage = "Signed in. Join your company with a code from the office, or start a new company."
                lastError = nil
            } else {
                lastError = Self.friendlyAuthError(error, creating: false)
                isLinked = KeychainStore.get(account: refreshAccount) != nil && !needsOrgSetup
            }
        }
    }

    /// Create a new Atmosphere account, then join or create a company for Field Capture.
    func createAccount(
        fullName: String,
        email: String,
        password: String,
        apiBase: String,
        joinCode: String?,
        newCompanyName: String?
    ) async {
        lastError = nil
        infoMessage = nil
        do {
            try api.useAPIBase(apiBase)
            let result = try await api.signup(email: email, password: password)
            if result.needsEmailConfirmation == true || result.session == nil {
                infoMessage = result.message
                    ?? "Account created. Check your email to confirm, then sign in here."
                needsOrgSetup = false
                isLinked = false
                return
            }
            guard let session = result.session else {
                throw APIError.http(status: 0, body: "Account created but no session came back.")
            }
            persist(session: session, email: result.user?.email ?? email)

            let trimmedName = fullName.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmedName.isEmpty {
                try? await api.updateProfile(fullName: trimmedName)
                self.fullName = trimmedName
                UserDefaults.standard.set(trimmedName, forKey: nameAccount)
            }

            try await attachOrganization(joinCode: joinCode, newCompanyName: newCompanyName)
            try await finishLinkIfPossible()
        } catch {
            if isNoOrganization(error) {
                needsOrgSetup = true
                isLinked = false
                infoMessage = "Account created. Join your company with a code, or start a new company."
                lastError = nil
            } else {
                lastError = Self.friendlyAuthError(error, creating: true)
                isLinked = false
            }
        }
    }

    /// Finish onboarding when the account exists but has no company yet.
    func completeOrgSetup(joinCode: String?, newCompanyName: String?) async {
        lastError = nil
        infoMessage = nil
        do {
            try await attachOrganization(joinCode: joinCode, newCompanyName: newCompanyName)
            try await finishLinkIfPossible()
        } catch {
            lastError = Self.friendlyAuthError(error, creating: true)
        }
    }

    private func attachOrganization(joinCode: String?, newCompanyName: String?) async throws {
        let code = joinCode?.trimmingCharacters(in: .whitespacesAndNewlines).uppercased() ?? ""
        let company = newCompanyName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !code.isEmpty {
            let org = try await api.joinOrg(joinCode: code)
            orgName = org.name
            UserDefaults.standard.set(org.name, forKey: orgAccount)
            return
        }
        if !company.isEmpty {
            let org = try await api.createOrg(name: company)
            orgName = org.name
            UserDefaults.standard.set(org.name, forKey: orgAccount)
            return
        }
        throw APIError.http(
            status: 0,
            body: "Enter your company join code from the office, or a new company name to start one."
        )
    }

    private func finishLinkIfPossible() async throws {
        do {
            let me = try await api.fieldMe()
            applyProfile(me)
            UserDefaults.standard.set(true, forKey: linkedFlagKey)
            needsOrgSetup = false
            isLinked = true
            infoMessage = nil
        } catch {
            if isNoOrganization(error) {
                needsOrgSetup = true
                isLinked = false
                throw error
            }
            throw error
        }
    }

    private static func friendlyAuthError(_ error: Error, creating: Bool) -> String {
        if let urlErr = error as? URLError {
            switch urlErr.code {
            case .notConnectedToInternet, .networkConnectionLost:
                return "No network. Connect to the internet and try again."
            case .cannotFindHost, .dnsLookupFailed:
                return "Can’t reach that Atmosphere server. Check the API URL matches the host your website uses."
            case .timedOut:
                return "The Atmosphere server timed out. Try again in a moment."
            default:
                break
            }
        }
        if case let APIError.http(status, body) = error {
            if status == 401 {
                return "Wrong email or password — use the same login as your Atmosphere website."
            }
            if status == 403, body.localizedCaseInsensitiveContains("organization") {
                return "Join your company with a code from the office, or start a new company."
            }
            if status == 0 || status >= 500 {
                return body.isEmpty
                    ? "Couldn’t reach Atmosphere. Check the API URL (same backend as the website)."
                    : body
            }
            if creating, body.localizedCaseInsensitiveContains("unable to create") {
                return "Couldn’t create that account. If you already have one, switch to Sign in."
            }
            if body.localizedCaseInsensitiveContains("invalid") && !creating {
                return "Wrong email or password — use the same login as your Atmosphere website."
            }
            return body.isEmpty
                ? (creating ? "Couldn’t create account (\(status))." : "Sign-in failed (\(status)).")
                : String(body.prefix(240))
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
        isLinked = linked && (refresh != nil || access != nil) && orgName != nil
        needsOrgSetup = linked && (refresh != nil || access != nil) && orgName == nil

        // Repair flag if Keychain still has tokens from an older build.
        if (isLinked || needsOrgSetup), !flagged {
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
        self.email = email
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
        needsOrgSetup = false
        email = nil
        orgName = nil
        fullName = nil
        infoMessage = nil
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
        if case let APIError.http(status, _) = error { return status == 401 }
        return false
    }

    private func isNoOrganization(_ error: Error) -> Bool {
        if case let APIError.http(status, body) = error {
            return status == 403 && (
                body.localizedCaseInsensitiveContains("organization")
                    || body.localizedCaseInsensitiveContains("no_organization")
            )
        }
        return false
    }
}
