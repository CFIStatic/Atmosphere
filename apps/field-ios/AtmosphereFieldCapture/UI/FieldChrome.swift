import SwiftUI

struct FieldHeader: View {
    @EnvironmentObject private var session: FieldDaySession
    @EnvironmentObject private var auth: AuthSession

    var body: some View {
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
                        session.assignedJobs = []
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

struct FieldJobCard: View {
    let job: ExpectedJob
    let selected: Bool
    var onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(job.name).font(.system(size: 14, weight: .semibold))
                    Text(job.address)
                        .font(.system(size: 12))
                        .foregroundStyle(FieldTheme.muted)
                    if !job.number.isEmpty {
                        Text(job.number)
                            .font(.system(size: 11, weight: .medium, design: .monospaced))
                            .foregroundStyle(FieldTheme.faint)
                    }
                    Text(job.roleLabel)
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(FieldTheme.faint)
                }
                Spacer()
                Text(job.filmed == true ? (job.filmedOn ?? job.at) : job.at)
                    .font(FieldTheme.mono)
                    .foregroundStyle(job.filmed == true ? FieldTheme.pass : FieldTheme.faint)
                if selected {
                    Text("●")
                        .foregroundStyle(FieldTheme.accent)
                        .font(.system(size: 10))
                }
            }
            .padding(12)
            .background(FieldTheme.panel)
            .overlay(
                RoundedRectangle(cornerRadius: 10)
                    .stroke(selected ? FieldTheme.accent : FieldTheme.line)
            )
            .cornerRadius(10)
        }
        .buttonStyle(.plain)
        .foregroundStyle(FieldTheme.ink)
    }
}

struct FieldShellView: View {
    @EnvironmentObject private var session: FieldDaySession

    var body: some View {
        TabView(selection: $session.tab) {
            TodayView()
                .tabItem { Label("Today", systemImage: "sun.max.fill") }
                .tag(FieldTab.today)
            MyJobsView()
                .tabItem { Label("My jobs", systemImage: "list.bullet") }
                .tag(FieldTab.jobs)
            AddJobView()
                .tabItem { Label("Add job", systemImage: "plus.circle.fill") }
                .tag(FieldTab.add)
        }
        .accentColor(FieldTheme.accent)
    }
}
