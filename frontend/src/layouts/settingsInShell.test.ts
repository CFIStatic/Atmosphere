import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

describe('Settings on the office rail', () => {
  it('stays inside OperationsShell so a saved photo can update the chip without remounting', () => {
    const app = readFileSync(resolve(here, '../App.tsx'), 'utf8');
    const shellOpen = app.indexOf('<OperationsShell />');
    const settings = app.indexOf('<Route path="/settings" element={<SettingsPage />} />');
    const shellClose = app.indexOf('</Route>', settings);
    expect(shellOpen).toBeGreaterThan(-1);
    expect(settings).toBeGreaterThan(shellOpen);
    expect(shellClose).toBeGreaterThan(settings);
    expect(app.includes('<Route path="/settings"', settings + 1)).toBe(false);
  });

  it('suspends lazy Settings inside the shell so the first visit does not remount the rail', () => {
    const shell = readFileSync(resolve(here, './OperationsShell.tsx'), 'utf8');
    const suspense = shell.indexOf('<Suspense');
    const outlet = shell.indexOf('<Outlet');
    const suspenseClose = shell.indexOf('</Suspense>', outlet);
    expect(suspense).toBeGreaterThan(-1);
    expect(outlet).toBeGreaterThan(suspense);
    expect(suspenseClose).toBeGreaterThan(outlet);
  });

  it('cache-busts the verifier iframe so an old chip HTML cannot keep initials', () => {
    const frame = readFileSync(resolve(here, '../components/VerifierFrame.tsx'), 'utf8');
    expect(frame).toContain('/verifier/?embed=1&v=profile-2');
  });
});
