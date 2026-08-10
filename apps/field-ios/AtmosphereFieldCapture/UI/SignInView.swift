import SwiftUI

/**
 * First-install account connect.
 *
 * Shown only when this phone has never been linked (or after an explicit
 * disconnect). After Connect, the session stays in Keychain — crew opens
 * straight to Today on every later launch.
 */
struct SignInView: View {
    @EnvironmentObject private var auth: AuthSession
    @State private var email = ""
    @State private var password = ""
    @State private var busy = false

    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 36)
            VStack(alignment: .leading, spacing: 14) {
                // Same as the website: bars mark beside the Atmosphere wordmark.
                HStack(alignment: .center, spacing: 10) {
                    AtmosphereBarsMark(size: 28)
                    Text("Atmosphere")
                        .font(.system(size: 28, weight: .bold))
                        .foregroundStyle(FieldTheme.ink)
                        .tracking(-0.4)
                }
                Text("Field Capture")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(FieldTheme.muted)

                Text("Connect this phone once")
                    .font(.system(size: 22, weight: .bold))
                    .foregroundStyle(FieldTheme.ink)
                    .padding(.top, 10)

                Text(
                    "Use the same Atmosphere account as your office dashboard. You only do this when the app is first installed — after that, this phone stays connected and opens straight to today’s jobs."
                )
                .font(.system(size: 14))
                .foregroundStyle(FieldTheme.muted)

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
                .padding(.top, 4)

                if let err = auth.lastError {
                    Text(err)
                        .font(.system(size: 13))
                        .foregroundStyle(FieldTheme.rec)
                }

                Button {
                    busy = true
                    Task {
                        await auth.connectAccount(
                            email: email.trimmingCharacters(in: .whitespacesAndNewlines),
                            password: password
                        )
                        busy = false
                    }
                } label: {
                    Group {
                        if busy {
                            ProgressView().tint(FieldTheme.bg)
                        } else {
                            Text("Connect account").fontWeight(.bold)
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

                Text("After this, you won’t be asked again on this phone.")
                    .font(.system(size: 12))
                    .foregroundStyle(FieldTheme.faint)
            }
            .padding(22)
            Spacer()
        }
        .background(FieldTheme.bg.ignoresSafeArea())
    }
}
