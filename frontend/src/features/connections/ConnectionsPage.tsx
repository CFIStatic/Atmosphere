import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Cable,
  Check,
  KeyRound,
  Link2,
  Lock,
  MonitorCog,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import {
  Badge,
  Button,
  Drawer,
  EmptyState,
  SearchInput,
  SegmentedControl,
  Skeleton,
  StatusDot,
  cn,
} from '../../design';
import { ConnectionLogo, PageBody, PageHeader } from '../../patterns';
import { connectionStatusLabel, connectionStatusTone } from '../../patterns/tone';
import { useConnectApp, useConnections, useDisconnectApp, useResyncApp } from '../../data/hooks';
import { CAPABILITY_LABELS } from '../../domain/routing';
import { can } from '../../domain/permissions';
import {
  blindCapabilities,
  compareForCatalogue,
  isLive,
  needsAttention,
  summarise,
} from '../../domain/connections';
import { relativeTime, titleCase } from '../../domain/format';
import { useViewer } from '../../shell/ViewerContext';
import type { AuthMethod, Connection, ConnectionCategory } from '../../domain/types';

/**
 * Connected systems.
 *
 * A restoration company's system of record is spread across a dozen vendors —
 * the estimate is in Xactimate, the assignment came from a carrier portal, the
 * photos are in Encircle, the money is in QuickBooks, and the signed
 * authorization is a PDF on the office server. Atmosphere can only act on what
 * it can reach, which makes this an operational surface rather than a settings
 * page.
 *
 * The organising idea is `powers`: every connection names the agent capabilities
 * that depend on it. That turns a dead integration into a statement an operator
 * can act on — "collections is blind" — instead of a sync error nobody reads.
 */

const CATEGORY_LABELS: Record<ConnectionCategory, string> = {
  estimating: 'Estimating',
  claims: 'Claims & carrier networks',
  job_management: 'Job management',
  documentation: 'Field documentation',
  equipment: 'Equipment & drying',
  accounting: 'Accounting & payments',
  communication: 'Communication',
  storage: 'Document storage',
  scheduling: 'Scheduling',
  workforce: 'Payroll & workforce',
};

/** Order reflects how central each category is to running a restoration job. */
const CATEGORY_ORDER: ConnectionCategory[] = [
  'estimating',
  'claims',
  'job_management',
  'documentation',
  'equipment',
  'accounting',
  'communication',
  'storage',
  'scheduling',
  'workforce',
];

const AUTH_LABELS: Record<AuthMethod, string> = {
  oauth: 'Sign in with the vendor',
  api_key: 'API key',
  credentials: 'Portal credentials',
  desktop_agent: 'Desktop agent',
  file_share: 'Network path',
  partner_request: 'Partner approval required',
};

const AUTH_ICONS: Record<AuthMethod, typeof KeyRound> = {
  oauth: ShieldCheck,
  api_key: KeyRound,
  credentials: Lock,
  desktop_agent: MonitorCog,
  file_share: Server,
  partner_request: Sparkles,
};

type Filter = 'all' | 'connected' | 'attention' | 'available';

