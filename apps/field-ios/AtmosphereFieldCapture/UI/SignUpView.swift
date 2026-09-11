import SwiftUI

/**
 * Create an Atmosphere account from Field Capture.
 *
 * Same email + password as the website. A pending office invite for this
 * email joins that company automatically.
 */
struct SignUpView: View {
    @EnvironmentObject private var auth: AuthSession
    var onSignIn: () -> Void = {}

    @State private var fullName = ""
    @State private var email = ""
    @State private var password = ""
    @State private var busy = false
    @State private var acknowledgedTerms = false

    private var emailValid: Bool {
        let trimmed = email.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.contains("@") && trimmed.contains(".")
    }

    private var formValid: Bool {
        fullName.trimmingCharacters(in: .whitespacesAndNewlines).count >= 2
            && emailValid
            && password.count >= 8
            && acknowledgedTerms
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

                Text("Create your account")
                    .font(.system(size: 22, weight: .bold))
                    .foregroundStyle(FieldTheme.ink)
                    .padding(.top, 10)

                Text(
                    "This is the same login you will use on the Atmosphere website. Use the email your Global Admin invited. Password must be at least 8 characters."
                )
                .font(.system(size: 14))
                .foregroundStyle(FieldTheme.muted)

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

                    TermsAckToggle(acknowledged: $acknowledgedTerms)
                }
                .padding(.top, 4)

                Button {
                    busy = true
                    Task {
                        await auth.createAccount(
                            email: email.trimmingCharacters(in: .whitespacesAndNewlines),
                            password: password,
                            fullName: fullName.trimmingCharacters(in: .whitespacesAndNewlines)
                        )
                        busy = false
                    }
                } label: {
                    Group {
                        if busy {
                            ProgressView().tint(FieldTheme.bg)
                        } else {
                            Text("Create account")
                                .font(.system(size: 16, weight: .bold))
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(FieldTheme.ink)
                    .foregroundStyle(FieldTheme.bg)
                    .cornerRadius(12)
                }
                .disabled(busy || !formValid)
                .padding(.top, 6)

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
    }
}
