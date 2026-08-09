import SwiftUI

/// Same Atmosphere credentials as the dashboard — links this phone to the org.
struct SignInView: View {
    @EnvironmentObject private var auth: AuthSession
    @State private var email = ""
    @State private var password = ""
    @State private var busy = false

    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 40)
            VStack(alignment: .leading, spacing: 14) {
                AtmosphereBarsMark(size: 36)
                Text("Atmosphere")
                    .font(.system(size: 28, weight: .bold))
                    .foregroundStyle(FieldTheme.ink)
                Text("Field Capture")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(FieldTheme.muted)
                Text(
                    "Sign in with your office Atmosphere account. Jobs you film here land in that organization’s evidence library."
                )
                .font(.system(size: 14))
                .foregroundStyle(FieldTheme.muted)
                .padding(.top, 4)

                VStack(spacing: 10) {
                    TextField("Work email", text: $email)
                        .textContentType(.username)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .padding(12)
                        .background(FieldTheme.panel)
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(FieldTheme.line))
                        .cornerRadius(10)

                    SecureField("Password", text: $password)
                        .textContentType(.password)
                        .padding(12)
                        .background(FieldTheme.panel)
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(FieldTheme.line))
                        .cornerRadius(10)
                }
                .padding(.top, 8)

                if let err = auth.lastError {
                    Text(err)
                        .font(.system(size: 13))
                        .foregroundStyle(FieldTheme.rec)
                }

                Button {
                    busy = true
                    Task {
                        await auth.signIn(email: email.trimmingCharacters(in: .whitespacesAndNewlines), password: password)
                        busy = false
                    }
                } label: {
                    Group {
                        if busy {
                            ProgressView().tint(FieldTheme.bg)
                        } else {
                            Text("Sign in").fontWeight(.bold)
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(FieldTheme.ink)
                    .foregroundStyle(FieldTheme.bg)
                    .cornerRadius(12)
                }
                .disabled(busy || email.isEmpty || password.isEmpty)
                .padding(.top, 6)
            }
            .padding(22)
            Spacer()
        }
        .background(FieldTheme.bg.ignoresSafeArea())
    }
}
