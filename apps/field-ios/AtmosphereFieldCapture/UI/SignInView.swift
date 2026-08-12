import SwiftUI

/**
 * First-install account connect.
 *
 * Uses the **same email + password as the Atmosphere website / dashboard**.
 * Shown only when this phone has never been linked (or after disconnect).
 */
struct SignInView: View {
    @EnvironmentObject private var auth: AuthSession
    @State private var email = ""
    @State private var password = ""
    @State private var apiBase = ApiConfig.resolvedBaseString()
    @State private var busy = false

    private var serverHint: String {
        if ApiConfig.isSimulator {
            return "Simulator default is \(ApiConfig.simulatorDefault). Same backend as the website."
        }
        return "On a physical iPhone use your Mac’s LAN IP (e.g. http://192.168.1.20:4000) or your deployed Atmosphere API — not 127.0.0.1."
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                AtmosphereLogo(markSize: 28, titleSize: 28, subtitle: "Field Capture")
                    .padding(.top, 36)

                Text("Sign in with your website account")
                    .font(.system(size: 22, weight: .bold))
                    .foregroundStyle(FieldTheme.ink)
                    .padding(.top, 10)

                Text(
                    "Use the same email and password you use on the Atmosphere website. You only connect this phone once — after that it stays signed in."
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

                VStack(alignment: .leading, spacing: 6) {
                    Text("Atmosphere API")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(FieldTheme.muted)
                    TextField("http://192.168.1.20:4000", text: $apiBase)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                        .textContentType(.URL)
                        .padding(12)
                        .background(FieldTheme.panel)
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(FieldTheme.line))
                        .cornerRadius(10)
                    Text(serverHint)
                        .font(.system(size: 11))
                        .foregroundStyle(FieldTheme.faint)
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
                            password: password,
                            apiBase: apiBase
                        )
                        busy = false
                    }
                } label: {
                    Group {
                        if busy {
                            ProgressView().tint(FieldTheme.bg)
                        } else {
                            Text("Sign in & connect phone").fontWeight(.bold)
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(FieldTheme.ink)
                    .foregroundStyle(FieldTheme.bg)
                    .cornerRadius(12)
                }
                .disabled(busy || email.isEmpty || password.isEmpty || apiBase.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                .padding(.top, 6)

                Text("After this, you won’t be asked again on this phone.")
                    .font(.system(size: 12))
                    .foregroundStyle(FieldTheme.faint)
            }
            .padding(22)
        }
        .background(FieldTheme.bg.ignoresSafeArea())
        .onAppear {
            // Recover from legacy builds that saved api.atmosphere.example.
            apiBase = ApiConfig.resolvedBaseString()
        }
    }
}
