import SwiftUI

struct AddJobView: View {
    @EnvironmentObject private var session: FieldDaySession
    @EnvironmentObject private var api: AtmosphereClient

    @State private var name = ""
    @State private var address = ""
    @State private var city = ""
    @State private var notes = ""
    @State private var workType = "mitigation"

    private var canSubmit: Bool {
        name.trimmingCharacters(in: .whitespacesAndNewlines).count >= 2
            && address.trimmingCharacters(in: .whitespacesAndNewlines).count >= 3
            && !session.creatingJob
    }

    var body: some View {
        VStack(spacing: 0) {
            FieldHeader()
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Text("Add a job")
                        .font(.system(size: 28, weight: .bold))
                        .foregroundStyle(FieldTheme.ink)

                    Text(
                        "Opens the job in your office account and assigns it to you. It shows up under My jobs and, if it is for today, on Today."
                    )
                    .font(.system(size: 15))
                    .foregroundStyle(FieldTheme.muted)

                    field("Job name", text: $name, placeholder: "Kitchen water — Oak Ridge")
                    field("Site address", text: $address, placeholder: "1847 Oak Ridge Dr")
                    field("City", text: $city, placeholder: "Charleston")

                    Text("Work type")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(FieldTheme.faint)
                        .textCase(.uppercase)
                    HStack(spacing: 8) {
                        mode("Mitigation", value: "mitigation")
                        mode("Construction", value: "construction")
                    }

                    field("Notes (optional)", text: $notes, placeholder: "What you are walking into")

                    if let err = session.lastError, session.tab == .add {
                        Text(err)
                            .font(.system(size: 13))
                            .foregroundStyle(FieldTheme.rec)
                    }

                    Button {
                        Task {
                            let ok = await session.createJob(
                                api: api,
                                name: name.trimmingCharacters(in: .whitespacesAndNewlines),
                                address: address.trimmingCharacters(in: .whitespacesAndNewlines),
                                city: city.trimmingCharacters(in: .whitespacesAndNewlines),
                                notes: notes.trimmingCharacters(in: .whitespacesAndNewlines),
                                workType: workType
                            )
                            if ok {
                                name = ""
                                address = ""
                                city = ""
                                notes = ""
                            }
                        }
                    } label: {
                        Group {
                            if session.creatingJob {
                                ProgressView().tint(FieldTheme.bg)
                            } else {
                                Text("Add job & assign to me")
                                    .font(.system(size: 16, weight: .bold))
                            }
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(FieldTheme.ink)
                        .foregroundStyle(FieldTheme.bg)
                        .cornerRadius(12)
                    }
                    .disabled(!canSubmit)
                    .padding(.top, 6)
                }
                .padding(18)
            }
        }
        .background(FieldTheme.bg)
    }

    private func field(_ label: String, text: Binding<String>, placeholder: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(FieldTheme.faint)
                .textCase(.uppercase)
            TextField(placeholder, text: text)
                .padding(12)
                .background(FieldTheme.panel)
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(FieldTheme.line))
                .cornerRadius(10)
        }
    }

    private func mode(_ title: String, value: String) -> some View {
        Button {
            workType = value
        } label: {
            Text(title)
                .font(.system(size: 13, weight: .semibold))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
                .background(workType == value ? FieldTheme.ink : FieldTheme.panel)
                .foregroundStyle(workType == value ? FieldTheme.bg : FieldTheme.ink)
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(FieldTheme.line))
                .cornerRadius(10)
        }
        .buttonStyle(.plain)
    }
}
