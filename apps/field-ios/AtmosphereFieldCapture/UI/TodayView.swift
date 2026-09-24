import SwiftUI
import UIKit

struct TodayView: View {
    @EnvironmentObject private var session: FieldDaySession
    @EnvironmentObject private var auth: AuthSession
    @EnvironmentObject private var api: AtmosphereClient
    @AppStorage("atm-theme") private var themeRaw = AppearancePreference.light.rawValue
    @State private var jobQuery = ""
    @State private var showNewJob = false
    @State private var safariURL: URL?

    private var appearance: AppearancePreference {
        AppearancePreference(rawValue: themeRaw) ?? .light
    }

    private var visibleJobs: [ExpectedJob] {
        let q = jobQuery.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if q.isEmpty { return session.jobs }
        return session.jobs.filter { job in
            [job.name, job.address, job.number, job.id]
                .joined(separator: " ")
                .lowercased()
                .contains(q)
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    Text(Date.now, format: .dateTime.weekday(.wide).month(.abbreviated).day())
                        .font(FieldTheme.mono)
                        .foregroundStyle(FieldTheme.faint)
                        .textCase(.uppercase)

                    Text("Start it and go to work")
                        .font(.system(size: 28, weight: .bold))
                        .foregroundStyle(FieldTheme.ink)

                    HStack(spacing: 10) {
                        Image(systemName: "magnifyingglass")
                            .foregroundStyle(FieldTheme.faint)
                        TextField("Search jobs", text: $jobQuery)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                        if !session.isShareMode {
                            Button {
                                showNewJob = true
                            } label: {
                                Image(systemName: "plus")
                                    .font(.system(size: 16, weight: .bold))
                                    .foregroundStyle(FieldTheme.accent)
                                    .frame(width: 32, height: 32)
                                    .background(FieldTheme.panel)
                                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(FieldTheme.line))
                                    .cornerRadius(8)
                            }
                            .accessibilityLabel("Start recording a new job")
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 11)
                    .background(FieldTheme.panel)
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(FieldTheme.line)
                    )

                    VStack(alignment: .leading, spacing: 8) {
                        Text("Jobs")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(FieldTheme.faint)
                            .textCase(.uppercase)
                        if session.loadingJobs {
                            Text("Loading jobs from your account…")
                                .font(.system(size: 13))
                                .foregroundStyle(FieldTheme.muted)
                        } else if session.jobs.isEmpty {
                            Text(
                                session.isShareMode
                                    ? "This share link has no job, or it expired."
                                    : "Nothing assigned yet. Tap + to start a new job, or ask the office to put you on one."
                            )
                                .font(.system(size: 13))
                                .foregroundStyle(FieldTheme.muted)
                        } else if visibleJobs.isEmpty {
                            Text("No matching jobs. Try a different name or address.")
                                .font(.system(size: 13))
                                .foregroundStyle(FieldTheme.muted)
                        }
                        ForEach(visibleJobs) { job in
                            Button {
                                session.activeJobId = job.id
                            } label: {
                                HStack {
                                    VStack(alignment: .leading, spacing: 2) {
                                        HStack(spacing: 6) {
                                            Text(job.name).font(.system(size: 14, weight: .semibold))
                                            if job.isLocalDraft {
                                                Text("On phone")
                                                    .font(.system(size: 10, weight: .bold))
                                                    .foregroundStyle(FieldTheme.accent)
                                                    .padding(.horizontal, 6)
                                                    .padding(.vertical, 2)
                                                    .overlay(Capsule().stroke(FieldTheme.accent.opacity(0.4)))
                                            }
                                        }
                                        Text(job.address.isEmpty ? " " : job.address)
                                            .font(.system(size: 12))
                                            .foregroundStyle(FieldTheme.muted)
                                    }
                                    Spacer()
                                    Text(job.filmed == true ? "Filmed" : job.at)
                                        .font(FieldTheme.mono)
                                        .foregroundStyle(job.filmed == true ? FieldTheme.pass : FieldTheme.faint)
                                    if session.activeJobId == job.id {
                                        Text("●")
                                            .foregroundStyle(FieldTheme.accent)
                                            .font(.system(size: 10))
                                    }
                                }
                                .padding(12)
                                .background(FieldTheme.panel)
                                .overlay(
                                    RoundedRectangle(cornerRadius: 10)
                                        .stroke(session.activeJobId == job.id ? FieldTheme.accent : FieldTheme.line)
                                )
                                .cornerRadius(10)
                            }
                            .buttonStyle(.plain)
                            .foregroundStyle(FieldTheme.ink)
                        }
                    }

                    if let warn = auth.restoreWarning, !session.isShareMode {
                        Text(warn)
                            .font(.system(size: 13))
                            .foregroundStyle(FieldTheme.muted)
                    }

                    if let err = session.lastError {
                        Text(err)
                            .font(.system(size: 13))
                            .foregroundStyle(FieldTheme.rec)
                    }
                }
                .padding(18)
            }
            .refreshable {
                await session.loadToday(api: api)
            }

            Button {
                Task { await session.startDay() }
            } label: {
                Label("Start the day", systemImage: "video.fill")
                    .font(.system(size: 17, weight: .bold))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                    .background(FieldTheme.ink)
                    .foregroundStyle(FieldTheme.bg)
                    .cornerRadius(12)
            }
            .padding(18)
        }
        .sheet(isPresented: $showNewJob) {
            NewJobView()
                .environmentObject(session)
                .environmentObject(api)
        }
        .sheet(item: Binding(
            get: { safariURL.map { IdentifiedURL(url: $0) } },
            set: { safariURL = $0?.url }
        )) { item in
            SafariView(url: item.url)
                .ignoresSafeArea()
        }
    }

    private var header: some View {
        HStack(spacing: 10) {
            AtmosphereBarsMark(size: 22)
            VStack(alignment: .leading, spacing: 1) {
                Text("Atmosphere")
                    .font(.system(size: 16, weight: .heavy))
                    .foregroundStyle(FieldTheme.ink)
                Text(
                    session.isShareMode
                        ? (session.shareCompany ?? "Shared job")
                        : (auth.orgName ?? "Field Capture")
                )
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(FieldTheme.muted)
                    .lineLimit(1)
            }
            Spacer()
            Menu {
                if session.isShareMode {
                    Text(session.shareCompany ?? "Job share")
                    Button("Leave shared job", role: .destructive) {
                        session.exitShareMode()
                        if auth.isLinked, !auth.needsOfficeLink, !auth.needsTermsAcceptance {
                            Task { await session.loadToday(api: api) }
                        }
                    }
                } else {
                    if let name = auth.fullName, !name.isEmpty {
                        Text(name)
                    } else if let email = auth.email, !email.hasSuffix("@field.atmosphere.app") {
                        Text(email)
                    }
                    if let office = auth.orgName {
                        Text("Office: \(office)")
                    }
                    Button(appearance.toggleLabel) {
                        var next = appearance
                        next.toggle()
                        themeRaw = next.rawValue
                    }
                    Button("Settings") {
                        safariURL = SupportLinks.platformSettingsURL
                    }
                    Button("Support") {
                        safariURL = SupportLinks.supportURL(
                            email: auth.email,
                            name: auth.fullName,
                            orgName: auth.orgName,
                            orgId: auth.orgId,
                            path: "ios/field-capture/today"
                        )
                    }
                    Button("Disconnect this phone", role: .destructive) {
                        Task {
                            await auth.disconnectAccount()
                            session.jobs = []
                            PendingJobsStore.clear()
                        }
                    }
                }
            } label: {
                FieldAccountChip(
                    name: auth.fullName,
                    email: auth.email,
                    org: auth.orgName,
                    avatarUrl: auth.avatarUrl
                )
            }
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 14)
        .background(FieldTheme.panel)
        .overlay(alignment: .bottom) { FieldTheme.line.frame(height: 1) }
    }
}

