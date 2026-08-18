import SwiftUI

/// Accept a job invite onto this signed-in account. Shown inside the app, not on sign-in.
struct InviteJobView: View {
    @EnvironmentObject private var session: FieldDaySession
    @EnvironmentObject private var api: AtmosphereClient
    @EnvironmentObject private var auth: AuthSession
    var onDismiss: () -> Void = {}

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack(spacing: 10) {
                    AtmosphereBarsMark(size: 28)
                    Text("Atmosphere")
                        .font(.system(size: 28, weight: .bold))
                        .foregroundStyle(FieldTheme.ink)
                }
                .padding(.top, 28)

                Text("Accept a job")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(FieldTheme.muted)

                if let job = session.shareJob {
                    Text(job.job.title ?? "Job")
                        .font(.system(size: 26, weight: .bold))
                        .foregroundStyle(FieldTheme.ink)
                    if let company = job.you?.company, !company.isEmpty {
                        Text(company)
                            .font(.system(size: 14))
                            .foregroundStyle(FieldTheme.muted)
                    }
                    Text("This job will be added to \(auth.email ?? "this login") — Today for this account.")
                        .font(.system(size: 14))
                        .foregroundStyle(FieldTheme.muted)

                    if let because = job.because, job.clear == false {
                        Text(because)
                            .font(.system(size: 14))
                            .foregroundStyle(FieldTheme.accent)
                    }

                    if let note = job.brief?.note, !note.isEmpty {
                        Text(note)
                            .font(.system(size: 15))
                            .foregroundStyle(FieldTheme.ink)
                    }

                    if let scope = job.scope, !scope.isEmpty {
                        Text("Scope")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(FieldTheme.faint)
                            .textCase(.uppercase)
                        ForEach(scope) { item in
                            VStack(alignment: .leading, spacing: 4) {
                                Text((item.state ?? "included").replacingOccurrences(of: "_", with: " ").uppercased())
                                    .font(.system(size: 10, weight: .bold))
                                    .foregroundStyle(item.state == "excluded" ? FieldTheme.rec : FieldTheme.faint)
                                Text(item.title)
                                    .font(.system(size: 15, weight: .semibold))
                                if let detail = item.detail, !detail.isEmpty {
                                    Text(detail).font(.system(size: 13)).foregroundStyle(FieldTheme.muted)
                                }
                            }
                            .padding(12)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(FieldTheme.panel)
                            .overlay(RoundedRectangle(cornerRadius: 10).stroke(FieldTheme.line))
                            .cornerRadius(10)
                        }
                    }

                    TextField("Your name", text: $session.acceptName)
                        .padding(12)
                        .background(FieldTheme.panel)
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(FieldTheme.line))
                        .cornerRadius(10)
                    Button {
                        Task {
                            if await session.acceptBrief(api: api, signedInName: auth.fullName) {
                                onDismiss()
                            }
                        }
                    } label: {
                        Text(session.acceptingBrief ? "Accepting…" : "Accept this job")
                            .font(.system(size: 16, weight: .bold))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 14)
                            .background(FieldTheme.ink)
                            .foregroundStyle(FieldTheme.bg)
                            .cornerRadius(12)
                    }
                    .disabled(session.acceptingBrief)
                } else {
                    Text("Paste a job invite")
                        .font(.system(size: 22, weight: .bold))
                    Text("The office sent a link for a job. Paste it here to add that job to this login. You can accept more than one.")
                        .font(.system(size: 14))
                        .foregroundStyle(FieldTheme.muted)
                    TextField("Invite link or token", text: $session.invitePaste)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .padding(12)
                        .background(FieldTheme.panel)
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(FieldTheme.line))
                        .cornerRadius(10)
                    Button {
                        Task { await session.openInvite(api: api, raw: session.invitePaste) }
                    } label: {
                        Text("Open invite")
                            .font(.system(size: 16, weight: .bold))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 14)
                            .background(FieldTheme.ink)
                            .foregroundStyle(FieldTheme.bg)
                            .cornerRadius(12)
                    }
                }

                if let err = session.lastError {
                    Text(err).font(.system(size: 13)).foregroundStyle(FieldTheme.rec)
                }

                Button("Not now") {
                    session.dismissInvite()
                    onDismiss()
                }
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(FieldTheme.muted)
                .frame(maxWidth: .infinity)
            }
            .padding(22)
        }
        .background(FieldTheme.bg.ignoresSafeArea())
        .onAppear {
            if session.acceptName.isEmpty, let name = auth.fullName, !name.isEmpty {
                session.acceptName = name
            }
        }
    }
}
