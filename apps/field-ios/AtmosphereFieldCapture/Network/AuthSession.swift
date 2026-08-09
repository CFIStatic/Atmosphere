import Foundation

/// Platform account session — same user/org as the Atmosphere dashboard.
@MainActor
final class AuthSession: ObservableObject {
    @Published private(set) var isSignedIn = false
    @Published private(set) var email: String?
    @Published private(set) var orgName: String?
    @Published private(set) var fullName: String?
    @Published var lastError: String?

    private let accessAccount = "accessToken"
    private let refreshAccount = "refreshToken"
    private let emailAccount = "email"

    let api: AtmosphereClient

    init(api: AtmosphereClient) {
        self.api = api
        if let access = KeychainStore.get(account: accessAccount) {
            api.accessToken = access
            api.refreshToken = KeychainStore.get(account: refreshAccount)
            email = KeychainStore.get(account: emailAccount)
            isSignedIn = true
        }
    }

    func restore() async {
        guard isSignedIn else { return }
        do {
            try await refreshIfNeeded()
            let me = try await api.fieldMe()
            email = me.user.email
            fullName = me.user.fullName
            orgName = me.org.name
            lastError = nil
        } catch {
            // Try one refresh, then sign out if the session is dead.
            do {
                try await refreshIfNeeded(force: true)
                let me = try await api.fieldMe()
                email = me.user.email
                fullName = me.user.fullName
                orgName = me.org.name
            } catch {
                signOutLocal()
                lastError = "Sign in again to connect this phone to your Atmosphere account."
            }
        }
    }

    func signIn(email: String, password: String) async {
        lastError = nil
        do {
            let result = try await api.login(email: email, password: password)
            guard let session = result.session else {
                throw APIError.http(status: 0, body: "No session returned — confirm email if needed.")
            }
            persist(session: session, email: result.user.email ?? email)
            let me = try await api.fieldMe()
            self.email = me.user.email
            fullName = me.user.fullName
            orgName = me.org.name
            isSignedIn = true
        } catch {
            lastError = error.localizedDescription
            isSignedIn = false
        }
    }

    func signOut() async {
        await api.logout()
        signOutLocal()
    }

    private func signOutLocal() {
        KeychainStore.delete(account: accessAccount)
        KeychainStore.delete(account: refreshAccount)
        KeychainStore.delete(account: emailAccount)
        api.accessToken = nil
        api.refreshToken = nil
        isSignedIn = false
        email = nil
        orgName = nil
        fullName = nil
    }

    private func persist(session: AtmosphereClient.SessionTokens, email: String) {
        KeychainStore.set(session.accessToken, account: accessAccount)
        KeychainStore.set(session.refreshToken, account: refreshAccount)
        KeychainStore.set(email, account: emailAccount)
        api.accessToken = session.accessToken
        api.refreshToken = session.refreshToken
    }

    func refreshIfNeeded(force: Bool = false) async throws {
        guard let refresh = api.refreshToken ?? KeychainStore.get(account: refreshAccount) else {
            if force { throw APIError.http(status: 401, body: "no refresh token") }
            return
        }
        if !force, api.accessToken != nil { return }
        let result = try await api.refresh(refreshToken: refresh)
        guard let session = result.session else {
            throw APIError.http(status: 401, body: "refresh failed")
        }
        persist(session: session, email: email ?? KeychainStore.get(account: emailAccount) ?? "")
    }
}
