import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../../context/AuthContext';
import { isGlobalAdmin } from '../../domain/productRoles';
import { api, type ChildBlurSettings } from '../../lib/api';

export function ChildPrivacySection() {
  const { membership } = useAuth();
  const canEdit = isGlobalAdmin(membership?.role);

  const [settings, setSettings] = useState<ChildBlurSettings | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.getChildPrivacySettings();
        if (cancelled) return;
        setSettings(res.settings);
        setEnabled(res.settings.childBlurEnabled !== false);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not load child privacy settings.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (!canEdit) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await updateChildPrivacySettingsSafe(enabled);
      setSettings(res.settings);
      setEnabled(res.settings.childBlurEnabled !== false);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="glass-card rounded-xl border p-5 sm:p-6" data-testid="child-privacy-settings">
      <h2 className="text-base font-semibold text-ink-900">Child privacy blur</h2>
      <p className="mt-1 text-sm text-ink-600">
        Detect people who appear to be minors in Field Capture / job videos and blur them in the
        player. Appearance estimate only (child vs adult) — never identifies or names children.
        On by default to protect privacy.
      </p>

      <form className="mt-5 space-y-4" onSubmit={onSave}>
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            className="mt-1"
            checked={enabled}
            disabled={!canEdit || busy || !settings}
            onChange={(e) => setEnabled(e.target.checked)}
            data-testid="child-blur-enabled"
          />
          <span className="text-sm text-ink-800">
            <span className="font-medium">Blur children in job recordings</span>
            <span className="mt-0.5 block text-xs text-ink-500">
              Protective privacy. Ask / evidence show “child present [privacy redacted]” instead of
              identifiable descriptions.
            </span>
          </span>
        </label>

        {error ? (
          <p className="text-sm text-red-700" role="alert">
            {error}
          </p>
        ) : null}
        {saved ? (
          <p className="text-sm text-emerald-700" data-testid="child-privacy-saved">
            Saved.
          </p>
        ) : null}

        {canEdit ? (
          <button
            type="submit"
            disabled={busy || !settings}
            className="rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-semibold text-ink-900 hover:bg-brand-700 disabled:opacity-50"
            data-testid="child-privacy-save"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        ) : (
          <p className="text-xs text-ink-500">Only a Global Admin can change this policy.</p>
        )}
      </form>
    </section>
  );
}

async function updateChildPrivacySettingsSafe(enabled: boolean) {
  return api.updateChildPrivacySettings({ childBlurEnabled: enabled });
}
