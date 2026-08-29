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

  it('cache-busts the verifier iframe so an old chip HTML cannot keep initials', () => {
    const frame = readFileSync(resolve(here, '../components/VerifierFrame.tsx'), 'utf8');
    expect(frame).toContain('/verifier/?embed=1&v=profile-3');
    expect(frame).toContain('avatarUrl: profile?.avatarUrl');
    expect(frame).toContain('profile?.avatarUrl');
  });

  it('does not let a slower membership refresh wipe a just-saved photo', () => {
    const auth = readFileSync(resolve(here, '../context/AuthContext.tsx'), 'utf8');
    expect(auth).toContain('preferFresherProfile(current, incoming)');
    expect(auth).toContain('keep the in-memory profile, including a just-uploaded avatar');
  });
});
