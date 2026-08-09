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
        _api = StateObject(wrappedValue: client)
        _auth = StateObject(wrappedValue: AuthSession(api: client))
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(session)
                .environmentObject(api)
                .environmentObject(auth)
                .preferredColorScheme(.light)
                .task {
                    await auth.restore()
                    if auth.isLinked {
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

    var body: some View {
        Group {
            if !auth.isLinked {
                SignInView()
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
        .onChange(of: auth.isLinked) { _, linked in
            if linked {
                Task { await session.loadToday(api: api) }
            }
        }
    }
}
