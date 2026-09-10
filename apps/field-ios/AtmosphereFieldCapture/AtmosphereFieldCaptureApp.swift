import Combine
import SwiftUI

/**
 * Atmosphere Field Capture — App Store entry.
 *
 * Connect the crew once on first install with the same email and password
 * as the office Platform. Later launches open straight to Today; day films
 * land in that org’s evidence library. Filing uses a durable on-device queue
 * (save-first, forever retry) matching web Field Capture.
 *
 * Job-share: `atmosphere-field://share?token=` or https app.?token= (C5).
 */
@main
struct AtmosphereFieldCaptureApp: App {
    @StateObject private var api: AtmosphereClient
    @StateObject private var auth: AuthSession
    @StateObject private var session = FieldDaySession()
    @AppStorage("atm-theme") private var themeRaw = AppearancePreference.light.rawValue

    init() {
        let client = AtmosphereClient.fromEnvironment()
        let sessionAuth = AuthSession(api: client)
        sessionAuth.bindAPIRefresh()
        _api = StateObject(wrappedValue: client)
        _auth = StateObject(wrappedValue: sessionAuth)
    }

    private var appearance: AppearancePreference {
        AppearancePreference(rawValue: themeRaw) ?? .light
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(session)
                .environmentObject(api)
                .environmentObject(auth)
                .preferredColorScheme(appearance.colorScheme)
                .task {
                    auth.bindAPIRefresh()
                    session.bindUploadQueue(api: api)
                    await auth.restore()
                    if auth.isLinked, !auth.needsOfficeLink, !auth.needsTermsAcceptance {
                        await session.loadToday(api: api)
                    }
                    await session.uploadQueue.reloadAndKick(reason: "launch")
                }
                .onReceive(NotificationCenter.default.publisher(for: .dayFilmQueueDidRemapJob)) { note in
                    guard let localId = note.userInfo?["localId"] as? String,
                          let serverId = note.userInfo?["serverId"] as? String
                    else { return }
                    if let job = note.userInfo?["job"] as? ExpectedJob {
                        Task { @MainActor in
                            await session.remapLocalJob(localId: localId, serverJob: job)
                        }
                    } else if session.activeJobId == localId {
                        session.activeJobId = serverId
                    }
                }
                .onReceive(NotificationCenter.default.publisher(for: .dayFilmQueueDidFile)) { note in
                    let proofId = note.userInfo?["proofId"] as? String
                    let storagePath = note.userInfo?["storagePath"] as? String
                    let byteSize = note.userInfo?["byteSize"] as? Int64
                    session.applyFiledNotification(
                        proofId: proofId,
                        storagePath: storagePath,
                        byteSize: byteSize
                    )
                }
        }
    }
}

struct RootView: View {
    @EnvironmentObject private var session: FieldDaySession
    @EnvironmentObject private var auth: AuthSession
    @EnvironmentObject private var api: AtmosphereClient
    @Environment(\.scenePhase) private var scenePhase
    @State private var showSignUp = false
    @State private var showJoinCrew = false
    @State private var showElevate = false
    @State private var cameFromConnect = false

    var body: some View {
        Group {
            if session.isShareMode {
                shareStack
            } else if !auth.isLinked {
                if showSignUp {
                    SignUpView(onSignIn: { showSignUp = false })
                } else if showJoinCrew {
                    JoinCrewView(onDashboardLogin: { showJoinCrew = false })
                } else {
                    SignInView(
                        onCreateAccount: { showSignUp = true },
                        onJoinWithCode: { showJoinCrew = true }
                    )
                }
            } else if auth.needsTermsAcceptance {
                TermsAcknowledgmentView()
            } else if auth.needsOfficeLink || auth.showOfficeLink {
                OfficeLinkView()
            } else {
                linkedStack
            }
        }
        .background((session.phase == .recording ? Color.black : FieldTheme.bg).ignoresSafeArea())
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
        .onChange(of: scenePhase) { phase in
            if phase == .active {
                Task {
                    await session.uploadQueue.reloadAndKick(reason: "foreground")
                    if session.isShareMode {
                        /* keep share job */
                    } else if auth.isLinked, !auth.needsOfficeLink, !auth.needsTermsAcceptance {
                        session.syncPendingJobs(api: api)
                    }
                }
            }
        }
        .onReceive(auth.$isLinked.dropFirst()) { linked in
            if linked, !auth.needsOfficeLink, !auth.needsTermsAcceptance {
                playElevateIfComingFromConnect()
                Task { await session.loadToday(api: api) }
            }
        }
        .onReceive(auth.$needsOfficeLink.dropFirst()) { needsOffice in
            if auth.isLinked, !needsOffice, !auth.showOfficeLink, !auth.needsTermsAcceptance {
                playElevateIfComingFromConnect()
                Task { await session.loadToday(api: api) }
            }
        }
        .onReceive(auth.$needsTermsAcceptance.dropFirst()) { needsTerms in
            if auth.isLinked, !needsTerms, !auth.needsOfficeLink, !auth.showOfficeLink {
                playElevateIfComingFromConnect()
                Task { await session.loadToday(api: api) }
            }
        }
        .onOpenURL { url in
            if let shareToken = auth.handleOpenURL(url) {
                Task { await session.enterShareMode(token: shareToken, api: api) }
                return
            }
            if !auth.isLinked, let code = auth.pendingJoinCode, !code.isEmpty {
                showSignUp = false
                showJoinCrew = true
            }
        }
    }

    @ViewBuilder
    private var linkedStack: some View {
        switch session.phase {
        case .today:
            TodayView()
        case .recording:
            RecordingView()
                .ignoresSafeArea()
        case .door:
            DoorView()
        }
    }

    @ViewBuilder
    private var shareStack: some View {
        switch session.phase {
        case .today:
            TodayView()
        case .recording:
            RecordingView()
                .ignoresSafeArea()
        case .door:
            DoorView()
        }
    }

    private func playElevateIfComingFromConnect() {
        guard cameFromConnect else { return }
        cameFromConnect = false
        showElevate = true
    }
}
