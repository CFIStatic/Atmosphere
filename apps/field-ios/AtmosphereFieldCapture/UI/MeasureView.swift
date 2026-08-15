import SwiftUI

struct MeasureView: View {
    @EnvironmentObject private var session: FieldDaySession
    @EnvironmentObject private var api: AtmosphereClient

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            AtmosphereBarsMark(size: 28)
            Text("Measure the property")
                .font(.system(size: 28, weight: .bold))
                .foregroundStyle(FieldTheme.ink)
            Text(
                session.roomPlan.lidarAvailable
                    ? "Walk the rooms once. RoomPlan builds the twin the office opens — the day film is already filed."
                    : "This phone cannot run RoomPlan (needs LiDAR). Skip and the office still has the day film."
            )
            .font(.system(size: 15))
            .foregroundStyle(FieldTheme.muted)

            if !session.roomPlan.rooms.isEmpty {
                ForEach(session.roomPlan.rooms, id: \.name) { room in
                    HStack {
                        Text(room.name).font(.system(size: 15, weight: .semibold))
                        Spacer()
                        Text(room.floorAreaSqFt.map { "\(Int($0)) SF" } ?? "Measured")
                            .font(FieldTheme.mono)
                            .foregroundStyle(FieldTheme.muted)
                    }
                    .padding(12)
                    .background(FieldTheme.panel)
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(FieldTheme.line))
                    .cornerRadius(10)
                }
            }

            if session.roomPlan.lidarAvailable {
                Button {
                    session.roomPlan.beginCapture()
                } label: {
                    Text("Start RoomPlan")
                        .font(.system(size: 16, weight: .bold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(FieldTheme.ink)
                        .foregroundStyle(FieldTheme.bg)
                        .cornerRadius(12)
                }
            }

            if !session.roomPlan.rooms.isEmpty {
                Button {
                    Task { await session.finishMeasure(api: api) }
                } label: {
                    Text("File the twin")
                        .font(.system(size: 16, weight: .bold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(FieldTheme.accent)
                        .foregroundStyle(FieldTheme.bg)
                        .cornerRadius(12)
                }
            }

            Button("Skip for now") {
                session.skipMeasure()
            }
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(FieldTheme.muted)
            .frame(maxWidth: .infinity)
            .padding(.top, 8)

            if let err = session.lastError {
                Text(err).font(.system(size: 13)).foregroundStyle(FieldTheme.rec)
            }

            Spacer()
        }
        .padding(22)
        .background(FieldTheme.bg.ignoresSafeArea())
        .fullScreenCover(isPresented: $session.roomPlan.isPresentingCapture) {
            RoomCaptureHost(
                onComplete: { rooms, mesh in
                    session.roomPlan.applyCapture(rooms: rooms, meshURL: mesh)
                },
                onCancel: {
                    session.roomPlan.cancelCapture()
                }
            )
            .ignoresSafeArea()
        }
    }
}
