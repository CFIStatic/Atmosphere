import SwiftUI

/**
 * Same email + password as the office Platform.
 *
 * This is the Field Capture login.
 */
struct SignInView: View {
    @EnvironmentObject private var auth: AuthSession
    var onCreateAccount: () -> Void = {}
    @State private var email = ""
    @State private var password = ""
    @State private var busy = false
    @State private var pendingSaved = 0

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                // Same as the website: bars mark beside the Atmosphere wordmark.
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

                Text("Welcome back")
                    .font(.system(size: 22, weight: .bold))
                    .foregroundStyle(FieldTheme.ink)
                    .padding(.top, 10)

                Text(
                    "Sign in with the same email and password as the office Platform."
                )
                .font(.system(size: 14))
                .foregroundStyle(FieldTheme.muted)

                if pendingSaved > 0 {
                    Text(
                        pendingSaved == 1
                            ? "1 day film saved on this phone — sign in to finish filing."
                            : "\(pendingSaved) day films saved on this phone — sign in to finish filing."
                    )
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(FieldTheme.ink)
                    .padding(.top, 4)
                }

                VStack(spacing: 10) {
                    TextField("Email", text: $email)
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
                            Text("Sign in")
                                .font(.system(size: 16, weight: .bold))
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

                Button(action: onCreateAccount) {
                    Text("Create an account")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(FieldTheme.accent)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                }
                .disabled(busy)
                .padding(.top, 4)

                Text("After this, you won’t be asked again on this phone.")
                    .font(.system(size: 12))
                    .foregroundStyle(FieldTheme.faint)
            }
            .padding(22)
        }
        .background(FieldTheme.bg.ignoresSafeArea())
        .task {
            pendingSaved = DayFilmUploadQueue.shared.pendingSavedCount()
            if pendingSaved == 0 {
                let n = (try? await DayFilmQueueStore.shared.pendingCount()) ?? 0
                pendingSaved = n
            }
        }
    }
}
