import SwiftUI

struct TodayView: View {
    @EnvironmentObject private var session: FieldDaySession
    @EnvironmentObject private var auth: AuthSession
    @EnvironmentObject private var api: AtmosphereClient

    var body: some View {
        VStack(spacing: 0) {
            FieldHeader()
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    Text(Date.now, format: .dateTime.weekday(.wide).month(.abbreviated).day())
                        .font(FieldTheme.mono)
                        .foregroundStyle(FieldTheme.faint)
                        .textCase(.uppercase)

                    Text("Start it and go to work")
                        .font(.system(size: 28, weight: .bold))
                        .foregroundStyle(FieldTheme.ink)

                    Text(
                        "One button, once a day. Tap when you get to your first job and hold when you are done. The film is video + audio — filed to \(auth.orgName ?? "your organization") so the office can open it in the evidence library."
                    )
                    .font(.system(size: 15))
                    .foregroundStyle(FieldTheme.muted)

                    VStack(alignment: .leading, spacing: 8) {
                        Text("Today's jobs")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(FieldTheme.faint)
                            .textCase(.uppercase)
                        if session.loadingJobs {
                            Text("Loading today's jobs from your account…")
                                .font(.system(size: 13))
                                .foregroundStyle(FieldTheme.muted)
                        } else if session.jobs.isEmpty {
                            Text("Nothing assigned to you today. Open My jobs to see the rest of your work, or add a job from this phone.")
                                .font(.system(size: 13))
                                .foregroundStyle(FieldTheme.muted)
                            HStack(spacing: 16) {
                                Button("My jobs") { session.tab = .jobs }
                                Button("Add a job") { session.tab = .add }
                            }
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(FieldTheme.accent)
                        }
                        ForEach(session.jobs) { job in
                            FieldJobCard(job: job, selected: session.activeJobId == job.id) {
                                session.activeJobId = job.id
                            }
                        }
                    }

                    VStack(alignment: .leading, spacing: 6) {
                        Text("Property twin · App Store")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(FieldTheme.faint)
                            .textCase(.uppercase)
                        Text(
                            "While you film, LiDAR / RoomPlan can measure rooms. The office gets a 3D twin of the property and the work — you still only press one button."
                        )
                        .font(.system(size: 13.5))
                        .foregroundStyle(FieldTheme.muted)
                    }
                    .padding(14)
                    .background(FieldTheme.panel)
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(FieldTheme.line))
                    .cornerRadius(12)

                    if let warn = auth.restoreWarning {
                        Text(warn)
                            .font(.system(size: 13))
                            .foregroundStyle(FieldTheme.muted)
                    }

                    if let err = session.lastError {
                        Text(err)
                            .font(.system(size: 13))
                            .foregroundStyle(FieldTheme.rec)
                    }
                }
                .padding(18)
            }
            .refreshable {
                await session.loadToday(api: api)
            }

            Button {
                Task { await session.startDay() }
            } label: {
                Label("Start the day", systemImage: "video.fill")
                    .font(.system(size: 17, weight: .bold))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                    .background(FieldTheme.ink)
                    .foregroundStyle(FieldTheme.bg)
                    .cornerRadius(12)
            }
            .padding(18)
        }
        .background(FieldTheme.bg)
    }
}
