import SwiftUI

struct TodayView: View {
    @EnvironmentObject private var session: FieldDaySession
    @EnvironmentObject private var auth: AuthSession
    @EnvironmentObject private var api: AtmosphereClient
    @State private var searchDraft: String = ""
    @State private var searchTask: Task<Void, Never>?

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
                        "One button, once a day. Tap a job — or search any open job in \(auth.orgName ?? "your organization") if something comes up off-schedule — then hold when you are done. The film is video + audio, filed to the office evidence library."
                    )
                    .font(.system(size: 15))
                    .foregroundStyle(FieldTheme.muted)

                    searchField

                    VStack(alignment: .leading, spacing: 8) {
                        Text(session.searchQuery.isEmpty ? "What today expects of you" : "Matching jobs")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(FieldTheme.faint)
                            .textCase(.uppercase)
                        if session.loadingJobs || session.searchingJobs {
                            Text(session.searchingJobs ? "Searching jobs…" : "Loading jobs from your account…")
                                .font(.system(size: 13))
                                .foregroundStyle(FieldTheme.muted)
                        } else if session.jobs.isEmpty {
                            Text(
                                session.searchQuery.isEmpty
                                    ? "No open jobs yet. Create a job in the Atmosphere dashboard, then pull to refresh — or search by address / job #."
                                    : "No open jobs match that search. Try an address, job #, or claim number."
                            )
                            .font(.system(size: 13))
                            .foregroundStyle(FieldTheme.muted)
                        }
                        ForEach(session.jobs) { job in
                            Button {
                                session.activeJobId = job.id
                            } label: {
                                HStack {
                                    VStack(alignment: .leading, spacing: 2) {
                                        HStack(spacing: 6) {
                                            if !job.number.isEmpty {
                                                Text(job.number)
                                                    .font(FieldTheme.mono)
                                                    .foregroundStyle(FieldTheme.faint)
                                            }
                                            Text(job.name).font(.system(size: 14, weight: .semibold))
                                        }
                                        Text(job.address)
                                            .font(.system(size: 12))
                                            .foregroundStyle(FieldTheme.muted)
                                    }
                                    Spacer()
                                    Text(job.at)
                                        .font(FieldTheme.mono)
                                        .foregroundStyle(FieldTheme.faint)
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
                searchDraft = ""
                await session.loadToday(api: api)
            }

            Button {
                Task { await session.startDay() }
            } label: {
                Label(
                    session.activeJobId == nil ? "Start the day" : "Start filming selected job",
                    systemImage: "video.fill"
                )
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

    private var searchField: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Find any job")
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(FieldTheme.faint)
                .textCase(.uppercase)
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(FieldTheme.faint)
                TextField(
                    "Address, job #, title, claim…",
                    text: $searchDraft
                )
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.search)
                .onSubmit { runSearch(immediate: true) }
                if !searchDraft.isEmpty {
                    Button("Clear") {
                        searchDraft = ""
                        searchTask?.cancel()
                        Task { await session.loadToday(api: api) }
                    }
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(FieldTheme.muted)
                }
            }
            .padding(12)
            .background(FieldTheme.panel)
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(FieldTheme.line))
            .cornerRadius(10)
            .onChange(of: searchDraft) { _, _ in
                runSearch(immediate: false)
            }
            Text("Use this when something comes up that you were not assigned to — pick the job, then start filming.")
                .font(.system(size: 12))
                .foregroundStyle(FieldTheme.muted)
        }
    }

    private func runSearch(immediate: Bool) {
        searchTask?.cancel()
        searchTask = Task {
            if !immediate {
                try? await Task.sleep(nanoseconds: 320_000_000)
            }
            guard !Task.isCancelled else { return }
            await session.searchJobs(api: api, query: searchDraft)
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
                if let email = auth.email {
                    Text(email)
                }
                Text("Connected — you only set this up once")
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
