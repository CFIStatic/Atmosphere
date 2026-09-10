import SwiftUI

struct DoorView: View {
    @EnvironmentObject private var session: FieldDaySession
    @State private var recordingAnother = false

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text("Checked at the door")
                        .font(.system(size: 26, weight: .bold))
                    Text("Before anyone watches it, your day is checked as evidence. Video and audio both sealed.")
                        .font(.system(size: 14))
                        .foregroundStyle(FieldTheme.muted)

                    VStack(spacing: 0) {
                        ForEach(session.doorChecks) { row in
                            HStack {
                                Text(row.label)
                                Spacer()
                                Text(row.detail)
                                    .font(FieldTheme.mono)
                                    .foregroundStyle(FieldTheme.muted)
                                    .lineLimit(1)
                                Text(row.ok ? "✓" : "!")
                                    .font(.system(size: 13, weight: .bold))
                                    .foregroundStyle(row.ok ? FieldTheme.pass : FieldTheme.rec)
                            }
                            .font(.system(size: 13))
                            .padding(12)
                            Divider()
                        }
                    }
                    .background(FieldTheme.panel)
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(FieldTheme.line))
                    .cornerRadius(12)

                    VStack(alignment: .leading, spacing: 8) {
                        Text("Measured for the twin")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(FieldTheme.faint)
                            .textCase(.uppercase)
                        ForEach(session.twinRooms) { room in
                            HStack {
                                Text(room.name).font(.system(size: 13, weight: .semibold))
                                Spacer()
                                Text(room.detail).font(FieldTheme.mono).foregroundStyle(FieldTheme.muted)
                            }
                            .font(.system(size: 13))
                            .padding(10)
                            .background(FieldTheme.bg)
                            .cornerRadius(8)
                        }
                    }
                    .padding(14)
                    .background(FieldTheme.panel)
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(FieldTheme.line))
                    .cornerRadius(12)

                    if let m = session.manifest {
                        Text(
                            "hasAudio=\(m.hasAudio) · \(formatClipLength(m.durationSeconds)) · clip \(m.clipId ?? "—") · media \(m.mediaId ?? "filing…")"
                        )
                        .font(FieldTheme.mono)
                        .font(.system(size: 11))
                        .foregroundStyle(FieldTheme.faint)
                    }

                    if !session.filingDetail.isEmpty {
                        Text(session.filingDetail)
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(FieldTheme.muted)
                    }

                    if session.uploading {
                        ProgressView("Saving day film…")
                    }

                    if let err = session.lastError {
                        Text(err).foregroundStyle(FieldTheme.rec).font(.system(size: 13))
                    }

                    VStack(alignment: .leading, spacing: 4) {
                        Text("Your part is done.")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(FieldTheme.pass)
                        Text(
                            "The office opens the Verifier for video + audio. Atmosphere reads the film internally, stores the actions it saw, and writes the dictation beside the clip."
                        )
                        .font(.system(size: 12))
                        .foregroundStyle(FieldTheme.pass.opacity(0.85))
                    }
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color(red: 0.941, green: 0.969, blue: 0.945))
                    .cornerRadius(11)
                }
                .padding(18)
            }

            VStack(spacing: 10) {
                if session.canRecordAnother {
                    Button {
                        recordingAnother = true
                        Task {
                            await session.recordAnother()
                            recordingAnother = false
                        }
                    } label: {
                        Text(recordingAnother ? "Opening camera…" : "Record another")
                            .font(.system(size: 16, weight: .bold))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 16)
                            .background(FieldTheme.panel)
                            .foregroundStyle(FieldTheme.ink)
                            .overlay(RoundedRectangle(cornerRadius: 12).stroke(FieldTheme.line, lineWidth: 1.5))
                            .cornerRadius(12)
                    }
                    .disabled(recordingAnother || session.uploading)
                }

                Button("Back to Home Screen") {
                    session.backToToday()
                }
                .font(.system(size: 16, weight: .bold))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 16)
                .background(FieldTheme.ink)
                .foregroundStyle(FieldTheme.bg)
                .cornerRadius(12)
            }
            .padding(18)
        }
        .background(FieldTheme.bg)
        .onReceive(NotificationCenter.default.publisher(for: .dayFilmQueueDidFile)) { note in
            guard let filmId = session.doorFilmId,
                  let filedId = note.userInfo?["entryId"] as? String,
                  filedId == filmId
            else { return }
            session.applyFiledNotification(
                proofId: note.userInfo?["proofId"] as? String,
                storagePath: note.userInfo?["storagePath"] as? String,
                byteSize: note.userInfo?["byteSize"] as? Int64
            )
        }
        .onReceive(session.uploadQueue.$filingStep) { _ in
            session.refreshFilingDetailFromQueue()
        }
    }
}
