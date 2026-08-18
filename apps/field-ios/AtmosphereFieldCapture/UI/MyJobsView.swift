import SwiftUI

struct MyJobsView: View {
    @EnvironmentObject private var session: FieldDaySession
    @EnvironmentObject private var api: AtmosphereClient

    private var filtered: [ExpectedJob] {
        session.assignedJobs.filter { $0.matches(session.jobSearch) }
    }

    var body: some View {
        VStack(spacing: 0) {
            FieldHeader()
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    Text("My jobs")
                        .font(.system(size: 28, weight: .bold))
                        .foregroundStyle(FieldTheme.ink)

                    Text(
                        "A historical record of every job this login has filmed. Search by name, address, job number, status, date, or role."
                    )
                    .font(.system(size: 15))
                    .foregroundStyle(FieldTheme.muted)

                    Button {
                        session.beginInvite()
                    } label: {
                        Text("Accept a job invite")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(FieldTheme.accent)
                    }

                    searchField

                    if session.loadingJobs {
                        Text("Loading your record…")
                            .font(.system(size: 13))
                            .foregroundStyle(FieldTheme.muted)
                    } else if session.assignedJobs.isEmpty {
                        Text("No filmed jobs yet. Finish a day on Today and it lands here as a record. Assigned work that has not been filmed stays on Today.")
                            .font(.system(size: 13))
                            .foregroundStyle(FieldTheme.muted)
                        Button("Go to Today") {
                            session.tab = .today
                        }
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(FieldTheme.accent)
                    } else if filtered.isEmpty {
                        Text("Nothing in the record matches “\(session.jobSearch)”. Try the job name, street, city, job number, or a filmed date.")
                            .font(.system(size: 13))
                            .foregroundStyle(FieldTheme.muted)
                    } else {
                        Text("\(filtered.count) recorded")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(FieldTheme.faint)
                            .textCase(.uppercase)

                        ForEach(filtered) { job in
                            FieldJobCard(job: job, selected: session.activeJobId == job.id) {
                                session.selectJob(job.id)
                            }
                        }
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
                await session.refreshHistory(api: api)
            }
        }
        .background(FieldTheme.bg)
    }

    private var searchField: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(FieldTheme.faint)
            TextField("Search name, address, job #…", text: $session.jobSearch)
                .font(.system(size: 16))
                .disableAutocorrection(true)
            if !session.jobSearch.isEmpty {
                Button {
                    session.jobSearch = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(FieldTheme.faint)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Clear search")
            }
        }
        .padding(12)
        .background(FieldTheme.panel)
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(FieldTheme.line))
        .cornerRadius(10)
    }
}
