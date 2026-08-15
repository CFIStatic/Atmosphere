import SwiftUI

struct SendingView: View {
    @EnvironmentObject private var session: FieldDaySession
    @EnvironmentObject private var api: AtmosphereClient

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            AtmosphereBarsMark(size: 28)
            Text("Still sending")
                .font(.system(size: 28, weight: .bold))
                .foregroundStyle(FieldTheme.ink)
            Text(session.sendingDetail)
                .font(.system(size: 16))
                .foregroundStyle(FieldTheme.muted)

            ProgressView(value: session.uploadProgress)
                .tint(FieldTheme.accent)
            Text("\(Int(session.uploadProgress * 100))%")
                .font(FieldTheme.mono)
                .foregroundStyle(FieldTheme.faint)

            Text("You can lock the phone. The film stays on this device until Atmosphere has the file — then we measure the property.")
                .font(.system(size: 14))
                .foregroundStyle(FieldTheme.muted)

            if let err = session.lastError {
                Text(err).font(.system(size: 13)).foregroundStyle(FieldTheme.rec)
                Button {
                    Task { await session.sendPending(api: api) }
                } label: {
                    Text("Try sending again")
                        .font(.system(size: 16, weight: .bold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(FieldTheme.ink)
                        .foregroundStyle(FieldTheme.bg)
                        .cornerRadius(12)
                }
            }

            Spacer()
        }
        .padding(22)
        .background(FieldTheme.bg.ignoresSafeArea())
    }
}
