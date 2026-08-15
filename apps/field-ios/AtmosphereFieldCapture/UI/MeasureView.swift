import SwiftUI

struct MeasureView: View {
    @EnvironmentObject private var session: FieldDaySession
    @EnvironmentObject private var api: AtmosphereClient

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            AtmosphereBarsMark(size: 28)
            Text("Measure the building")
                .font(.system(size: 28, weight: .bold))
                .foregroundStyle(FieldTheme.ink)
            Text(
                session.roomPlan.lidarAvailable
                    ? (session.measureReturn == .door
                        ? "Walk the rooms once. The day film is already saved on this phone."
                        : "Walk the rooms once. The office gets the rooms with the day film.")
                    : "This phone cannot measure rooms (needs LiDAR). Skip and keep the day film."
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
                    Text("Start measuring")
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
                    Text("Save measurements")
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
        .onAppear {
            session.roomPlan.detectCapabilities()
        }
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
