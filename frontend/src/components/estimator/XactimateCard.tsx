import { useEffect, useState } from 'react';
import {
  api,
  ApiError,
  type ConsentScope,
  type PriceListSummary,
  type XactimateStatus,
} from '../../lib/api';
import { SpinnerIcon, CheckIcon } from '../icons';

/**
 * The Xactimate connection card.
 *
 * This screen asks someone to hand over the password to a system holding their
 * carrier relationships and their customers' claim data. It is written on the
 * assumption that the user should be able to say no, or say yes to less — so the
 * permissions are individually checkable and default to read-only, the
 * session-only option is presented first and recommended, and what happens to
 * the password is stated in plain words rather than buried in a policy.
 *
 * The acknowledgement checkbox is not a liability shield. It is there because
 * whether automated access is permitted depends on the user's own agreement with
 * Verisk, and that is genuinely their call to make.
 */

const SCOPE_ORDER: ConsentScope[] = [
  'read_profile',
  'read_price_list',
  'read_estimates',
  'write_estimate',
  'submit_estimate',
];

/** Permissions that write to a real account get visually separated. */
const WRITE_SCOPES = new Set<ConsentScope>(['write_estimate', 'submit_estimate']);

type RemapRow = { from: string; to: string; description: string; via: string };

type ReconcileReview = {
  matched: number;
  unmatched: string[];
  remapped: RemapRow[];
};