export function ConnectionsPage() {
  const { role } = useViewer();
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Connection | null>(null);

  const { data: connections = [], isLoading } = useConnections();
  const connect = useConnectApp();
  const disconnect = useDisconnectApp();
  const resync = useResyncApp();

  const mayManage = can(role, 'manage_connections');

  const coverage = summarise(connections);
  const broken = connections.filter(needsAttention);

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    return connections
      .filter((c) => {
        if (filter === 'connected') return isLive(c);
        if (filter === 'attention') return needsAttention(c);
        if (filter === 'available') return !isLive(c);
        return true;
      })
      .filter(
        (c) =>
          !term ||
          c.name.toLowerCase().includes(term) ||
          c.vendor.toLowerCase().includes(term) ||
          c.summary.toLowerCase().includes(term) ||
          CATEGORY_LABELS[c.category].toLowerCase().includes(term),
      );
  }, [connections, filter, query]);

  const grouped = useMemo(() => {
    const map = new Map<ConnectionCategory, Connection[]>();
    for (const c of visible) {
      const list = map.get(c.category) ?? [];
      list.push(c);
      map.set(c.category, list);
    }
    for (const list of map.values()) list.sort(compareForCatalogue);
    return CATEGORY_ORDER.filter((cat) => map.has(cat)).map((cat) => [cat, map.get(cat)!] as const);
  }, [visible]);

  const blind = useMemo(() => blindCapabilities(connections), [connections]);

  const current = selected ? (connections.find((c) => c.id === selected.id) ?? selected) : null;
  const busy = connect.isPending || disconnect.isPending || resync.isPending;

  return (
    <>
      <PageHeader
        title="Connections"
        description={`${coverage.live} connected · ${coverage.available} available${
          broken.length ? ` · ${broken.length} need attention` : ''
        }`}
        actions={
          <SearchInput
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search apps…"
            className="w-56"
          />
        }
      >
        <SegmentedControl
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'connected', label: `Connected · ${coverage.live}` },
            { value: 'attention', label: `Needs attention · ${broken.length}` },
            { value: 'available', label: 'Available' },
          ]}
          aria-label="Filter connections"
        />
      </PageHeader>

      <PageBody className="space-y-5">
        {/* ── What is broken, and what it costs ──────────────────────────── */}
        {broken.length > 0 && (
          <div className="rounded-xl border border-state-warn/25 bg-state-warn/[0.07] p-4">
            <p className="flex items-center gap-2 text-sm font-medium text-state-warn">
              <AlertTriangle className="h-4 w-4" />
              {broken.length} connection{broken.length === 1 ? '' : 's'} need attention
            </p>
            <ul className="mt-2 space-y-1.5">
              {broken.map((c) => (
                <li key={c.id} className="text-xs text-fg-3">
                  <button
                    type="button"
                    onClick={() => setSelected(c)}
                    className="font-medium text-fg-2 underline-offset-2 hover:underline"
                  >
                    {c.name}
                  </button>
                  {c.issue ? ` — ${c.issue}` : ''}
                  {c.powers.length > 0 && (
                    <span className="text-fg-4">
                      {' '}
                      · affects {c.powers.map((p) => CAPABILITY_LABELS[p]).join(', ')}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {blind.length > 0 && (
          <div className="rounded-xl border border-line/10 bg-surface/60 p-4">
            <p className="text-2xs font-semibold uppercase tracking-wider text-fg-4">
              Capabilities with no working connection
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {blind.map((cap) => (
                <Badge key={cap} tone="warn">
                  {CAPABILITY_LABELS[cap]}
                </Badge>
              ))}
            </div>
            <p className="mt-2 text-xs text-fg-4">
              These agents can still reason, but they cannot see or change anything until a system
              behind them is connected.
            </p>
          </div>
        )}

        {/* ── Catalogue ──────────────────────────────────────────────────── */}
        {isLoading ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 9 }).map((_, i) => (
              <Skeleton key={i} className="h-36 rounded-xl" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <EmptyState
            icon={<Search className="h-7 w-7" />}
            title="No apps match"
            description="Try a different search term or filter."
          />
        ) : (
          grouped.map(([category, items]) => (
            <section key={category}>
              <h2 className="mb-2 flex items-baseline gap-2 text-xs font-semibold text-fg-2">
                {CATEGORY_LABELS[category]}
                <span className="text-2xs font-normal text-fg-4">
                  {items.filter(isLive).length} of {items.length} connected
                </span>
              </h2>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {items.map((c) => (
                  <ConnectionCard key={c.id} connection={c} onOpen={() => setSelected(c)} />
                ))}
              </div>
            </section>
          ))
        )}

        <p className="text-2xs text-fg-4">
          Missing something you run? Connections are added by category — tell Atmosphere which
          system and it will be prioritised against what other restorers are asking for.
        </p>
      </PageBody>

      <ConnectionDrawer
        connection={current}
        open={Boolean(current)}
        onOpenChange={(open) => !open && setSelected(null)}
        mayManage={mayManage}
        busy={busy}
        onConnect={(id) => connect.mutate(id)}
        onDisconnect={(id) => disconnect.mutate(id)}
        onResync={(id) => resync.mutate(id)}
      />
    </>
  );
}

function ConnectionCard({ connection, onOpen }: { connection: Connection; onOpen: () => void }) {
  const live = isLive(connection);
  const AuthIcon = AUTH_ICONS[connection.authMethod];

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'flex flex-col rounded-xl border p-4 text-left transition',
        'hover:border-line/20 hover:bg-surface/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/60',
        needsAttention(connection)
          ? 'border-state-warn/30 bg-surface/60'
          : 'border-line/10 bg-surface/60',
        connection.status === 'coming_soon' && 'opacity-60',
      )}
    >
      <div className="flex w-full items-start gap-3">
        <span className="relative">
          <ConnectionLogo connection={connection} />
          <span className="absolute -bottom-0.5 -right-0.5 rounded-full border-2 border-surface">
            <StatusDot
              tone={connectionStatusTone[connection.status]}
              pulse={connection.status === 'connected'}
            />
          </span>
        </span>
        <div className="min-w-0 flex-1">
          {/* Wraps rather than truncates — "Contractor Connection" and "Sedgwick
              Repair Solutions" are the TPA names an operator scans for. */}
          <h3 className="text-sm font-semibold leading-tight text-fg">{connection.name}</h3>
          <p className="mt-0.5 truncate text-2xs text-fg-4">{connection.vendor}</p>
        </div>
        <Badge tone={connectionStatusTone[connection.status]} className="shrink-0">
          {connectionStatusLabel[connection.status]}
        </Badge>
      </div>

      <p className="mt-2 line-clamp-2 flex-1 text-xs leading-relaxed text-fg-3">
        {connection.summary}
      </p>

      {connection.issue && (
        <p className="mt-2 line-clamp-2 text-2xs text-state-warn">{connection.issue}</p>
      )}

      <div className="mt-3 flex w-full items-center justify-between gap-2 border-t border-line/5 pt-2.5 text-2xs text-fg-4">
        <span className="flex items-center gap-1.5">
          <AuthIcon className="h-3 w-3" />
          {AUTH_LABELS[connection.authMethod]}
        </span>
        {live && connection.lastSyncAt ? (
          <span>{relativeTime(connection.lastSyncAt)}</span>
        ) : connection.popular && !live ? (
          <span className="text-brand-400">Popular</span>
        ) : null}
      </div>
    </button>
  );
}

function ConnectionDrawer({
  connection,
  open,
  onOpenChange,
  mayManage,
  busy,
  onConnect,
  onDisconnect,
  onResync,
}: {
  connection: Connection | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mayManage: boolean;
  busy: boolean;
  onConnect: (id: string) => void;
  onDisconnect: (id: string) => void;
  onResync: (id: string) => void;
}) {
  if (!connection) return null;

  const live = isLive(connection);
  const AuthIcon = AUTH_ICONS[connection.authMethod];
  const comingSoon = connection.status === 'coming_soon';

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title={connection.name}
      description={connection.vendor}
      footer={
        mayManage ? (
          <div className="flex flex-wrap items-center gap-2">
            {comingSoon ? (
              <Button size="sm" variant="secondary" disabled>
                Not available yet
              </Button>
            ) : live ? (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  loading={busy}
                  leadingIcon={<RefreshCw className="h-3.5 w-3.5" />}
                  onClick={() => onResync(connection.id)}
                >
                  Sync now
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  loading={busy}
                  onClick={() => onDisconnect(connection.id)}
                >
                  Disconnect
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="primary"
                loading={busy}
                leadingIcon={<Link2 className="h-3.5 w-3.5" />}
                onClick={() => onConnect(connection.id)}
              >
                {connection.authMethod === 'partner_request' ? 'Request access' : 'Connect'}
              </Button>
            )}
          </div>
        ) : (
          <p className="text-2xs text-fg-4">
            Connections are managed by an Office Manager or above.
          </p>
        )
      }
    >
      <div className="space-y-5 px-5 py-4">
        <div className="flex items-start gap-3">
          <ConnectionLogo connection={connection} size="lg" />
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <Badge tone={connectionStatusTone[connection.status]}>
              {connectionStatusLabel[connection.status]}
            </Badge>
            <Badge tone="idle">{CATEGORY_LABELS[connection.category]}</Badge>
            {connection.popular && <Badge tone="brand">Commonly used</Badge>}
          </div>
        </div>

        <p className="text-sm leading-relaxed text-fg-2">{connection.summary}</p>

        {connection.issue && (
          <div className="rounded-lg border border-state-warn/25 bg-state-warn/[0.07] px-3 py-2.5">
            <p className="text-2xs font-semibold uppercase tracking-wider text-state-warn">
              Current issue
            </p>
            <p className="mt-1 text-xs leading-relaxed text-fg-2">{connection.issue}</p>
          </div>
        )}

        <Section label="What moves">
          <ul className="space-y-1.5">
            {connection.dataFlows.map((flow, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-fg-2">
                {flow.direction === 'out' ? (
                  <ArrowUpFromLine className="mt-0.5 h-3.5 w-3.5 shrink-0 text-state-info" />
                ) : flow.direction === 'in' ? (
                  <ArrowDownToLine className="mt-0.5 h-3.5 w-3.5 shrink-0 text-state-ok" />
                ) : (
                  <Cable className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-400" />
                )}
                <span>
                  {flow.label}
                  <span className="ml-1.5 text-fg-4">
                    {flow.direction === 'in'
                      ? 'into Atmosphere'
                      : flow.direction === 'out'
                        ? 'out to ' + connection.name
                        : 'both ways'}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Section>

        {connection.powers.length > 0 && (
          <Section label="Agents that depend on this">
            <div className="flex flex-wrap gap-1.5">
              {connection.powers.map((cap) => (
                <Badge key={cap} tone={live ? 'ok' : 'idle'}>
                  {CAPABILITY_LABELS[cap]}
                </Badge>
              ))}
            </div>
            {!live && (
              <p className="mt-2 text-2xs leading-relaxed text-fg-4">
                Until this is connected, those agents cannot see or change anything in{' '}
                {connection.name}.
              </p>
            )}
          </Section>
        )}

        <Section label="How it connects">
          <div className="flex items-start gap-2 text-xs text-fg-2">
            <AuthIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-4" />
            <div>
              <p>{AUTH_LABELS[connection.authMethod]}</p>
              <p className="mt-0.5 text-2xs leading-relaxed text-fg-4">
                {AUTH_NOTES[connection.authMethod]}
              </p>
            </div>
          </div>
        </Section>

        {live && (
          <Section label="Status">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
              <Detail label="Account" value={connection.accountLabel ?? '—'} />
              <Detail
                label="Last sync"
                value={connection.lastSyncAt ? relativeTime(connection.lastSyncAt) : 'Never'}
              />
              <Detail
                label="Records synced"
                value={
                  connection.recordsSynced !== null
                    ? connection.recordsSynced.toLocaleString()
                    : '—'
                }
              />
              <Detail label="Category" value={titleCase(connection.category)} />
            </dl>
          </Section>
        )}

        <p className="flex items-start gap-2 rounded-lg border border-line/10 bg-raised/40 px-3 py-2.5 text-2xs leading-relaxed text-fg-4">
          <Check className="mt-0.5 h-3 w-3 shrink-0 text-state-ok" />
          Atmosphere reads and writes through this connection only when an action has been approved.
          Nothing changes in {connection.name} without sign-off.
        </p>
      </div>
    </Drawer>
  );
}

const AUTH_NOTES: Record<AuthMethod, string> = {
  oauth:
    'You sign in at the vendor; Atmosphere never sees the password and access can be revoked there at any time.',
  api_key:
    'Generate a key in the vendor’s admin settings and paste it in. Scope it to the minimum the integration needs.',
  credentials:
    'The portal has no API, so Atmosphere signs in as a dedicated service user. Create one rather than reusing a person’s login.',
  desktop_agent:
    'Runs on the machine that hosts the software. It stops when that machine sleeps or reboots, which is the usual cause of a stale sync.',
  file_share:
    'Point Atmosphere at a UNC path or mount. Requires network reachability and read access for the service account.',
  partner_request:
    'The network has to approve the connection on their side. Expect a lead time measured in days, not minutes.',
};

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-2xs font-semibold uppercase tracking-wider text-fg-4">{label}</p>
      {children}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-2xs text-fg-4">{label}</dt>
      <dd className="truncate text-xs text-fg-2">{value}</dd>
    </div>
  );
}
