import SwiftUI

/// Ask once at the start of a day, and again at the end if they skipped.
/// Never shown when this job already has measurements.
struct MeasureOfferView: View {
    @EnvironmentObject private var session: FieldDaySession

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            AtmosphereBarsMark(size: 28)
            Text("Measure the building?")
                .font(.system(size: 26, weight: .bold))
                .foregroundStyle(FieldTheme.ink)
            Text(
                session.measureOffer == .beforeRecord
                    ? "This job does not have building measurements yet. Take them now, before you start recording, or skip and we will ask again when you finish."
                    : "You have not measured this building yet. Take the measurements now, or skip — we will not ask again until a job has none."
            )
            .font(.system(size: 15))
            .foregroundStyle(FieldTheme.muted)

            Button {
                session.acceptMeasureOffer()
            } label: {
                Text("Yes, measure now")
                    .font(.system(size: 16, weight: .bold))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(FieldTheme.ink)
                    .foregroundStyle(FieldTheme.bg)
                    .cornerRadius(12)
            }

            Button("Not now") {
                session.declineMeasureOffer()
            }
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(FieldTheme.muted)
            .frame(maxWidth: .infinity)
            .padding(.top, 4)

            Spacer()
        }
        .padding(22)
        .background(FieldTheme.bg.ignoresSafeArea())
    }
}
