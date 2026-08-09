import SwiftUI

/**
 * Atmosphere Field Capture — App Store entry.
 *
 * Sign in with the same Atmosphere account as the dashboard. One button films
 * the day (video + microphone); uploads land in that org’s evidence library.
 * Optional RoomPlan/LiDAR measures rooms into the property digital twin.
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
                    if auth.isSignedIn {
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
            if !auth.isSignedIn {
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
        .onChange(of: auth.isSignedIn) { _, signedIn in
            if signedIn {
                Task { await session.loadToday(api: api) }
            }
        }
    }
}
