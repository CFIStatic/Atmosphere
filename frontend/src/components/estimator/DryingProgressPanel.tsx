import { useMemo, useState } from 'react';
import type {
  DryingProgress,
  DryingReportInput,
  EquipmentPlan,
  MitigationEstimate,
} from '../../lib/api';

/**
 * Equipment plan + drying progress.
 *
 * Answers the questions estimators ask as a job unfolds: how many air movers
 * does a 2-foot flood cut need, is the drying working, which rooms are at
 * standard, and what happens when the next visit report lands.
 */

export function DryingProgressPanel({
  estimate,
  localReports,
  onAppendLocal,
  onAppendSaved,
  jobId,
  busy,
}: {
  estimate: MitigationEstimate;
  localReports: DryingReportInput[];
  onAppendLocal: (report: DryingReportInput) => void;
  onAppendSaved?: (report: DryingReportInput) => Promise<void>;
  jobId?: string | null;
  busy?: boolean;
}) {
  const plan = estimate.equipmentPlan;
  const progress = estimate.dryingProgress;
  const [openForm, setOpenForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [notes, setNotes] = useState('');
  const [dryRooms, setDryRooms] = useState('');
  const [wetRooms, setWetRooms] = useState('');
  const [affectedTemp, setAffectedTemp] = useState('72');
  const [affectedRh, setAffectedRh] = useState('45');
  const [unaffectedTemp, setUnaffectedTemp] = useState('72');
  const [unaffectedRh, setUnaffectedRh] = useState('55');
  const [airMovers, setAirMovers] = useState('');
  const [dehus, setDehus] = useState('');

  const roomOptions = useMemo(
    () => estimate.assessment.rooms.map((r) => r.name).filter(Boolean),
    [estimate.assessment.rooms],
  );

  async function submitVisit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSaving(true);
    try {
      const takenAt = new Date().toISOString();
      const psychrometrics: DryingReportInput['psychrometrics'] = [];
      const at = Number(affectedTemp);
      const arh = Number(affectedRh);
      const ut = Number(unaffectedTemp);
      const urh = Number(unaffectedRh);
      if (Number.isFinite(at) && Number.isFinite(arh)) {
        psychrometrics.push({
          takenAt,
          zone: 'affected',
          temperatureF: at,
          relativeHumidity: arh,
        });
      }
      if (Number.isFinite(ut) && Number.isFinite(urh)) {
        psychrometrics.push({
          takenAt,
          zone: 'unaffected',
          temperatureF: ut,
          relativeHumidity: urh,
        });
      }

      const equipment: DryingReportInput['equipment'] = [];
      const movers = Number(airMovers);
      const dehuCount = Number(dehus);
      if (Number.isFinite(movers) && movers > 0) {
        equipment.push({ kind: 'air_mover', quantity: movers, placedAt: takenAt });
      }
      if (Number.isFinite(dehuCount) && dehuCount > 0) {
        equipment.push({ kind: 'dehumidifier_lgr', quantity: dehuCount, placedAt: takenAt });
      }

      const report: DryingReportInput = {
        id: `local-${Date.now().toString(36)}`,
        takenAt,
        source: 'manual',
        notes: notes.trim() || undefined,
        psychrometrics: psychrometrics.length ? psychrometrics : undefined,
        equipment: equipment.length ? equipment : undefined,
        roomsAtDryStandard: splitRooms(dryRooms),
        roomsStillWet: splitRooms(wetRooms),
      };

      if (jobId && onAppendSaved) {
        await onAppendSaved(report);
      } else {
        onAppendLocal(report);
      }

      setNotes('');
      setDryRooms('');
      setWetRooms('');
      setAirMovers('');
      setDehus('');
      setOpenForm(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not save the drying report.');
    } finally {
      setSaving(false);
    }
  }

  if (!plan && !progress && localReports.length === 0) return null;

  return (
    <div className="space-y-4">
      {plan && <EquipmentPlanSection plan={plan} />}
      {(progress || localReports.length > 0) && (
        <ProgressSection
          progress={progress}
          localReports={localReports}
          roomOptions={roomOptions}
        />
      )}

      <section className="rounded-xl border border-white/10 bg-ink-800/60 p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold text-white">Drying visits</h2>
            <p className="mt-1 text-xs text-gray-500">
              Append a monitoring visit as the project progresses. The estimate rebuilds with
              updated equipment days, dry-standard progress, and under-equipment flags.
              {jobId
                ? ' This job is saved — visits persist on the server.'
                : ' Save the estimate first to persist visits across sessions.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpenForm((v) => !v)}
            disabled={busy}
            className="rounded-lg border border-white/10 bg-ink-700/70 px-3 py-1.5 text-xs text-gray-200 transition hover:bg-ink-600 disabled:opacity-60"
          >
            {openForm ? 'Cancel' : 'Log a visit'}
          </button>
        </div>

        {openForm && (
          <form onSubmit={(e) => void submitVisit(e)} className="mt-4 space-y-3">
            <label className="block">
              <span className="text-xs text-gray-500">Visit notes</span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Day 3 monitoring — kitchen cavity still elevated, hall at goal."
                className="mt-1 w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-xs text-gray-200 outline-none placeholder:text-gray-600 focus:border-brand-500"
              />
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="text-xs text-gray-500">Rooms at dry standard</span>
                <input
                  value={dryRooms}
                  onChange={(e) => setDryRooms(e.target.value)}
                  placeholder={roomOptions[0] ? roomOptions.join(', ') : 'Hall'}
                  className="mt-1 w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-xs text-gray-200 outline-none placeholder:text-gray-600 focus:border-brand-500"
                />
              </label>
              <label className="block">
                <span className="text-xs text-gray-500">Rooms still wet</span>
                <input
                  value={wetRooms}
                  onChange={(e) => setWetRooms(e.target.value)}
                  placeholder="Kitchen"
                  className="mt-1 w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-xs text-gray-200 outline-none placeholder:text-gray-600 focus:border-brand-500"
                />
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <fieldset className="rounded-lg border border-white/5 p-3">
                <legend className="px-1 text-xs text-gray-500">Affected psychro</legend>
                <div className="mt-1 flex gap-2">
                  <input
                    value={affectedTemp}
                    onChange={(e) => setAffectedTemp(e.target.value)}
                    inputMode="decimal"
                    aria-label="Affected temperature °F"
                    className="w-full rounded-md border border-white/10 bg-ink-900 px-2 py-1.5 text-xs text-gray-200 outline-none focus:border-brand-500"
                    placeholder="°F"
                  />
                  <input
                    value={affectedRh}
                    onChange={(e) => setAffectedRh(e.target.value)}
                    inputMode="decimal"
                    aria-label="Affected RH %"
                    className="w-full rounded-md border border-white/10 bg-ink-900 px-2 py-1.5 text-xs text-gray-200 outline-none focus:border-brand-500"
                    placeholder="% RH"
                  />
                </div>
              </fieldset>
              <fieldset className="rounded-lg border border-white/5 p-3">
                <legend className="px-1 text-xs text-gray-500">Unaffected psychro</legend>
                <div className="mt-1 flex gap-2">
                  <input
                    value={unaffectedTemp}
                    onChange={(e) => setUnaffectedTemp(e.target.value)}
                    inputMode="decimal"
                    aria-label="Unaffected temperature °F"
                    className="w-full rounded-md border border-white/10 bg-ink-900 px-2 py-1.5 text-xs text-gray-200 outline-none focus:border-brand-500"
                    placeholder="°F"
                  />
                  <input
                    value={unaffectedRh}
                    onChange={(e) => setUnaffectedRh(e.target.value)}
                    inputMode="decimal"
                    aria-label="Unaffected RH %"
                    className="w-full rounded-md border border-white/10 bg-ink-900 px-2 py-1.5 text-xs text-gray-200 outline-none focus:border-brand-500"
                    placeholder="% RH"
                  />
                </div>
              </fieldset>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="text-xs text-gray-500">Air movers on site</span>
                <input
                  value={airMovers}
                  onChange={(e) => setAirMovers(e.target.value)}
                  inputMode="numeric"
                  placeholder={plan ? String(plan.airMoversRequired) : '6'}
                  className="mt-1 w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-xs text-gray-200 outline-none placeholder:text-gray-600 focus:border-brand-500"
                />
              </label>
              <label className="block">
                <span className="text-xs text-gray-500">LGR dehumidifiers on site</span>
                <input
                  value={dehus}
                  onChange={(e) => setDehus(e.target.value)}
                  inputMode="numeric"
                  placeholder={plan ? String(plan.dehu.unitsRequired) : '2'}
                  className="mt-1 w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-xs text-gray-200 outline-none placeholder:text-gray-600 focus:border-brand-500"
                />
              </label>
            </div>

            {formError && <p className="text-xs text-red-300">{formError}</p>}

            <button
              type="submit"
              disabled={saving || busy}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-500 disabled:opacity-50"
            >
              {saving ? 'Saving…' : jobId ? 'Save visit & rebuild' : 'Add visit & rebuild'}
            </button>
          </form>
        )}
      </section>
    </div>
  );
}

function EquipmentPlanSection({ plan }: { plan: EquipmentPlan }) {
  return (
    <section className="rounded-xl border border-white/10 bg-ink-800/60 p-5">
      <h2 className="text-lg font-semibold text-white">Equipment plan</h2>
      <p className="mt-1 text-xs text-gray-500">
        Sized from open wall after flood cut, wet floor, and class — not a vague wet-band guess.
        Billing mode: {plan.billingMode.replace(/_/g, ' ')}.
      </p>

      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Air movers" value={String(plan.airMoversRequired)} />
        <Stat label="Dehumidifiers" value={String(plan.dehu.unitsRequired)} />
        <Stat label="Scrubbers" value={String(plan.scrubbersRequired)} />
        <Stat label="Affected CF" value={String(Math.round(plan.dehu.affectedCF))} />
      </dl>

      {plan.rooms.length > 0 && (
        <ul className="mt-4 space-y-2">
          {plan.rooms.map((room) => (
            <li
              key={room.roomId}
              className="rounded-lg border border-white/5 bg-ink-900/40 px-3 py-2 text-sm text-gray-300"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium text-white">{room.roomName}</span>
                <span className="font-mono text-xs text-brand-300">
                  {room.airMoversRequired} air mover{room.airMoversRequired === 1 ? '' : 's'}
                  {room.floodCutRequired && room.cutHeightIn > 0
                    ? ` · ${room.cutHeightIn}" cut → ${room.openWallSF} SF open wall`
                    : ''}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-gray-500">{room.rationale}</p>
            </li>
          ))}
        </ul>
      )}

      {plan.warnings.length > 0 && (
        <ul className="mt-3 space-y-1">
          {plan.warnings.map((warning) => (
            <li key={warning} className="text-xs text-amber-300">
              {warning}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ProgressSection({
  progress,
  localReports,
  roomOptions,
}: {
  progress?: DryingProgress;
  localReports: DryingReportInput[];
  roomOptions: string[];
}) {
  const timeline =
    progress?.timeline ??
    localReports.map((r) => ({
      takenAt: r.takenAt,
      source: r.source,
      summary: r.notes?.trim() || 'Visit logged',
    }));

  return (
    <section className="rounded-xl border border-white/10 bg-ink-800/60 p-5">
      <h2 className="text-lg font-semibold text-white">Drying progress</h2>
      <p className="mt-1 text-xs text-gray-500">
        Merged from the visit timeline. Rooms at dry standard drop out of the wet set; equipment
        days expand with each visit.
      </p>

      {progress && (
        <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Visits" value={String(progress.visitCount)} />
          <Stat
            label="Status"
            value={progress.dryingComplete ? 'Complete' : `${progress.suggestedRemainingDays}d left`}
          />
          <Stat
            label="GPP Δ"
            value={
              progress.gppDifferential === null
                ? '—'
                : `${progress.gppDifferential > 0 ? '+' : ''}${progress.gppDifferential}`
            }
          />
          <Stat
            label="Dry / wet"
            value={`${progress.roomsAtDryStandard.length} / ${progress.roomsStillWet.length}`}
          />
        </dl>
      )}

      {(progress?.roomsAtDryStandard.length || progress?.roomsStillWet.length) && (
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          {progress!.roomsAtDryStandard.map((room) => (
            <span
              key={`dry-${room}`}
              className="rounded-md bg-emerald-500/15 px-2 py-0.5 text-emerald-300"
            >
              Dry: {room}
            </span>
          ))}
          {progress!.roomsStillWet.map((room) => (
            <span key={`wet-${room}`} className="rounded-md bg-amber-500/15 px-2 py-0.5 text-amber-300">
              Wet: {room}
            </span>
          ))}
        </div>
      )}

      {!progress?.roomsStillWet.length && roomOptions.length > 0 && progress?.visitCount === 0 && (
        <p className="mt-3 text-xs text-gray-500">No visit progress yet for {roomOptions.join(', ')}.</p>
      )}

      {timeline.length > 0 && (
        <ol className="mt-4 space-y-2 border-l border-white/10 pl-3">
          {timeline.map((entry, index) => (
            <li key={`${entry.takenAt}-${index}`} className="text-sm text-gray-300">
              <p className="text-xs text-gray-500">
                {formatWhen(entry.takenAt)} · {entry.source}
              </p>
              <p>{entry.summary}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold text-white">{value}</dd>
    </div>
  );
}

function splitRooms(value: string): string[] | undefined {
  const rooms = value
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return rooms.length ? rooms : undefined;
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
