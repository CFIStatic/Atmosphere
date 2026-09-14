import { PICKABLE_SERVICE_ROLES, type ServiceRoleSlug } from '../../lib/serviceRole';

type Props = {
  id?: string;
  value: ServiceRoleSlug | '' | null;
  custom?: string;
  onChange: (role: ServiceRoleSlug | '', custom: string) => void;
  disabled?: boolean;
  /** When true, include a blank "Choose…" option. */
  allowEmpty?: boolean;
  label?: string;
  hint?: string;
};

/**
 * Curated person service role title picker (+ optional custom for Other).
 * Homeowner is forced by the progress-grant path and is not listed here.
 */
export function ServiceRolePicker({
  id = 'service-role',
  value,
  custom = '',
  onChange,
  disabled,
  allowEmpty = true,
  label = 'Your role on jobs',
  hint = 'Used in Analysis labels (e.g. Alex — Electrician). Homeowners are labeled Homeowner automatically.',
}: Props) {
  const selected = (value || '') as string;
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-sm font-medium text-ink-800">
        {label}
      </label>
      {hint ? <p className="text-xs text-ink-500">{hint}</p> : null}
      <select
        id={id}
        className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink-900"
        value={selected}
        disabled={disabled}
        onChange={(e) => onChange((e.target.value || '') as ServiceRoleSlug | '', custom)}
      >
        {allowEmpty ? <option value="">Choose a title…</option> : null}
        {PICKABLE_SERVICE_ROLES.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {selected === 'other' ? (
        <input
          id={`${id}-custom`}
          type="text"
          maxLength={60}
          placeholder="Custom title"
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink-900"
          value={custom}
          disabled={disabled}
          onChange={(e) => onChange('other', e.target.value)}
        />
      ) : null}
    </div>
  );
}
