import SwiftUI

struct MyJobsView: View {
    @EnvironmentObject private var session: FieldDaySession
    @EnvironmentObject private var api: AtmosphereClient

    var body: some View {
        VStack(spacing: 0) {
            FieldHeader()
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    Text("Assigned to you")
                        .font(.system(size: 28, weight: .bold))
                        .foregroundStyle(FieldTheme.ink)

                    Text(
                        "These are the jobs the office put on you, plus any you opened from this phone. Tap one to film it today."
                    )
                    .font(.system(size: 15))
                    .foregroundStyle(FieldTheme.muted)

                    if session.loadingJobs {
                        Text("Loading your jobs…")
                            .font(.system(size: 13))
                            .foregroundStyle(FieldTheme.muted)
                    } else if session.assignedJobs.isEmpty {
                        Text("Nothing is assigned to you yet. Add a job from this phone, or ask the office to put you on a job.")
                            .font(.system(size: 13))
                            .foregroundStyle(FieldTheme.muted)
                        Button("Add a job") {
                            session.tab = .add
                        }
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(FieldTheme.accent)
                    }

                    ForEach(session.assignedJobs) { job in
                        FieldJobCard(job: job, selected: session.activeJobId == job.id) {
                            session.selectJob(job.id)
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
                await session.loadToday(api: api)
            }
        }
        .background(FieldTheme.bg)
    }
}
