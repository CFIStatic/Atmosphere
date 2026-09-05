import AVKit
import SwiftUI

struct DoorView: View {
    @EnvironmentObject private var session: FieldDaySession

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    if let url = session.lastRecordingURL {
                        DayFilmPreview(url: url)
                    }

                    VStack(alignment: .leading, spacing: 8) {
                        Text("Checked at the door")
                            .font(.system(size: 26, weight: .bold))
                        Text("Before anyone watches it, your day is checked as evidence. Video and audio both sealed.")
                            .font(.system(size: 14))
                            .foregroundStyle(FieldTheme.muted)
                    }

                    VStack(spacing: 8) {
                        ForEach(session.doorChecks) { row in
                            HStack(spacing: 12) {
                                Circle()
                                    .fill(row.ok ? FieldTheme.pass.opacity(0.18) : FieldTheme.rec.opacity(0.18))
                                    .frame(width: 28, height: 28)
                                    .overlay {
                                        Text(row.ok ? "✓" : "!")
                                            .font(.system(size: 12, weight: .bold))
                                            .foregroundStyle(row.ok ? FieldTheme.pass : FieldTheme.rec)
                                    }
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(row.label)
                                        .font(.system(size: 14, weight: .semibold))
                                    Text(row.detail)
                                        .font(FieldTheme.mono)
                                        .font(.system(size: 11))
                                        .foregroundStyle(FieldTheme.muted)
                                        .lineLimit(2)
                                }
                                Spacer(minLength: 0)
                            }
                            .padding(.horizontal, 14)
                            .padding(.vertical, 12)
                            .background(FieldTheme.panel)
                            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                            .shadow(color: FieldTheme.ink.opacity(0.04), radius: 8, y: 3)
                        }
                    }

                    if !session.twinRooms.isEmpty {
                        VStack(alignment: .leading, spacing: 10) {
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
                                .padding(.horizontal, 12)
                                .padding(.vertical, 10)
                                .background(FieldTheme.bg)
                                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                            }
                        }
                        .padding(16)
                        .background(FieldTheme.panel)
                        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                        .shadow(color: FieldTheme.ink.opacity(0.04), radius: 8, y: 3)
                    }

                    if let m = session.manifest {
                        Text("hasAudio=\(m.hasAudio) · \(formatClipLength(m.durationSeconds)) · media \(m.mediaId ?? "—")")
                            .font(FieldTheme.mono)
                            .font(.system(size: 11))
                            .foregroundStyle(FieldTheme.faint)
                    }

                    if session.uploading {
                        HStack(spacing: 10) {
                            ProgressView()
                            Text("Uploading day film…")
                                .font(.system(size: 13))
                                .foregroundStyle(FieldTheme.muted)
                        }
                        .padding(14)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(FieldTheme.panel)
                        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                    }

                    if let err = session.lastError {
                        Text(err)
                            .foregroundStyle(FieldTheme.rec)
                            .font(.system(size: 13))
                            .padding(14)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(FieldTheme.rec.opacity(0.08))
                            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                    }

                    VStack(alignment: .leading, spacing: 6) {
                        Text("Your part is done.")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(FieldTheme.pass)
                        Text(
                            "The office opens the Verifier for video + audio. Atmosphere reads the film internally, stores the actions it saw, and writes the dictation beside the clip."
                        )
                        .font(.system(size: 12))
                        .foregroundStyle(FieldTheme.pass.opacity(0.85))
                    }
                    .padding(16)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(FieldTheme.pass.opacity(0.1))
                    .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                }
                .padding(18)
            }

            Button("Back to Home Screen") {
                session.backToToday()
            }
            .font(.system(size: 16, weight: .bold))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 16)
            .background(FieldTheme.ink)
            .foregroundStyle(FieldTheme.bg)
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            .padding(.horizontal, 18)
            .padding(.bottom, 18)
        }
        .background(FieldTheme.bg)
    }
}

private struct DayFilmPreview: View {
    let url: URL

    var body: some View {
        VideoPlayer(player: AVPlayer(url: url))
            .frame(maxWidth: .infinity)
            .aspectRatio(9 / 16, contentMode: .fit)
            .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
            .overlay(alignment: .bottomLeading) {
                Text("Your day film")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(.black.opacity(0.45))
                    .clipShape(Capsule())
                    .padding(12)
            }
            .shadow(color: FieldTheme.ink.opacity(0.08), radius: 12, y: 6)
    }
}
