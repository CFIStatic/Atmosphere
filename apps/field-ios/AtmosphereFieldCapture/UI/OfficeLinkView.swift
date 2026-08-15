import SwiftUI

/**
 * Shown when this phone is signed in but the login is not in an office yet.
 * Same join-or-create choice as signup step 2.
 */
struct OfficeLinkView: View {
    @EnvironmentObject private var auth: AuthSession
    @State private var mode: Mode = .join
    @State private var joinCode = ""
    @State private var orgName = ""
    @State private var busy = false

    private enum Mode {
        case join
        case create
    }

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
                        .tracking(-0.4)
                }
                .padding(.top, 36)

                Text("Field Capture")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(FieldTheme.muted)

                Text("Link this phone to an office")
                    .font(.system(size: 22, weight: .bold))
                    .foregroundStyle(FieldTheme.ink)
                    .padding(.top, 10)

                Text(
                    "You’re signed in as \(auth.email ?? "this account"), but this login is not in an office yet. Join with a code or start a new office."
                )
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
                    TextField("Office join code", text: $joinCode)
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                        .padding(12)
                        .background(FieldTheme.panel)
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(FieldTheme.line))
                        .cornerRadius(10)
                } else {
                    TextField("Office name", text: $orgName)
                        .textContentType(.organizationName)
                        .padding(12)
                        .background(FieldTheme.panel)
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(FieldTheme.line))
                        .cornerRadius(10)
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
                            Text("Connect to office").fontWeight(.bold)
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
            .padding(22)
        }
        .background(FieldTheme.bg.ignoresSafeArea())
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