export function XactimateCard({ onPriceListSynced }: { onPriceListSynced?: () => void }) {
  const [status, setStatus] = useState<XactimateStatus | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [mfaRequired, setMfaRequired] = useState(false);
  const [scopes, setScopes] = useState<ConsentScope[]>([]);
  const [storageMode, setStorageMode] = useState<'session' | 'stored'>('session');
  const [acknowledged, setAcknowledged] = useState(false);

  const [priceLists, setPriceLists] = useState<PriceListSummary[] | null>(null);

  const [uploadId, setUploadId] = useState('');
  const [uploadName, setUploadName] = useState('');
  const [uploadFileName, setUploadFileName] = useState<string | null>(null);
  const [uploadContent, setUploadContent] = useState<string | null>(null);

  const [reconcile, setReconcile] = useState<ReconcileReview | null>(null);
  const [showReconcile, setShowReconcile] = useState(false);

  const refresh = async () => {
    try {
      const next = await api.xactimateStatus();
      setStatus(next);
      if (scopes.length === 0) {
        setScopes(next.availableScopes.filter((s) => s.defaultGranted).map((s) => s.scope));
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not read the Xactimate connection.');
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleScope(scope: ConsentScope) {
    setScopes((current) =>
      current.includes(scope) ? current.filter((s) => s !== scope) : [...current, scope],
    );
  }

  function applyReconcileResult(result: {
    matched?: number;
    unmatched?: string[];
    remapped?: RemapRow[];
  }) {
    if (
      typeof result.matched === 'number' ||
      (result.unmatched && result.unmatched.length > 0) ||
      (result.remapped && result.remapped.length > 0)
    ) {
      setReconcile({
        matched: result.matched ?? 0,
        unmatched: result.unmatched ?? [],
        remapped: result.remapped ?? [],
      });
      setShowReconcile(true);
    }
  }

  async function connect(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.xactimateConnect({
        username: username.trim(),
        password,
        mfaCode: mfaCode.trim() || undefined,
        scopes,
        storageMode,
        consentDays: 30,
        acknowledgedTerms: true,
      });

      if (result.status === 'mfa_required') {
        setMfaRequired(true);
        setNotice(result.message);
        return;
      }

      // The password is not kept in component state a moment longer than the
      // request needs it — nothing here should survive a successful connect.
      setPassword('');
      setMfaCode('');
      setMfaRequired(false);
      setExpanded(false);
      setNotice(`Connected as ${result.profile.displayName ?? result.profile.username}.`);
      await refresh();
      await loadPriceLists();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not connect to Xactimate.');
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setError(null);
    try {
      await api.xactimateDisconnect();
      setPriceLists(null);
      setNotice('Disconnected. Any stored password was deleted.');
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not disconnect.');
    } finally {
      setBusy(false);
    }
  }

  async function resumeSession() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.xactimateResume();
      setNotice(
        `Session resumed as ${result.profile.displayName ?? result.profile.username}.`,
      );
      await refresh();
      await loadPriceLists();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not resume the Xactimate session.');
    } finally {
      setBusy(false);
    }
  }

  async function loadPriceLists() {
    try {
      const { priceLists: lists } = await api.xactimatePriceLists();
      setPriceLists(lists);
    } catch {
      setPriceLists([]);
    }
  }

  async function syncPriceList(priceListId: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.xactimateSyncPriceList(priceListId);
      const matchedSuffix =
        typeof result.matched === 'number'
          ? ` · ${result.matched.toLocaleString()} knowledge codes matched`
          : '';
      setNotice(
        `Synced ${result.name} — ${result.entryCount.toLocaleString()} priced items${matchedSuffix}.`,
      );
      applyReconcileResult(result);
      await refresh();
      onPriceListSynced?.();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'price_list_unavailable_via_web') {
        setError(
          'Browser automation cannot read a full price list reliably. Export the list from Xactimate and upload the CSV, TSV, or JSON file below.',
        );
      } else {
        setError(err instanceof ApiError ? err.message : 'Could not sync that price list.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function onUploadFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      setUploadFileName(null);
      setUploadContent(null);
      return;
    }
    setUploadFileName(file.name);
    setUploadContent(await file.text());
    if (!uploadId.trim()) {
      const stem = file.name.replace(/\.[^.]+$/, '');
      setUploadId(stem);
    }
    if (!uploadName.trim()) {
      setUploadName(file.name.replace(/\.[^.]+$/, ''));
    }
  }

  async function uploadPriceList(event: React.FormEvent) {
    event.preventDefault();
    if (!uploadContent || !uploadId.trim() || !uploadName.trim()) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.xactimateUploadPriceList({
        id: uploadId.trim(),
        name: uploadName.trim(),
        content: uploadContent,
        format: 'auto',
      });
      const matchedSuffix =
        typeof result.matched === 'number'
          ? ` · ${result.matched.toLocaleString()} knowledge codes matched`
          : '';
      setNotice(
        `Uploaded ${result.name ?? uploadName.trim()} — ${result.entryCount.toLocaleString()} priced items${matchedSuffix}.`,
      );
      applyReconcileResult(result);
      setUploadContent(null);
      setUploadFileName(null);
      await refresh();
      onPriceListSynced?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not upload that price list.');
    } finally {
      setBusy(false);
    }
  }

  async function reviewReconcile() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.xactimateReconcileCatalog();
      setReconcile({
        matched: result.matched,
        unmatched: result.unmatched,
        remapped: result.remapped,
      });
      setShowReconcile(true);
      setNotice(
        `Reconciled against ${result.priceListId ?? 'the active price list'} — ${result.matched.toLocaleString()} matched.`,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reconcile the catalog.');
    } finally {
      setBusy(false);
    }
  }

  async function lockRemaps() {
    if (!reconcile || reconcile.remapped.length === 0) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const remaps: Record<string, string> = {};
      for (const row of reconcile.remapped) {
        remaps[row.from] = row.to;
      }
      await api.xactimateSaveRemaps(remaps);
      setNotice(`Locked ${Object.keys(remaps).length.toLocaleString()} account-code remaps.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save remaps.');
    } finally {
      setBusy(false);
    }
  }

  if (!status) {
    return (
      <div className="rounded-xl glass-card p-5">
        <SpinnerIcon className="animate-spin text-brand-300" width={18} height={18} />
      </div>
    );
  }

  const canResume =
    status.connected && !status.sessionActive && status.storageMode === 'stored';

  return (
    <div className="rounded-xl glass-card p-5 backdrop-blur">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Xactimate</p>
          <p className="mt-1 flex items-center gap-2 text-lg font-semibold text-ink-900">
            {status.connected ? (
              <>
                <CheckIcon className="text-success-600" width={18} height={18} />
                {status.username}
              </>
            ) : (
              'Not connected'
            )}
          </p>
          {status.connected && status.expiresAt && (
            <p className="mt-1 text-xs text-ink-500">
              Permission expires {new Date(status.expiresAt).toLocaleDateString()} ·{' '}
              {status.storageMode === 'session'
                ? 'password not stored'
                : 'password stored, encrypted'}
              {!status.sessionActive && ' · session ended, sign in again to push'}
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {canResume && (
            <button
              onClick={resumeSession}
              disabled={busy}
              className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-brand-500 disabled:opacity-60"
            >
              Resume session
            </button>
          )}
          {status.connected ? (
            <button
              onClick={disconnect}
              disabled={busy}
              className="rounded-lg border border-line bg-paper-200 px-3 py-1.5 text-sm text-ink-800 transition hover:bg-paper-300 disabled:opacity-60"
            >
              Disconnect
            </button>
          ) : (
            <button
              onClick={() => setExpanded((value) => !value)}
              className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-brand-500"
            >
              {expanded ? 'Cancel' : 'Connect account'}
            </button>
          )}
        </div>
      </div>

      {status.driver === 'mock' && (
        <p className="mt-3 rounded-lg border border-caution-200 bg-caution-50 px-3 py-2 text-xs text-caution-600">
          This server is running the <strong>demo driver</strong> — it does not reach Xactimate at
          all. Any username and password will &quot;connect&quot;, and the price list is synthetic.
          Set <code className="font-mono">XACTIMATE_DRIVER</code> to{' '}
          <code className="font-mono">api</code> or <code className="font-mono">web</code> for a
          real connection.
        </p>
      )}

      {status.driver === 'web' && (
        <p className="mt-3 rounded-lg border border-sky-500/20 bg-sky-500/10 px-3 py-2 text-xs text-sky-200">
          This server uses <strong>browser automation</strong> against Xactimate Online. It can
          sign in, write estimates, and accept an uploaded price-list export — it will not scrape
          a live price grid. Prefer exporting CSV/TSV/JSON from Xactimate and uploading it below.
        </p>
      )}

      {error && (
        <p className="mt-3 rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-600">
          {error}
        </p>
      )}
      {notice && !error && (
        <p className="mt-3 rounded-lg border border-success-200 bg-success-50 px-3 py-2 text-sm text-success-600">
          {notice}
        </p>
      )}

      {/* ---- Price list (always visible so orgs can upload without login) ---- */}
      <div className="mt-4 border-t border-white/10 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-medium text-white">Price list</p>
            <p className="text-xs text-gray-500">
              {status.priceListId
                ? `Estimating against ${status.priceListId}.`
                : 'No price list synced — every price is a placeholder until one is.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={reviewReconcile}
              disabled={busy}
              className="rounded-lg border border-line bg-paper-200 px-3 py-1.5 text-xs text-ink-800 transition hover:bg-paper-300 disabled:opacity-60"
            >
              Review knowledge → account code matches
            </button>
            {status.connected && (
              <button
                onClick={loadPriceLists}
                disabled={busy}
                className="rounded-lg border border-white/10 bg-ink-700/70 px-3 py-1.5 text-xs text-gray-200 transition hover:bg-ink-600 disabled:opacity-60"
              >
                {priceLists ? 'Refresh' : 'Show available'}
              </button>
            )}
          </div>
        </div>

        {status.connected && priceLists && priceLists.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {priceLists.map((list) => (
              <li
                key={list.id}
                className="flex items-center justify-between gap-3 rounded-lg bg-ink-700/50 px-3 py-2"
              >
                <span className="text-sm text-gray-200">
                  {list.name}
                  {list.effectiveDate && (
                    <span className="ml-2 text-xs text-gray-500">
                      effective {list.effectiveDate}
                    </span>
                  )}
                </span>
                <button
                  onClick={() => syncPriceList(list.id)}
                  disabled={busy}
                  className="shrink-0 rounded-md bg-brand-600 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-brand-500 disabled:opacity-60"
                >
                  {status.priceListId === list.id ? 'Re-sync' : 'Use this'}
                </button>
              </li>
            ))}
          </ul>
        )}
        {status.connected && priceLists?.length === 0 && (
          <p className="mt-2 text-xs text-gray-500">
            No price lists came back. If this account uses browser access, export the price list
            from Xactimate and upload it instead — scraping a paginated price grid would mis-price
            the estimate.
          </p>
        )}

        <form onSubmit={uploadPriceList} className="mt-4 space-y-3">
          <p className="text-xs text-gray-500">
            Upload a CSV, TSV, or JSON export. No Xactimate login required — useful when the web
            driver cannot read the live grid.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs font-medium text-gray-400">Price list id</span>
              <input
                type="text"
                value={uploadId}
                onChange={(e) => setUploadId(e.target.value)}
                placeholder="e.g. TXAG8X_JUN25"
                required
                className="mt-1 w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-brand-500"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-gray-400">Display name</span>
              <input
                type="text"
                value={uploadName}
                onChange={(e) => setUploadName(e.target.value)}
                placeholder="e.g. Texas Aug 2025"
                required
                className="mt-1 w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-brand-500"
              />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-white/10 bg-ink-700/70 px-3 py-2 text-xs text-gray-200 transition hover:bg-ink-600">
              <input
                type="file"
                accept=".csv,.tsv,.json,text/csv,text/tab-separated-values,application/json"
                onChange={onUploadFileChange}
                className="sr-only"
              />
              {uploadFileName ? 'Change file' : 'Choose file'}
            </label>
            {uploadFileName && (
              <span className="truncate text-xs text-gray-400">{uploadFileName}</span>
            )}
            <button
              type="submit"
              disabled={busy || !uploadContent || !uploadId.trim() || !uploadName.trim()}
              className="ml-auto flex items-center gap-2 rounded-lg bg-brand-600 px-3 py-2 text-xs font-medium text-white transition hover:bg-brand-500 disabled:opacity-50"
            >
              {busy && <SpinnerIcon className="animate-spin" width={14} height={14} />}
              Upload price list
            </button>
          </div>
        </form>

        {showReconcile && reconcile && (
          <div className="mt-4 space-y-3 rounded-lg border border-white/10 bg-ink-900/50 p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-white">Knowledge → account codes</p>
                <p className="text-xs text-gray-500">
                  {reconcile.matched.toLocaleString()} matched
                  {reconcile.remapped.length > 0 &&
                    ` · ${reconcile.remapped.length.toLocaleString()} remapped`}
                  {reconcile.unmatched.length > 0 &&
                    ` · ${reconcile.unmatched.length.toLocaleString()} unmatched`}
                </p>
              </div>
              <div className="flex gap-2">
                {reconcile.remapped.length > 0 && (
                  <button
                    onClick={lockRemaps}
                    disabled={busy}
                    className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-brand-500 disabled:opacity-60"
                  >
                    Lock remaps
                  </button>
                )}
                <button
                  onClick={() => setShowReconcile(false)}
                  className="rounded-lg border border-white/10 bg-ink-700/70 px-3 py-1.5 text-xs text-gray-200 transition hover:bg-ink-600"
                >
                  Hide
                </button>
              </div>
            </div>

            {reconcile.remapped.length > 0 && (
              <div>
                <p className="text-xs font-medium text-gray-400">Remapped</p>
                <ul className="mt-1.5 max-h-40 space-y-1 overflow-y-auto">
                  {reconcile.remapped.map((row) => (
                    <li
                      key={`${row.from}->${row.to}`}
                      className="rounded-md bg-ink-700/50 px-2.5 py-1.5 text-xs text-gray-300"
                    >
                      <span className="font-mono text-brand-300">{row.from}</span>
                      <span className="mx-1.5 text-gray-500">→</span>
                      <span className="font-mono text-emerald-300">{row.to}</span>
                      {row.description && (
                        <span className="ml-2 text-gray-500">{row.description}</span>
                      )}
                      {row.via && (
                        <span className="ml-1.5 text-gray-600">({row.via})</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {reconcile.unmatched.length > 0 && (
              <div>
                <p className="text-xs font-medium text-gray-400">Unmatched</p>
                <ul className="mt-1.5 max-h-32 space-y-1 overflow-y-auto">
                  {reconcile.unmatched.map((code) => (
                    <li
                      key={code}
                      className="rounded-md bg-ink-700/50 px-2.5 py-1.5 font-mono text-xs text-amber-200"
                    >
                      {code}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ---- Connect form ---- */}
      {expanded && !status.connected && (
        <form onSubmit={connect} className="mt-4 space-y-4 border-t border-line pt-4">
          <div className="rounded-lg border border-line bg-paper-100/50 p-3 text-xs leading-relaxed text-ink-600">
            <p className="font-medium text-ink-700">What happens when you connect</p>
            <ul className="mt-1.5 list-disc space-y-1 pl-4">
              <li>
                Atmosphere signs in to <strong>your</strong> Xactimate account and acts as you, only
                within the permissions you tick below.
              </li>
              <li>
                In session-only mode your password is used for this sign-in and never written to
                disk. Nothing is kept that a database leak could expose.
              </li>
              <li>
                Permission lapses after 30 days, and you can revoke it at any moment — which also
                deletes any stored password.
              </li>
              <li>
                Everything done in your account is logged and visible to you under Activity.
              </li>
              <li>
                Whether automated access is allowed depends on your own agreement with Verisk.
                That&apos;s your call to make, not ours.
              </li>
            </ul>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs font-medium text-ink-600">Xactimate username</span>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="off"
                required
                className="mt-1 w-full rounded-lg border border-line bg-paper-100 px-3 py-2 text-sm text-ink-900 outline-none focus:border-brand-500"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-ink-600">Password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="off"
                required
                className="mt-1 w-full rounded-lg border border-line bg-paper-100 px-3 py-2 text-sm text-ink-900 outline-none focus:border-brand-500"
              />
            </label>
          </div>

          {mfaRequired && (
            <label className="block">
              <span className="text-xs font-medium text-ink-600">Verification code</span>
              <input
                type="text"
                inputMode="numeric"
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value)}
                className="mt-1 w-40 rounded-lg border border-line bg-paper-100 px-3 py-2 font-mono text-sm tracking-widest text-ink-900 outline-none focus:border-brand-500"
              />
            </label>
          )}

          <fieldset>
            <legend className="text-xs font-medium text-ink-600">
              What Atmosphere may do in your account
            </legend>
            <div className="mt-2 space-y-1.5">
              {SCOPE_ORDER.map((scope) => {
                const meta = status.availableScopes.find((s) => s.scope === scope);
                if (!meta) return null;
                const isWrite = WRITE_SCOPES.has(scope);
                return (
                  <label
                    key={scope}
                    className={`flex cursor-pointer items-start gap-2.5 rounded-lg px-2.5 py-2 transition ${
                      isWrite ? 'bg-caution-50 ring-1 ring-inset ring-caution-200' : 'bg-paper-200'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={scopes.includes(scope)}
                      onChange={() => toggleScope(scope)}
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-line-strong bg-paper-100 accent-brand-500"
                    />
                    <span className="text-sm text-ink-700">
                      {meta.description}
                      {isWrite && (
                        <span className="ml-1.5 text-xs text-caution-600">— changes your account</span>
                      )}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <fieldset>
            <legend className="text-xs font-medium text-ink-600">Your password</legend>
            <div className="mt-2 space-y-1.5">
              <label className="flex cursor-pointer items-start gap-2.5 rounded-lg bg-paper-200 px-2.5 py-2">
                <input
                  type="radio"
                  checked={storageMode === 'session'}
                  onChange={() => setStorageMode('session')}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-brand-500"
                />
                <span className="text-sm text-gray-300">
                  Don&apos;t store it <span className="text-emerald-400">— recommended</span>
                  <span className="block text-xs text-gray-500">
                    Used for this sign-in only. You&apos;ll re-enter it next session.
                  </span>
                </span>
              </label>
              <label
                className={`flex items-start gap-2.5 rounded-lg bg-paper-200 px-2.5 py-2 ${
                  status.storageAvailable ? 'cursor-pointer' : 'opacity-50'
                }`}
              >
                <input
                  type="radio"
                  checked={storageMode === 'stored'}
                  disabled={!status.storageAvailable}
                  onChange={() => setStorageMode('stored')}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-brand-500"
                />
                <span className="text-sm text-ink-700">
                  Store it encrypted
                  <span className="block text-xs text-ink-500">
                    {status.storageAvailable
                      ? 'Needed only for unattended work like a nightly price sync.'
                      : 'Unavailable — this server has no encryption key configured.'}
                  </span>
                </span>
              </label>
            </div>
          </fieldset>

          <label className="flex cursor-pointer items-start gap-2.5">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-line-strong bg-paper-100 accent-brand-500"
            />
            <span className="text-xs text-gray-400">
              I&apos;ve read the above, this is my own Xactimate account, and I&apos;m authorising
              Atmosphere to use it on my behalf.
            </span>
          </label>

          <button
            type="submit"
            disabled={busy || !acknowledged || scopes.length === 0}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-brand-500 disabled:opacity-50"
          >
            {busy && <SpinnerIcon className="animate-spin" width={16} height={16} />}
            {mfaRequired ? 'Verify and connect' : 'Connect Xactimate'}
          </button>
        </form>
      )}
    </div>
  );
}
