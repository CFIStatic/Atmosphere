import SwiftUI

struct DoorView: View {
    @EnvironmentObject private var session: FieldDaySession

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
                        Text("hasAudio=\(m.hasAudio) · \(Int(m.durationSeconds))s · media \(m.mediaId ?? "—")")
                            .font(FieldTheme.mono)
                            .font(.system(size: 11))
                            .foregroundStyle(FieldTheme.faint)
                    }

                    if session.uploading {
                        ProgressView("Uploading day film…")
                    }

                    if let err = session.lastError {
                        Text(err).foregroundStyle(FieldTheme.rec).font(.system(size: 13))
                    }

                    VStack(alignment: .leading, spacing: 4) {
                        Text("Your part is done.")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(FieldTheme.pass)
                        Text(
                            "The office opens the Verifier for video + audio with AI dictation, and the property twin built from measurements."
                        )
                        .font(.system(size: 12))
                        .foregroundStyle(FieldTheme.pass.opacity(0.85))
                    }
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(FieldTheme.passWash)
                    .cornerRadius(11)
                }
                .padding(18)
            }

            Button("Back to today") {
                session.backToToday()
            }
            .font(.system(size: 16, weight: .bold))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 16)
            .background(FieldTheme.ink)
            .foregroundStyle(FieldTheme.bg)
            .cornerRadius(12)
            .padding(18)
        }
        .background(FieldTheme.bg)
    }
}