private struct IdentifiedURL: Identifiable {
    let url: URL
    var id: String { url.absoluteString }
}

/// Signed-in account chip: name, office, and the Platform profile photo.
/// Initials when the URL is missing or the image fails to load.
private struct FieldAccountChip: View {
    var name: String?
    var email: String?
    var org: String?
    var avatarUrl: String?

    private var title: String {
        let trimmed = name?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !trimmed.isEmpty { return trimmed }
        if let email, !email.hasSuffix("@field.atmosphere.app"), !email.isEmpty { return email }
        return "Account"
    }

    var body: some View {
        HStack(spacing: 9) {
            VStack(alignment: .trailing, spacing: 1) {
                Text(title)
                    .font(.system(size: 12.5, weight: .semibold))
                    .foregroundStyle(FieldTheme.ink)
                    .lineLimit(1)
                if let org, !org.isEmpty {
                    Text(org)
                        .font(.system(size: 11.5, weight: .regular))
                        .foregroundStyle(FieldTheme.muted)
                        .lineLimit(1)
                }
            }
            FieldAccountAvatar(name: name, email: email, avatarUrl: avatarUrl)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Account menu")
    }
}

private struct FieldAccountAvatar: View {
    var name: String?
    var email: String?
    var avatarUrl: String?
    var size: CGFloat = 28

