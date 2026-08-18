import Combine
import SwiftUI

/**
 * Atmosphere Field Capture — App Store entry.
 *
 * Connect the platform account once on first install. Later launches open
 * straight to Today; day films land in that org’s evidence library.
 */
@main
struct AtmosphereFieldCaptureApp: App {
    @StateObject private var api: AtmosphereClient
    @StateObject private var auth: AuthSession
    @StateObject private var session = FieldDaySession()

    init() {
        let client = AtmosphereClient.fromEnvironment()
        let sessionAuth = AuthSession(api: client)
        sessionAuth.bindAPIRefresh()
        _api = StateObject(wrappedValue: client)
        _auth = StateObject(wrappedValue: sessionAuth)
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(session)
                .environmentObject(api)
                .environmentObject(auth)
                .task {
                    auth.bindAPIRefresh()
                    await auth.restore()
                    if auth.isLinked, !auth.needsOfficeLink {
                        await session.loadToday(api: api)
                        await session.consumePendingInvite(api: api)
                    }
                    await session.restorePendingUpload(api: api)
                }
        }
    }
}

struct RootView: View {
    @EnvironmentObject private var session: FieldDaySession
    @EnvironmentObject private var auth: AuthSession
    @EnvironmentObject private var api: AtmosphereClient
    @State private var showSignUp = false

    var body: some View {
        Group {
            if !auth.isLinked {
                if showSignUp {
                    SignUpView(onSignIn: { showSignUp = false })
                } else {
                    SignInView(onCreateAccount: { showSignUp = true })
                }
            } else if auth.needsOfficeLink || auth.showOfficeLink {
                OfficeLinkView()
            } else {
                switch session.phase {
                case .today:
                    FieldShellView()
                case .recording:
                    RecordingView()
                case .measuring:
                    MeasureView()
                case .door:
                    DoorView()
                }
            }
        }
        .background(FieldTheme.bg.ignoresSafeArea())
        .sheet(isPresented: $session.showInvite) {
            InviteJobView(onDismiss: { session.showInvite = false })
        }
        .sheet(item: $session.measureOffer) { _ in
            MeasureOfferView()
        }
        // iOS 16-compatible: the two-parameter / `initial:` onChange APIs are iOS 17+.
        .onReceive(auth.$isLinked.dropFirst()) { linked in
            if linked, !auth.needsOfficeLink {
                Task {
                    await session.loadToday(api: api)
                    await session.consumePendingInvite(api: api)
                }
            }
        }
        .onReceive(auth.$needsOfficeLink.dropFirst()) { needsOffice in
            if auth.isLinked, !needsOffice, !auth.showOfficeLink {
                Task {
                    await session.loadToday(api: api)
                    await session.consumePendingInvite(api: api)
                }
            }
        }
        .onOpenURL { url in
            if let token = ShareLink.token(from: url) {
                PendingInviteStore.save(token)
                if auth.isLinked, !auth.needsOfficeLink {
                    Task { await session.openInvite(api: api, raw: url.absoluteString) }
                }
            } else {
                auth.handleOpenURL(url)
            }
        }
    }
}
