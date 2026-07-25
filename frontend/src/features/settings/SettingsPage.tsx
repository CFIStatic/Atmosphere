import { Badge, Card, CardBody, CardHeader } from '../../design';
import { PageBody, PageHeader } from '../../patterns';
import { PinSetupCard } from '../../components/PinSetupCard';
import { useAuth } from '../../context/AuthContext';
import { labelForRole } from '../../domain/approvals';
import { ROLE_PROFILES } from '../../domain/permissions';
import { titleCase } from '../../domain/format';
import { useViewer } from '../../shell/ViewerContext';

export function SettingsPage() {
  const { user, membership } = useAuth();
  const { role, actualRole, isOverridden } = useViewer();
  const profile = ROLE_PROFILES[role];

  return (
    <>
      <PageHeader title="Settings" description="Your account, organization, and sign-in options" />

      <PageBody className="max-w-3xl space-y-4">
        <Card>
          <CardHeader title="Account" />
          <CardBody className="space-y-2.5 text-sm">
            <Row label="Email" value={user?.email ?? '—'} />
            <Row label="Role" value={labelForRole(actualRole)} />
            {isOverridden && (
              <Row
                label="Viewing as"
                value={
                  <Badge tone="warn">
                    {labelForRole(role)} — presentation only, permissions unchanged
                  </Badge>
                }
              />
            )}
            <Row label="Organization" value={membership?.org?.name ?? '—'} />
            {membership?.org?.joinCode && (
              <Row
                label="Invite code"
                value={
                  <code className="rounded bg-ink-700 px-2 py-0.5 font-mono text-xs tracking-widest text-brand-300">
                    {membership.org.joinCode}
                  </code>
                }
              />
            )}
            {membership?.workType && (
              <Row label="Work type" value={titleCase(membership.workType)} />
            )}
          </CardBody>
        </Card>

        <PinSetupCard />

        <Card>
          <CardHeader
            title="What this role can do"
            description="Capabilities are enforced server-side; this is the summary"
          />
          <CardBody className="space-y-3">
            <div>
              <p className="mb-1.5 text-2xs font-semibold uppercase tracking-wider text-gray-600">
                Visible sections
              </p>
              <div className="flex flex-wrap gap-1">
                {profile.nav.map((key) => (
                  <Badge key={key} tone="idle">
                    {titleCase(key.replace('-', '_'))}
                  </Badge>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-1.5 text-2xs font-semibold uppercase tracking-wider text-gray-600">
                Permissions
              </p>
              {profile.capabilities.length === 0 ? (
                <p className="text-xs text-gray-600">No elevated permissions.</p>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {profile.capabilities.map((cap) => (
                    <Badge key={cap} tone="brand">
                      {titleCase(cap)}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </CardBody>
        </Card>
      </PageBody>
    </>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium text-gray-200">{value}</span>
    </div>
  );
}
