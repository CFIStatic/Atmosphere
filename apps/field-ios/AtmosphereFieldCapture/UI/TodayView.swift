import SwiftUI

struct TodayView: View {
    @EnvironmentObject private var session: FieldDaySession
    @EnvironmentObject private var auth: AuthSession
    @EnvironmentObject private var api: AtmosphereClient

    @State private var showQuickAdd = false
    @State private var quickAddTitle = ""
    @State private var quickAddBusy = false

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
                        "One button, once a day. Tap when you get to your first job and hold when you are done. Got a call and the office has not opened a file? Tap + Quick Add, name the job, and film — they finish the details later."
                    )
                    .font(.system(size: 15))
                    .foregroundStyle(FieldTheme.muted)

                    VStack(alignment: .leading, spacing: 8) {
                        Text("What today expects of you")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(FieldTheme.faint)
                            .textCase(.uppercase)

                        if session.loadingJobs {
                            Text("Loading jobs from your account…")
                                .font(.system(size: 13))
                                .foregroundStyle(FieldTheme.muted)
                        } else if session.jobs.isEmpty {
                            emptyQuickAddCard
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

                        if !session.jobs.isEmpty {
                            Button {
                                openQuickAdd()
                            } label: {
                                HStack(spacing: 8) {
                                    Image(systemName: "plus")
                                        .font(.system(size: 14, weight: .bold))
                                    Text("Quick Add — name a job from a call")
                                        .font(.system(size: 14, weight: .semibold))
                                    Spacer()
                                }
                                .foregroundStyle(FieldTheme.accent)
                                .padding(12)
                                .background(FieldTheme.panel)
                                .overlay(
                                    RoundedRectangle(cornerRadius: 10)
                                        .stroke(FieldTheme.accent.opacity(0.45), style: StrokeStyle(lineWidth: 1, dash: [5, 4]))
                                )
                                .cornerRadius(10)
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("Quick Add job")
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
        .sheet(isPresented: $showQuickAdd) {
            quickAddSheet
        }
    }

    private var emptyQuickAddCard: some View {
        Button {
            openQuickAdd()
        } label: {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 10) {
                    Image(systemName: "plus")
                        .font(.system(size: 18, weight: .bold))
                        .foregroundStyle(FieldTheme.bg)
                        .frame(width: 36, height: 36)
                        .background(FieldTheme.accent)
                        .clipShape(Circle())
                    Text("Quick Add")
                        .font(.system(size: 17, weight: .bold))
                        .foregroundStyle(FieldTheme.ink)
                }
                Text("No open jobs yet. Name the job from the call and start filming — the office will see the file and can finish address and scope later.")
                    .font(.system(size: 13.5))
                    .foregroundStyle(FieldTheme.muted)
                    .multilineTextAlignment(.leading)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14)
            .background(FieldTheme.panel)
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(FieldTheme.accent))
            .cornerRadius(12)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Quick Add job")
    }

    private var quickAddSheet: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                Text("Name the job so the office sees a file. Then film — they can fill in address and scope later.")
                    .font(.system(size: 14))
                    .foregroundStyle(FieldTheme.muted)

                TextField("Job name", text: $quickAddTitle)
                    .textInputAutocapitalization(.sentences)
                    .submitLabel(.go)
                    .onSubmit {
                        Task { await submitQuickAdd(andStart: true) }
                    }
                    .padding(12)
                    .background(FieldTheme.panel)
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(FieldTheme.line))
                    .cornerRadius(10)

                Button {
                    Task { await submitQuickAdd(andStart: true) }
                } label: {
                    HStack {
                        if quickAddBusy { ProgressView() }
                        Label(
                            quickAddBusy ? "Starting…" : "Add & start filming",
                            systemImage: "video.fill"
                        )
                        .font(.system(size: 16, weight: .bold))
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(FieldTheme.ink)
                    .foregroundStyle(FieldTheme.bg)
                    .cornerRadius(12)
                }
                .disabled(quickAddBusy || quickAddTitle.trimmingCharacters(in: .whitespacesAndNewlines).count < 2)

                Button {
                    Task { await submitQuickAdd(andStart: false) }
                } label: {
                    Text("Add job only")
                        .font(.system(size: 14, weight: .semibold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .foregroundStyle(FieldTheme.muted)
                }
                .disabled(quickAddBusy || quickAddTitle.trimmingCharacters(in: .whitespacesAndNewlines).count < 2)

                Spacer()
            }
            .padding(18)
            .background(FieldTheme.bg.ignoresSafeArea())
            .navigationTitle("Quick Add")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { showQuickAdd = false }
                        .disabled(quickAddBusy)
                }
            }
        }
        .presentationDetents([.medium])
        .interactiveDismissDisabled(quickAddBusy)
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
            Button {
                openQuickAdd()
            } label: {
                Image(systemName: "plus")
                    .font(.system(size: 17, weight: .bold))
                    .foregroundStyle(FieldTheme.bg)
                    .frame(width: 38, height: 38)
                    .background(FieldTheme.accent)
                    .clipShape(Circle())
            }
            .accessibilityLabel("Quick Add job")
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

    private func openQuickAdd() {
        quickAddTitle = ""
        showQuickAdd = true
    }

    private func submitQuickAdd(andStart: Bool) async {
        quickAddBusy = true
        defer { quickAddBusy = false }
        if andStart {
            await session.quickAddAndStart(title: quickAddTitle, api: api)
        } else {
            _ = await session.quickAdd(title: quickAddTitle, api: api)
        }
        if session.lastError == nil {
            showQuickAdd = false
        }
    }
}
