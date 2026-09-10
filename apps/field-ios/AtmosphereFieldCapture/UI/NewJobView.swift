import SwiftUI

/// Web `s-new-job`: name + optional note + Places when available, then record.
struct NewJobView: View {
    @EnvironmentObject private var session: FieldDaySession
    @EnvironmentObject private var api: AtmosphereClient
    @Environment(\.dismiss) private var dismiss

    @State private var title = ""
    @State private var situation = ""
    @State private var addressQuery = ""
    @State private var selectedAddress = ""
    @State private var placesEnabled = false
    @State private var suggestions: [AtmosphereClient.PlaceSuggestion] = []
    @State private var sessionToken = UUID().uuidString
    @State private var errorMessage = ""
    @State private var busy = false
    @State private var placesTask: Task<Void, Never>?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text("Name it, then start recording.")
                        .font(.system(size: 14))
                        .foregroundStyle(FieldTheme.muted)

                    VStack(alignment: .leading, spacing: 6) {
                        Text("Job name")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(FieldTheme.faint)
                            .textCase(.uppercase)
                        TextField("East Racine Avenue", text: $title)
                            .padding(12)
                            .background(FieldTheme.panel)
                            .overlay(RoundedRectangle(cornerRadius: 10).stroke(FieldTheme.line))
                            .cornerRadius(10)
                    }

                    if placesEnabled {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Site address")
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(FieldTheme.faint)
                                .textCase(.uppercase)
                            TextField("Start typing an address", text: $addressQuery)
                                .padding(12)
                                .background(FieldTheme.panel)
                                .overlay(RoundedRectangle(cornerRadius: 10).stroke(FieldTheme.line))
                                .cornerRadius(10)
                                .onChange(of: addressQuery) { value in
                                    schedulePlaces(value)
                                }
                            if !selectedAddress.isEmpty {
                                Text(selectedAddress)
                                    .font(.system(size: 12))
                                    .foregroundStyle(FieldTheme.pass)
                            }
                            ForEach(suggestions) { suggestion in
                                Button {
                                    Task { await pickPlace(suggestion) }
                                } label: {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(suggestion.mainText ?? suggestion.description)
                                            .font(.system(size: 14, weight: .semibold))
                                        if let secondary = suggestion.secondaryText, !secondary.isEmpty {
                                            Text(secondary)
                                                .font(.system(size: 12))
                                                .foregroundStyle(FieldTheme.muted)
                                        } else if suggestion.mainText != nil {
                                            Text(suggestion.description)
                                                .font(.system(size: 12))
                                                .foregroundStyle(FieldTheme.muted)
                                        }
                                    }
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .padding(10)
                                    .background(FieldTheme.panel)
                                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(FieldTheme.line))
                                    .cornerRadius(8)
                                }
                                .buttonStyle(.plain)
                                .foregroundStyle(FieldTheme.ink)
                            }
                        }
                    }

                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text("What needs to be done")
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(FieldTheme.faint)
                                .textCase(.uppercase)
                            Text("(optional)")
                                .font(.system(size: 12))
                                .foregroundStyle(FieldTheme.faint)
                        }
                        TextField(
                            "Extract standing water in the living room. Set drying equipment.",
                            text: $situation,
                            axis: .vertical
                        )
                        .lineLimit(3 ... 6)
                        .padding(12)
                        .background(FieldTheme.panel)
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(FieldTheme.line))
                        .cornerRadius(10)
                    }

                    if !errorMessage.isEmpty {
                        Text(errorMessage)
                            .font(.system(size: 13))
                            .foregroundStyle(FieldTheme.rec)
                    }

                    Button {
                        Task { await startRecording() }
                    } label: {
                        Text(busy ? "Starting…" : "Start recording")
                            .font(.system(size: 17, weight: .bold))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 16)
                            .background(FieldTheme.ink)
                            .foregroundStyle(FieldTheme.bg)
                            .cornerRadius(12)
                    }
                    .disabled(busy)
                }
                .padding(18)
            }
            .background(FieldTheme.bg.ignoresSafeArea())
            .navigationTitle("New job")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
            .task { await refreshPlacesStatus() }
        }
    }

    private func refreshPlacesStatus() async {
        do {
            let status = try await api.placesStatus()
            placesEnabled = status.configured != false
        } catch {
            placesEnabled = false
        }
    }

    private func schedulePlaces(_ raw: String) {
        placesTask?.cancel()
        let q = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard q.count >= 2 else {
            suggestions = []
            return
        }
        placesTask = Task {
            try? await Task.sleep(nanoseconds: 280_000_000)
            guard !Task.isCancelled else { return }
            do {
                let list = try await api.placesAutocomplete(input: q, sessionToken: sessionToken)
                guard !Task.isCancelled else { return }
                suggestions = list
            } catch {
                suggestions = []
            }
        }
    }

    private func pickPlace(_ suggestion: AtmosphereClient.PlaceSuggestion) async {
        do {
            let details = try await api.placesDetails(placeId: suggestion.placeId, sessionToken: sessionToken)
            let line = details.displayLine.isEmpty ? suggestion.description : details.displayLine
            selectedAddress = line
            addressQuery = line
            suggestions = []
            if title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                title = suggestion.mainText ?? line
            }
            sessionToken = UUID().uuidString
        } catch {
            selectedAddress = suggestion.description
            addressQuery = suggestion.description
            suggestions = []
        }
    }

    private func startRecording() async {
        let name = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else {
            errorMessage = "Enter a name."
            return
        }
        busy = true
        errorMessage = ""
        defer { busy = false }
        let draft = PendingJobsStore.draft(
            title: name,
            situation: situation,
            address: selectedAddress.isEmpty ? addressQuery : selectedAddress
        )
        dismiss()
        await session.adoptDraftJob(draft, startRecording: true)
        session.syncPendingJobs(api: api)
    }
}
