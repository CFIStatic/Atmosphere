import SwiftUI

/**
 * Create an Atmosphere account from Field Capture.
 *
 * Same email + password as the website. Step 2 links the new login to an
 * office (join code) or starts a new office so day films have somewhere to go.
 */
struct SignUpView: View {
    @EnvironmentObject private var auth: AuthSession
    var onSignIn: () -> Void = {}

    @State private var step = 1
    @State private var fullName = ""
    @State private var email = ""
    @State private var password = ""
    @State private var mode: OfficeMode = .join
    @State private var joinCode = ""
    @State private var orgName = ""
    @State private var busy = false

    private enum OfficeMode {
        case join
        case create
    }

    private var emailValid: Bool {
        let trimmed = email.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.contains("@") && trimmed.contains(".")
    }

    private var step1Valid: Bool {
        fullName.trimmingCharacters(in: .whitespacesAndNewlines).count >= 2
            && emailValid
            && password.count >= 8
    }

    private var step2Valid: Bool {
        switch mode {
        case .join:
            let code = joinCode.trimmingCharacters(in: .whitespacesAndNewlines)
            return (6 ... 12).contains(code.count) && code.allSatisfy { $0.isLetter || $0.isNumber }
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

                Text(step == 1 ? "Create your account" : "Link this phone to an office")
                    .font(.system(size: 22, weight: .bold))
                    .foregroundStyle(FieldTheme.ink)
                    .padding(.top, 10)

                Text(
                    step == 1
                        ? "This is the same login you will use on the Atmosphere website. Password must be at least 8 characters."
                        : "Join your crew with the office code, or start a new office from this phone."
                )
                .font(.system(size: 14))
                .foregroundStyle(FieldTheme.muted)

                Text("Step \(step) of 2")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(FieldTheme.faint)
                    .textCase(.uppercase)

                if let notice = auth.confirmationNotice {
                    Text(notice)
                        .font(.system(size: 13))
                        .foregroundStyle(FieldTheme.pass)
                }

                if let err = auth.lastError {
                    Text(err)
                        .font(.system(size: 13))
                        .foregroundStyle(FieldTheme.rec)
                }

                if step == 1 {
                    accountFields
                } else {
                    officeFields
                }

                Button {
                    if step == 1 {
                        step = 2
                        return
                    }
                    busy = true
                    Task {
                        await auth.createAccount(
                            email: email.trimmingCharacters(in: .whitespacesAndNewlines),
                            password: password,
                            fullName: fullName.trimmingCharacters(in: .whitespacesAndNewlines),
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
                            Text(step == 1 ? "Continue" : "Create account & connect phone")
                                .fontWeight(.bold)
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(FieldTheme.ink)
                    .foregroundStyle(FieldTheme.bg)
                    .cornerRadius(12)
                }
                .disabled(busy || (step == 1 ? !step1Valid : !step2Valid))
                .padding(.top, 6)

                if step == 2 {
                    Button {
                        step = 1
                    } label: {
                        Text("Back")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(FieldTheme.muted)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 6)
                    }
                    .disabled(busy)
                }

                Button(action: onSignIn) {
                    Text("Already have an account? Sign in")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(FieldTheme.accent)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                }
                .disabled(busy)
            }
            .padding(22)
        }
        .background(FieldTheme.bg.ignoresSafeArea())
        .onAppear {
            if let pending = auth.pendingJoinCode, !pending.isEmpty {
                joinCode = pending
                mode = .join
                step = 2
            }
        }
    }

    private var accountFields: some View {
        VStack(spacing: 10) {
            TextField("First and last name", text: $fullName)
                .textContentType(.name)
                .padding(12)
                .background(FieldTheme.panel)
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(FieldTheme.line))
                .cornerRadius(10)

            TextField("Work email", text: $email)
                .textContentType(.username)
                .keyboardType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .padding(12)
                .background(FieldTheme.panel)
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(FieldTheme.line))
                .cornerRadius(10)

            SecureField("Password (min. 8 characters)", text: $password)
                .textContentType(.newPassword)
                .padding(12)
                .background(FieldTheme.panel)
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(FieldTheme.line))
                .cornerRadius(10)
        }
        .padding(.top, 4)
    }

    private var officeFields: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                modeButton("Join an office", selected: mode == .join) { mode = .join }
                modeButton("Start a new office", selected: mode == .create) { mode = .create }
            }

            if mode == .join {
                TextField("Office join code", text: $joinCode)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    .padding(12)
                    .background(FieldTheme.panel)
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(FieldTheme.line))
                    .cornerRadius(10)
                Text("Ask the office for the 6–12 character code from Atmosphere Settings.")
                    .font(.system(size: 12))
                    .foregroundStyle(FieldTheme.faint)
            } else {
                TextField("Office name", text: $orgName)
                    .textContentType(.organizationName)
                    .padding(12)
                    .background(FieldTheme.panel)
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(FieldTheme.line))
                    .cornerRadius(10)
                Text("You can invite the rest of the crew from the website with a join code.")
                    .font(.system(size: 12))
                    .foregroundStyle(FieldTheme.faint)
            }
        }
        .padding(.top, 4)
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
