import SwiftUI

struct TodayView: View {
    @EnvironmentObject private var session: FieldDaySession
    @EnvironmentObject private var auth: AuthSession
    @EnvironmentObject private var api: AtmosphereClient

    var body: some View {
        VStack(spacing: 0) {
            header
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
                            Text("Nothing assigned to you yet. Ask the office to put you on a job, then pull to refresh.")
                                .font(.system(size: 13))
                                .foregroundStyle(FieldTheme.muted)
                        }
                        ForEach(session.jobs) { job in
                            Button {
                                session.activeJobId = job.id
                            } label: {
                                HStack {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(job.name).font(.system(size: 14, weight: .semibold))
                                        Text(job.address)
                                            .font(.system(size: 12))
                                            .foregroundStyle(FieldTheme.muted)
                                    }
                                    Spacer()
                                    Text(job.filmed == true ? "Filmed" : job.at)
                                        .font(FieldTheme.mono)
                                        .foregroundStyle(job.filmed == true ? FieldTheme.pass : FieldTheme.faint)
                                    if session.activeJobId == job.id {
                                        Text("●")
                                            .foregroundStyle(FieldTheme.accent)
                                            .font(.system(size: 10))
                                    }
                                }
                                .padding(12)
                                .background(FieldTheme.panel)
                                .overlay(
                                    RoundedRectangle(cornerRadius: 10)
                                        .stroke(session.activeJobId == job.id ? FieldTheme.accent : FieldTheme.line)
                                )
                                .cornerRadius(10)
                            }
                            .buttonStyle(.plain)
                            .foregroundStyle(FieldTheme.ink)
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
            .task {
                await session.requestCapturePermissions()
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
    }

    private var header: some View {
        HStack(spacing: 10) {
            AtmosphereBarsMark(size: 22)
            VStack(alignment: .leading, spacing: 1) {
                Text("Atmosphere")
                    .font(.system(size: 16, weight: .heavy))
                    .foregroundStyle(FieldTheme.ink)
                Text(auth.orgName ?? "Field Capture")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(FieldTheme.muted)
                    .lineLimit(1)
            }
            Spacer()
            Menu {
                if let name = auth.fullName, !name.isEmpty {
                    Text(name)
                } else if let email = auth.email, !email.hasSuffix("@field.atmosphere.app") {
                    Text(email)
                }
                if let office = auth.orgName {
                    Text("Office: \(office)")
                }
                Button("Link to office account") {
                    auth.beginOfficeLink()
                }
                Button("Disconnect this phone", role: .destructive) {
                    Task {
                        await auth.disconnectAccount()
                        session.jobs = []
                    }
                }
            } label: {
                Text("Account")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(FieldTheme.muted)
            }
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 14)
        .background(FieldTheme.panel)
        .overlay(alignment: .bottom) { FieldTheme.line.frame(height: 1) }
    }
}
