import SwiftUI

/**
 * First-install crew connect.
 *
 * The person's name plus the company code from Atmosphere Settings.
 * We store both on this phone and stay linked.
 */
struct JoinCrewView: View {
    @EnvironmentObject private var auth: AuthSession
    var onDashboardLogin: () -> Void = {}

    @State private var fullName = ""
    @State private var joinCode = ""
    @State private var previewTask: Task<Void, Never>?
    @State private var busy = false

    private var nameValid: Bool {
        fullName.trimmingCharacters(in: .whitespacesAndNewlines)
            .split(whereSeparator: { $0.isWhitespace })
            .count >= 2
    }

    private var codeValid: Bool {
        let code = joinCode.trimmingCharacters(in: .whitespacesAndNewlines)
        return (6 ... 12).contains(code.count) && code.allSatisfy { $0.isLetter || $0.isNumber }
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

                Text("Connect this phone")
                    .font(.system(size: 22, weight: .bold))
                    .foregroundStyle(FieldTheme.ink)
                    .padding(.top, 10)

                Text(
                    "Type your name and the company code from the office. We store them here — you will not be asked again."
                )
                .font(.system(size: 14))
                .foregroundStyle(FieldTheme.muted)

                TextField("First and last name", text: $fullName)
                    .textContentType(.name)
                    .textInputAutocapitalization(.words)
                    .padding(12)
                    .background(FieldTheme.panel)
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(FieldTheme.line))
                    .cornerRadius(10)
                    .padding(.top, 4)

                TextField("Company code", text: Binding(
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
                    .padding(.top, 4)

                if let name = auth.officePreviewName {
                    Text("This code belongs to \(name).")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(FieldTheme.pass)
                } else {
                    Text("Ask the office for the 6–12 character code in Atmosphere → Settings.")
                        .font(.system(size: 12))
                        .foregroundStyle(FieldTheme.faint)
                }

                if let err = auth.lastError {
                    Text(err)
                        .font(.system(size: 13))
                        .foregroundStyle(FieldTheme.rec)
                }

                Button {
                    busy = true
                    Task {
                        await auth.joinCrew(
                            fullName: fullName.trimmingCharacters(in: .whitespacesAndNewlines),
                            joinCode: joinCode.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
                        )
                        busy = false
                    }
                } label: {
                    Group {
                        if busy {
                            ProgressView().tint(FieldTheme.bg)
                        } else {
                            Text("Connect this phone")
                                .font(.system(size: 16, weight: .bold))
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(FieldTheme.ink)
                    .foregroundStyle(FieldTheme.bg)
                    .cornerRadius(12)
                }
                .disabled(busy || !nameValid || !codeValid)
                .padding(.top, 6)

                Button(action: onDashboardLogin) {
                    Text("I already have a dashboard login")
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
        .onAppear {
            if let pending = auth.pendingJoinCode, !pending.isEmpty {
                joinCode = pending
                Task { await auth.previewOffice(joinCode: pending) }
            }
        }
        .onReceive(auth.$pendingJoinCode) { pending in
            guard let pending, !pending.isEmpty else { return }
            joinCode = pending
            Task { await auth.previewOffice(joinCode: pending) }
        }
    }
}