    @State private var image: UIImage?

    private var initials: String {
        let parts = (name ?? "").split(whereSeparator: { $0.isWhitespace }).map(String.init)
        if parts.count >= 2 {
            let first = parts[0].prefix(1)
            let last = parts[parts.count - 1].prefix(1)
            return (first + last).uppercased()
        }
        if let word = parts.first, !word.isEmpty {
            return String(word.prefix(2)).uppercased()
        }
        let letters = (email ?? "").filter { $0.isLetter }
        if letters.count >= 2 { return String(letters.prefix(2)).uppercased() }
        return "•"
    }

    var body: some View {
        ZStack {
            Circle().fill(FieldTheme.accent)
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            } else {
                Text(initials)
                    .font(.system(size: size * 0.38, weight: .bold))
                    .foregroundStyle(Color.white)
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .accessibilityHidden(true)
        .task(id: avatarUrl) {
            image = await FieldAvatarImage.load(avatarUrl)
        }
    }
}

private enum FieldAvatarImage {
    static func load(_ raw: String?) async -> UIImage? {
        guard let url = displayableURL(raw) else { return nil }
        if url.scheme?.lowercased() == "data" {
            return imageFromDataURL(url)
        }
        do {
            let (data, response) = try await URLSession.shared.data(from: url)
            if let http = response as? HTTPURLResponse, !(200 ... 299).contains(http.statusCode) {
                return nil
            }
            return UIImage(data: data)
        } catch {
            return nil
        }
    }

    /// http(s) storage URLs and data:image pictures only.
    private static func displayableURL(_ raw: String?) -> URL? {
        guard let trimmed = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else {
            return nil
        }
        guard let url = URL(string: trimmed), let scheme = url.scheme?.lowercased() else { return nil }
        if scheme == "https" || scheme == "http" { return url }
        if scheme == "data", trimmed.hasPrefix("data:image/") { return url }
        return nil
    }

    private static func imageFromDataURL(_ url: URL) -> UIImage? {
        let raw = url.absoluteString
        guard let comma = raw.firstIndex(of: ",") else { return nil }
        let meta = raw[..<comma]
        guard meta.contains("base64") else { return nil }
        let payload = String(raw[raw.index(after: comma)...])
        guard let data = Data(base64Encoded: payload, options: .ignoreUnknownCharacters) else { return nil }
        return UIImage(data: data)
    }
}
