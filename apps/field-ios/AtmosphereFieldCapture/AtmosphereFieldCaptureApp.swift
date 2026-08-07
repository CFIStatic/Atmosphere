import SwiftUI

/**
 * Atmosphere Field Capture — App Store entry.
 *
 * One button to film the day (video + microphone). Optional RoomPlan/LiDAR
 * measures rooms into the property digital twin. AI dictation stays in the
 * office Verifier; this app only records, measures, and uploads.
 */
@main
struct AtmosphereFieldCaptureApp: App {
    @StateObject private var session = FieldDaySession()
    @StateObject private var api = AtmosphereClient.fromEnvironment()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(session)
                .environmentObject(api)
                .preferredColorScheme(.light)
        }
    }
}

struct RootView: View {
    @EnvironmentObject private var session: FieldDaySession

    var body: some View {
        Group {
            switch session.phase {
            case .today:
                TodayView()
            case .recording:
                RecordingView()
            case .door:
                DoorView()
            }
        }
        .background(FieldTheme.bg.ignoresSafeArea())
    }
}
