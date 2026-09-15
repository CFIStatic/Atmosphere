import SwiftUI

/**
 * Pre-record gate: versioned recording-on-property disclosure.
 * Separate from worker Terms of Service. Not legal final — product wording.
 */
struct RecordingConsentView: View {
    @EnvironmentObject private var session: FieldDaySession
    @EnvironmentObject private var api: AtmosphereClient
    let jobId: String
    let onCancel: () -> Void
    let onAcknowledged: () -> Void

    @State private var acknowledged = false
    @State private var busy = false
    @State private var errorMessage = ""
    @State private var disclosureText = AtmosphereClient.recordingDisclosureText
    @State private var disclosureVersion = AtmosphereClient.recordingDisclosureVersion

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Text("Before you record")
                        .font(.system(size: 22, weight: .bold))
                        .foregroundStyle(FieldTheme.ink)
                        .padding(.top, 8)

                    Text("Please read this recording notice for this job site. It is separate from the Terms of Service.")
                        .font(.system(size: 14))
                        .foregroundStyle(FieldTheme.muted)

                    Text(disclosureText)
                        .font(.system(size: 14))
                        .foregroundStyle(FieldTheme.ink)
                        .padding(12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(FieldTheme.panel)
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(FieldTheme.line))
                        .cornerRadius(10)

                    Toggle(isOn: $acknowledged) {
                        Text("I understand video and audio may be recorded on this job site and used as described above.")
                            .font(.system(size: 14))
                            .foregroundStyle(FieldTheme.ink)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .toggleStyle(.switch)
                    .tint(FieldTheme.accent)

                    if !errorMessage.isEmpty {
                        Text(errorMessage)
                            .font(.system(size: 13))
                            .foregroundStyle(FieldTheme.rec)
                    }

                    Button {
                        Task { await confirm() }
                    } label: {
                        Group {
                            if busy {
                                ProgressView().tint(FieldTheme.bg)
                            } else {
                                Text("Acknowledge and start")
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
                }
                .padding(22)
            }
            .background(FieldTheme.bg.ignoresSafeArea())
            .navigationTitle("Recording notice")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { onCancel() }
                        .disabled(busy)
                }
            }
            .task { await loadDisclosure() }
        }
    }

    private func loadDisclosure() async {
        do {
            let payload = try await api.recordingDisclosure()
            disclosureText = payload.text
            disclosureVersion = payload.version
        } catch {
            // Bundled product text is enough to show the gate offline.
        }
    }

    private func confirm() async {
        guard acknowledged else { return }
        busy = true
        errorMessage = ""
        defer { busy = false }
        let workDate = FieldDaySession.todayStampPublic()
        do {
            _ = try await api.acceptRecordingAck(
                jobId: jobId,
                disclosureVersion: disclosureVersion,
                workDate: workDate,
                shareToken: session.isShareMode ? session.shareToken : nil
            )
            RecordingAckStore.mark(
                jobId: jobId,
                workDate: workDate,
                version: disclosureVersion
            )
            onAcknowledged()
        } catch {
            // Local drafts / offline: keep the gate usable; upload will POST later.
            if AtmosphereClient.isUnreachable(error) || PendingJobsStore.isLocalJobId(jobId) {
                RecordingAckStore.mark(
                    jobId: jobId,
                    workDate: workDate,
                    version: disclosureVersion
                )
                onAcknowledged()
                return
            }
            errorMessage = error.localizedDescription
        }
    }
}
