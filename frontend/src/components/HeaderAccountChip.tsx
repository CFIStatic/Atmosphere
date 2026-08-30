import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { displayName, nameFromMetadata } from '../lib/display';
import { setPreference, usePreferences } from '../lib/preferences';
import { cycleThemePreference, setThemePreference, themeLabel } from '../lib/theme';
import { PersonAvatar } from './PersonAvatar';
import { LogOutIcon, MoonIcon, SettingsIcon, SpinnerIcon, SunIcon } from './icons';

/**
 * Dashboard-matching account chip for the office top bar: name, org, and
 * avatar on the right, with appearance / Settings / sign-out in the menu.
 * Rail-only tabs hide the verifier top bar, so this chip is the one that
 * stays in the corner on Overview, Start a job, Job Files, and Settings.
 */
export function HeaderAccountChip() {
  const { user, profile, membership, logout } = useAuth();
  const { confirmSignOut, theme } = usePreferences();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const fullName = profile?.fullName || nameFromMetadata(user?.metadata);
  const name = displayName(fullName, user?.email);
  const orgName = membership?.org?.name || user?.email || 'Atmosphere';
  const nextTheme = cycleThemePreference(theme);
  const appearanceLabel = `Appearance: ${themeLabel(theme)}`;

  useEffect(() => {
    if (!open) return undefined;
    function onPointerDown(event: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  async function handleLogout() {
    if (confirmSignOut && !window.confirm('Sign out of Atmosphere?')) return;
    setLoggingOut(true);
    try {
      await logout();
      navigate('/login', { replace: true });
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className="flex min-h-11 items-center gap-[9px] rounded-xl px-1.5 py-1 text-left transition hover:bg-paper-200"
      >
        <span className="min-w-0 max-w-[9.5rem] sm:max-w-[12rem]">
          <span className="block truncate text-[12.5px] leading-tight text-ink-700">{name}</span>
          <span className="mt-px block truncate text-[11.5px] leading-tight text-ink-500">{orgName}</span>
        </span>
        <PersonAvatar
          fullName={fullName}
          email={user?.email}
          avatarUrl={profile?.avatarUrl}
          size="xs"
        />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Account"
          className="absolute right-0 z-40 mt-1.5 min-w-[220px] overflow-hidden rounded-[9px] border border-line bg-paper-0 p-1 shadow-lift"
        >
          <div className="border-b border-line px-2.5 py-2.5">
            <p className="truncate text-[13px] font-semibold text-ink-900">{name}</p>
            {user?.email && <p className="mt-0.5 break-all text-[11.5px] text-ink-500">{user.email}</p>}
            {membership?.org?.name && (
              <p className="mt-1 text-[11.5px] text-ink-600">{membership.org.name}</p>
            )}
          </div>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setThemePreference(nextTheme);
              setPreference('theme', nextTheme);
            }}
            aria-label={`Switch to ${themeLabel(nextTheme).toLowerCase()} mode`}
            title={`${themeLabel(theme)} mode. Click for ${themeLabel(nextTheme).toLowerCase()}.`}
            className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[12.5px] font-medium text-ink-900 transition hover:bg-paper-200"
          >
            {nextTheme === 'dark' ? (
              <MoonIcon width={15} height={15} className="shrink-0 text-ink-600" />
            ) : (
              <SunIcon width={15} height={15} className="shrink-0 text-ink-600" />
            )}
            {appearanceLabel}
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              navigate('/settings');
            }}
            className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[12.5px] font-medium text-ink-900 transition hover:bg-paper-200"
          >
            <SettingsIcon width={14} height={14} className="shrink-0 text-ink-600" />
            Settings
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={handleLogout}
            disabled={loggingOut}
            className="mt-1 flex w-full items-center gap-2.5 rounded-b-md border-t border-line px-2.5 py-1.5 text-left text-[12.5px] font-medium text-danger-600 transition hover:bg-danger-50 disabled:opacity-60"
          >
            {loggingOut ? (
              <SpinnerIcon className="animate-spin" width={15} height={15} />
            ) : (
              <LogOutIcon width={15} height={15} />
            )}
            {loggingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      )}
    </div>
  );
}
