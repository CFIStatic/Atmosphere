import SwiftUI

/**
 * Blocking Terms of Service acknowledgment after sign-in when the
 * recorded version is missing or older than the live draft.
 */
struct TermsAcknowledgmentView: View {
    @EnvironmentObject private var auth: AuthSession
    @State private var acknowledged = false
    @State private var busy = false

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

                Text("Please acknowledge the Terms")
                    .font(.system(size: 22, weight: .bold))
                    .foregroundStyle(FieldTheme.ink)
                    .padding(.top, 10)

                Text("Please acknowledge the Terms of Service before using Field Capture. If the Terms change, we will ask you to review them again.")
                    .font(.system(size: 14))
                    .foregroundStyle(FieldTheme.muted)

                TermsAckToggle(acknowledged: $acknowledged)
                    .padding(.top, 4)

                if let err = auth.lastError {
                    Text(err)
                        .font(.system(size: 13))
                        .foregroundStyle(FieldTheme.rec)
                }

                Button {
                    busy = true
                    Task {
                        await auth.acceptCurrentTerms()
                        busy = false
                    }
                } label: {
                    Group {
                        if busy {
                            ProgressView().tint(FieldTheme.bg)
                        } else {
                            Text("Continue")
                                .font(.system(size: 16, weight: .bold))
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(FieldTheme.ink)
                    .foregroundStyle(FieldTheme.bg)
                    .cornerRadius(12)
                }
                .disabled(busy || !acknowledged)
                .padding(.top, 6)

                Button {
                    Task { await auth.disconnectAccount() }
                } label: {
                    Text("Sign out")
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
}

struct TermsAckToggle: View {
    @Binding var acknowledged: Bool

    var body: some View {
        Toggle(isOn: $acknowledged) {
            VStack(alignment: .leading, spacing: 4) {
                Text("I acknowledge and agree to the Terms of Service and have read the Privacy Policy.")
                    .font(.system(size: 14))
                    .foregroundStyle(FieldTheme.ink)
                    .fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 12) {
                    Link("Terms of Service", destination: AtmosphereClient.termsURL)
                    Link("Privacy Policy", destination: AtmosphereClient.privacyURL)
                }
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(FieldTheme.accent)
            }
        }
        .toggleStyle(.switch)
        .tint(FieldTheme.accent)
    }
}
