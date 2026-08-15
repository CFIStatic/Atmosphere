import SwiftUI

/// Opened from an office invite — no office login required to start.
struct InviteJobView: View {
    @EnvironmentObject private var session: FieldDaySession
    @EnvironmentObject private var api: AtmosphereClient
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

                Text("Invite")
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

                    if job.clear != true {
                        TextField("Your name", text: $session.acceptName)
                            .padding(12)
                            .background(FieldTheme.panel)
                            .overlay(RoundedRectangle(cornerRadius: 10).stroke(FieldTheme.line))
                            .cornerRadius(10)
                        Button {
                            Task {
                                if await session.acceptBrief(api: api) {
                                    onDismiss()
                                }
                            }
                        } label: {
                            Text(session.acceptingBrief ? "Accepting…" : "Accept the brief")
                                .font(.system(size: 16, weight: .bold))
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 14)
                                .background(FieldTheme.ink)
                                .foregroundStyle(FieldTheme.bg)
                                .cornerRadius(12)
                        }
                        .disabled(session.acceptingBrief)
                    } else {
                        Button {
                            session.showInvite = false
                            session.tab = .today
                            session.phase = .today
                            onDismiss()
                        } label: {
                            Text("Start this job")
                                .font(.system(size: 16, weight: .bold))
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 14)
                                .background(FieldTheme.ink)
                                .foregroundStyle(FieldTheme.bg)
                                .cornerRadius(12)
                        }
                    }
                } else {
                    Text("Paste the invite from your email")
                        .font(.system(size: 22, weight: .bold))
                    Text("The office sent a link. Paste it here — no login needed to review the brief and film.")
                        .font(.system(size: 14))
                        .foregroundStyle(FieldTheme.muted)
                    TextField("Invite link or token", text: $session.acceptName)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .padding(12)
                        .background(FieldTheme.panel)
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(FieldTheme.line))
                        .cornerRadius(10)
                    Button {
                        Task { await session.openInvite(api: api, raw: session.acceptName) }
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
    }
}
