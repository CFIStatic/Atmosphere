import SwiftUI

/**
 * Link this Field Capture login to an office account.
 *
 * Primary path: enter the office join code from Atmosphere Settings.
 * Shown after signup, after sign-in without an org, from Account, or from
 * an `atmosphere-field://join?code=` link.
 */
struct OfficeLinkView: View {
    @EnvironmentObject private var auth: AuthSession
    @State private var mode: Mode = .join
    @State private var joinCode = ""
    @State private var orgName = ""
    @State private var busy = false
    @State private var previewTask: Task<Void, Never>?

    private enum Mode {
        case join
        case create
    }

    private var canCancel: Bool { !auth.needsOfficeLink }

    private var canSubmit: Bool {
        switch mode {
        case .join:
            let code = joinCode.trimmingCharacters(in: .whitespacesAndNewlines)
            return (6 ... 12).contains(code.count)
        case .create:
            return orgName.trimmingCharacters(in: .whitespacesAndNewlines).count >= 2
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .center, spacing: 10) {
                    AtmosphereBarsMark(size: 28)
                    Text("Atmosphere")
                        .font(.system(size: 28, weight: .bold))
                        .foregroundStyle(FieldTheme.ink)
                }
                .padding(.top, 36)

                Text("Field Capture")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(FieldTheme.muted)

                Text("Link to office account")
                    .font(.system(size: 22, weight: .bold))
                    .foregroundStyle(FieldTheme.ink)
                    .padding(.top, 10)

                Text(lede)
                    .font(.system(size: 14))
                    .foregroundStyle(FieldTheme.muted)

                if let err = auth.lastError {
                    Text(err)
                        .font(.system(size: 13))
                        .foregroundStyle(FieldTheme.rec)
                }

                HStack(spacing: 8) {
                    modeButton("Join an office", selected: mode == .join) { mode = .join }
                    modeButton("Start a new office", selected: mode == .create) { mode = .create }
                }
                .padding(.top, 4)

                if mode == .join {
                    TextField("Office join code", text: Binding(
                        get: { joinCode },
                        set: { value in
                            joinCode = value
                            previewTask?.cancel()
                            previewTask = Task {
                                try? await Task.sleep(nanoseconds: 350_000_000)
                                guard !Task.isCancelled else { return }
                                await auth.previewOffice(joinCode: value)
                            }
                        }
                    ))
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                        .padding(12)
                        .background(FieldTheme.panel)
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(FieldTheme.line))
                        .cornerRadius(10)

                    if let name = auth.officePreviewName, mode == .join {
                        Text("This code belongs to \(name).")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(FieldTheme.pass)
                    } else {
                        Text("Ask the office for the 6–12 character code in Atmosphere → Settings → Organization.")
                            .font(.system(size: 12))
                            .foregroundStyle(FieldTheme.faint)
                    }
                } else {
                    TextField("Office name", text: $orgName)
                        .textContentType(.organizationName)
                        .padding(12)
                        .background(FieldTheme.panel)
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(FieldTheme.line))
                        .cornerRadius(10)
                    Text("Only if this company does not have an Atmosphere office yet. You can invite the crew from the website with a join code.")
                        .font(.system(size: 12))
                        .foregroundStyle(FieldTheme.faint)
                }

                Button {
                    busy = true
                    Task {
                        await auth.linkOffice(
                            joinCode: mode == .join
                                ? joinCode.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
                                : nil,
                            orgName: mode == .create
                                ? orgName.trimmingCharacters(in: .whitespacesAndNewlines)
                                : nil
                        )
                        busy = false
                    }
                } label: {
                    Group {
                        if busy {
                            ProgressView().tint(FieldTheme.bg)
                        } else {
                            Text(mode == .join ? "Link to office account" : "Start office & connect phone")
                                .font(.system(size: 16, weight: .bold))
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(FieldTheme.ink)
                    .foregroundStyle(FieldTheme.bg)
                    .cornerRadius(12)
                }
                .disabled(busy || !canSubmit)
                .padding(.top, 6)

                if canCancel {
                    Button {
                        auth.cancelOfficeLink()
                    } label: {
                        Text("Cancel")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(FieldTheme.muted)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 8)
                    }
                    .disabled(busy)
                } else {
                    Button {
                        Task { await auth.disconnectAccount() }
                    } label: {
                        Text("Use a different account")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(FieldTheme.muted)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 8)
                    }
                    .disabled(busy)
                }
            }
            .padding(22)
        }
        .background(FieldTheme.bg.ignoresSafeArea())
        .onAppear {
            if let pending = auth.pendingJoinCode, !pending.isEmpty {
                joinCode = pending
                mode = .join
                Task { await auth.previewOffice(joinCode: pending) }
            }
        }
    }

    private var lede: String {
        if let email = auth.email, auth.needsOfficeLink {
            return "You’re signed in as \(email). Enter the office join code so this phone files day films to that company."
        }
        if let current = auth.orgName, !auth.needsOfficeLink {
            return "This phone is linked to \(current). Enter a different office code to move this login, or cancel."
        }
        return "Enter the office join code from Atmosphere Settings so this login belongs to that company."
    }

    private func modeButton(_ title: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 13, weight: .semibold))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
                .background(selected ? FieldTheme.ink : FieldTheme.panel)
                .foregroundStyle(selected ? FieldTheme.bg : FieldTheme.ink)
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(FieldTheme.line))
                .cornerRadius(10)
        }
        .buttonStyle(.plain)
    }
}
