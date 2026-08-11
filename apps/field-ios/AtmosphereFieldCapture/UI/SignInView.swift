import SwiftUI

/**
 * Account gate for Field Capture — **Sign in** or **Create account**.
 *
 * Same Atmosphere auth as the website. Create account can join a company with
 * an office join code, or start a new company for Field Capture.
 */
struct SignInView: View {
    enum Mode: String, CaseIterable, Identifiable {
        case signIn = "Sign in"
        case createAccount = "Create account"
        var id: String { rawValue }
    }

    enum OrgChoice: String, CaseIterable, Identifiable {
        case join = "Join company"
        case create = "Start company"
        var id: String { rawValue }
    }

    @EnvironmentObject private var auth: AuthSession
    @State private var mode: Mode = .signIn
    @State private var orgChoice: OrgChoice = .join
    @State private var fullName = ""
    @State private var email = ""
    @State private var password = ""
    @State private var confirmPassword = ""
    @State private var joinCode = ""
    @State private var companyName = ""
    @State private var apiBase = ApiConfig.resolvedBaseString()
    @State private var showServer = false
    @State private var busy = false

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

                if auth.needsOrgSetup {
                    orgSetupBlock
                } else {
                    authBlock
                }
            }
            .padding(22)
        }
        .background(FieldTheme.bg.ignoresSafeArea())
    }

    // MARK: - Sign in / Create account

    private var authBlock: some View {
        VStack(alignment: .leading, spacing: 14) {
            Picker("Mode", selection: $mode) {
                ForEach(Mode.allCases) { item in
                    Text(item.rawValue).tag(item)
                }
            }
            .pickerStyle(.segmented)
            .padding(.top, 10)

            Text(mode == .signIn ? "Sign in with your Atmosphere account" : "Create your Atmosphere account")
                .font(.system(size: 22, weight: .bold))
                .foregroundStyle(FieldTheme.ink)

            Text(
                mode == .signIn
                    ? "Use the same email and password as the Atmosphere website. You only connect this phone once — after that it stays signed in."
                    : "Create an account here, then join your company with a code from the office — or start a new company for Field Capture."
            )
            .font(.system(size: 14))
            .foregroundStyle(FieldTheme.muted)

            VStack(spacing: 10) {
                if mode == .createAccount {
                    TextField("Your name", text: $fullName)
                        .textContentType(.name)
                        .padding(12)
                        .background(FieldTheme.panel)
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(FieldTheme.line))
                        .cornerRadius(10)
                }

                TextField("Work email", text: $email)
                    .textContentType(.username)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .padding(12)
                    .background(FieldTheme.panel)
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(FieldTheme.line))
                    .cornerRadius(10)

                SecureField(mode == .createAccount ? "Password (8+ characters)" : "Password", text: $password)
                    .textContentType(mode == .createAccount ? .newPassword : .password)
                    .padding(12)
                    .background(FieldTheme.panel)
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(FieldTheme.line))
                    .cornerRadius(10)

                if mode == .createAccount {
                    SecureField("Confirm password", text: $confirmPassword)
                        .textContentType(.newPassword)
                        .padding(12)
                        .background(FieldTheme.panel)
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(FieldTheme.line))
                        .cornerRadius(10)

                    orgChoiceFields
                }
            }
            .padding(.top, 4)

            serverDisclosure
            messages

            Button {
                submitAuth()
            } label: {
                Group {
                    if busy {
                        ProgressView().tint(FieldTheme.bg)
                    } else {
                        Text(mode == .signIn ? "Sign in & connect phone" : "Create account & connect")
                            .fontWeight(.bold)
                    }
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .background(FieldTheme.ink)
                .foregroundStyle(FieldTheme.bg)
                .cornerRadius(12)
            }
            .disabled(busy || !canSubmitAuth)
            .padding(.top, 6)

            Text(
                mode == .signIn
                    ? "After this, you won’t be asked again on this phone."
                    : "Subcontractors working for a GC should use their job invite link instead of creating a Field Capture seat here."
            )
            .font(.system(size: 12))
            .foregroundStyle(FieldTheme.faint)
        }
    }

    // MARK: - Org setup (after signup/login without a company)

    private var orgSetupBlock: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Join your company")
                .font(.system(size: 22, weight: .bold))
                .foregroundStyle(FieldTheme.ink)
                .padding(.top, 10)

            Text(
                "You’re signed in as \(auth.email ?? "your account"). Field Capture needs a company — join with a code from the office, or start a new one."
            )
            .font(.system(size: 14))
            .foregroundStyle(FieldTheme.muted)

            orgChoiceFields
            messages

            Button {
                submitOrgSetup()
            } label: {
                Group {
                    if busy {
                        ProgressView().tint(FieldTheme.bg)
                    } else {
                        Text("Continue").fontWeight(.bold)
                    }
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .background(FieldTheme.ink)
                .foregroundStyle(FieldTheme.bg)
                .cornerRadius(12)
            }
            .disabled(busy || !canSubmitOrg)
            .padding(.top, 6)

            Button("Sign out and start over") {
                Task { await auth.disconnectAccount() }
            }
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(FieldTheme.muted)
        }
    }

    private var orgChoiceFields: some View {
        VStack(alignment: .leading, spacing: 10) {
            Picker("Company", selection: $orgChoice) {
                ForEach(OrgChoice.allCases) { item in
                    Text(item.rawValue).tag(item)
                }
            }
            .pickerStyle(.segmented)

            if orgChoice == .join {
                TextField("Company join code", text: $joinCode)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    .padding(12)
                    .background(FieldTheme.panel)
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(FieldTheme.line))
                    .cornerRadius(10)
                Text("Ask the office for the Atmosphere join code (Settings → Team).")
                    .font(.system(size: 12))
                    .foregroundStyle(FieldTheme.faint)
            } else {
                TextField("Company name", text: $companyName)
                    .textContentType(.organizationName)
                    .padding(12)
                    .background(FieldTheme.panel)
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(FieldTheme.line))
                    .cornerRadius(10)
                Text("Starts a new Atmosphere organization with you on Field Capture.")
                    .font(.system(size: 12))
                    .foregroundStyle(FieldTheme.faint)
            }
        }
    }

    private var serverDisclosure: some View {
        DisclosureGroup(isExpanded: $showServer) {
            VStack(alignment: .leading, spacing: 6) {
                Text("Atmosphere API (same backend as the website)")
                    .font(.system(size: 12))
                    .foregroundStyle(FieldTheme.faint)
                TextField("https://your-atmosphere-host", text: $apiBase)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)
                    .padding(12)
                    .background(FieldTheme.panel)
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(FieldTheme.line))
                    .cornerRadius(10)
                Text("Example for a Mac running the API locally: http://127.0.0.1:4000")
                    .font(.system(size: 11))
                    .foregroundStyle(FieldTheme.faint)
            }
            .padding(.top, 8)
        } label: {
            Text("Server")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(FieldTheme.muted)
        }
    }

    @ViewBuilder
    private var messages: some View {
        if let info = auth.infoMessage {
            Text(info)
                .font(.system(size: 13))
                .foregroundStyle(FieldTheme.muted)
        }
        if let err = auth.lastError {
            Text(err)
                .font(.system(size: 13))
                .foregroundStyle(FieldTheme.rec)
        }
    }

    private var canSubmitAuth: Bool {
        let mail = !email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        let pass = password.count >= (mode == .createAccount ? 8 : 1)
        let base = !apiBase.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        guard mail && pass && base else { return false }
        if mode == .createAccount {
            guard password == confirmPassword else { return false }
            return canSubmitOrg
        }
        return true
    }

    private var canSubmitOrg: Bool {
        if orgChoice == .join {
            return joinCode.trimmingCharacters(in: .whitespacesAndNewlines).count >= 6
        }
        return companyName.trimmingCharacters(in: .whitespacesAndNewlines).count >= 2
    }

    private func submitAuth() {
        busy = true
        Task {
            if mode == .signIn {
                await auth.connectAccount(
                    email: email.trimmingCharacters(in: .whitespacesAndNewlines),
                    password: password,
                    apiBase: apiBase
                )
            } else {
                if password != confirmPassword {
                    auth.lastError = "Passwords do not match."
                    busy = false
                    return
                }
                if password.count < 8 {
                    auth.lastError = "Password must be at least 8 characters."
                    busy = false
                    return
                }
                await auth.createAccount(
                    fullName: fullName,
                    email: email.trimmingCharacters(in: .whitespacesAndNewlines),
                    password: password,
                    apiBase: apiBase,
                    joinCode: orgChoice == .join ? joinCode : nil,
                    newCompanyName: orgChoice == .create ? companyName : nil
                )
                if auth.infoMessage != nil, auth.needsOrgSetup == false, auth.isLinked == false {
                    mode = .signIn
                }
            }
            busy = false
        }
    }

    private func submitOrgSetup() {
        busy = true
        Task {
            await auth.completeOrgSetup(
                joinCode: orgChoice == .join ? joinCode : nil,
                newCompanyName: orgChoice == .create ? companyName : nil
            )
            busy = false
        }
    }
}
