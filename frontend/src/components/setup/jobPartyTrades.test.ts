import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { JOB_PARTY_ROLE_OPTIONS, JOB_PARTY_TRADE_OPTIONS } from './verifierSetupOptions';

const verifierHtml = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../../../verifier/index.html'),
  'utf8',
);

function block(name: string): string {
  const match = verifierHtml.match(new RegExp(`var ${name} = \\[[\\s\\S]*?\\];`));
  if (!match) throw new Error(`Could not find ${name} in verifier/index.html`);
  return match[0];
}

describe('job file invite trades', () => {
  it('lists every service trade in the Add people dropdown and has no optional trade field', () => {
    expect(verifierHtml).not.toContain('Trade (optional)');
    expect(verifierHtml).not.toMatch(/name="trade"/);

    const trades = block('JOB_TRADES');
    for (const trade of JOB_PARTY_TRADE_OPTIONS) {
      expect(trades).toContain(`value: '${trade.value}'`);
      expect(trades).toContain(`label: '${trade.label}'`);
    }
    expect(trades.match(/value: '/g)).toHaveLength(JOB_PARTY_TRADE_OPTIONS.length);

    const roles = block('JOB_PARTY_ROLES');
    for (const role of JOB_PARTY_ROLE_OPTIONS) {
      expect(roles).toContain(`value: '${role.value}'`);
      expect(roles).toContain(`label: '${role.label}'`);
    }
  });
});
