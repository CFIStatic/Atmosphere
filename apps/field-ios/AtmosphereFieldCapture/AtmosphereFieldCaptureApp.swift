import Combine
import SwiftUI

/**
 * Atmosphere Field Capture — App Store entry.
 *
 * Connect the crew once on first install with the company code. Later
 * launches open straight to Today; day films land in that org’s
 * evidence library.
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
                .preferredColorScheme(.light)
                .task {
                    auth.bindAPIRefresh()
                    await auth.restore()
                    if auth.isLinked, !auth.needsOfficeLink {
                        await session.loadToday(api: api)
                    }
                }
        }
    }
}

struct RootView: View {
    @EnvironmentObject private var session: FieldDaySession
    @EnvironmentObject private var auth: AuthSession
    @EnvironmentObject private var api: AtmosphereClient
    @State private var showDashboardLogin = false
    @State private var showElevate = false
    @State private var cameFromConnect = false

    var body: some View {
        Group {
            if !auth.isLinked {
                if showDashboardLogin {
                    SignInView(onCreateAccount: { showDashboardLogin = false })
                } else {
                    JoinCrewView(onDashboardLogin: { showDashboardLogin = true })
                }
            } else if auth.needsOfficeLink || auth.showOfficeLink {
                OfficeLinkView()
            } else {
                switch session.phase {
                case .today:
                    TodayView()
                case .recording:
                    RecordingView()
                case .door:
                    DoorView()
                }
            }
        }
        .background(FieldTheme.bg.ignoresSafeArea())
        .overlay {
            if showElevate {
                ElevateSplashView {
                    showElevate = false
                }
            }
        }
        .onAppear {
            cameFromConnect = !auth.isLinked || auth.needsOfficeLink
        }
        // iOS 16-compatible: the two-parameter / `initial:` onChange APIs are iOS 17+.
        .onReceive(auth.$isLinked.dropFirst()) { linked in
            if linked, !auth.needsOfficeLink {
                playElevateIfComingFromConnect()
                Task { await session.loadToday(api: api) }
            }
        }
        .onReceive(auth.$needsOfficeLink.dropFirst()) { needsOffice in
            if auth.isLinked, !needsOffice, !auth.showOfficeLink {
                playElevateIfComingFromConnect()
                Task { await session.loadToday(api: api) }
            }
        }
        .onOpenURL { url in
            auth.handleOpenURL(url)
        }
    }

    private func playElevateIfComingFromConnect() {
        guard cameFromConnect else { return }
        cameFromConnect = false
        showElevate = true
    }
}
