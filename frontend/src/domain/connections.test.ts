import { describe, expect, it } from 'vitest';
import {
  blindCapabilities,
  compareForCatalogue,
  connectionsPowering,
  isActionable,
  isHealthy,
  isLive,
  needsAttention,
  summarise,
} from './connections';
import { CONNECTIONS } from '../data/fixtures';
import type { AgentCapability, Connection, ConnectionStatus } from './types';

function conn(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'c-test',
    name: 'Test System',
    vendor: 'Test Vendor',
    category: 'job_management',
    status: 'connected',
    authMethod: 'oauth',
    summary: '',
    dataFlows: [],
    powers: [],
    lastSyncAt: null,
    recordsSynced: null,
    issue: null,
    accountLabel: null,
    popular: false,
    brandColor: '#0C4DA2',
    ...overrides,
  };
}

describe('connection state', () => {
  it('counts configured-but-broken systems as live', () => {
    // They still hold credentials and still appear under "Connected"; the user
    // has to fix them, not set them up again.
    expect(isLive(conn({ status: 'degraded' }))).toBe(true);
    expect(isLive(conn({ status: 'error' }))).toBe(true);
    expect(isLive(conn({ status: 'not_connected' }))).toBe(false);
    expect(isLive(conn({ status: 'disconnected' }))).toBe(false);
  });

  it('separates "needs a human" from "never set up"', () => {
    expect(needsAttention(conn({ status: 'error' }))).toBe(true);
    expect(needsAttention(conn({ status: 'degraded' }))).toBe(true);
    expect(needsAttention(conn({ status: 'not_connected' }))).toBe(false);
  });

  it('treats only fully-working systems as healthy', () => {
    expect(isHealthy(conn({ status: 'connected' }))).toBe(true);
    expect(isHealthy(conn({ status: 'degraded' }))).toBe(false);
  });
});

describe('blindCapabilities', () => {
  it('reports a capability with no system behind it', () => {
    const list = [
      conn({ id: 'a', status: 'connected', powers: ['collections'] }),
      conn({ id: 'b', status: 'not_connected', powers: ['scheduling'] }),
    ];
    expect(blindCapabilities(list)).toEqual(['scheduling']);
  });

  it('counts a degraded system as blind, not as coverage', () => {
    // The dangerous case: an agent acting confidently on half-stale data is
    // worse than one that knows it cannot see.
    const list = [conn({ status: 'degraded', powers: ['documentation'] })];
    expect(blindCapabilities(list)).toEqual(['documentation']);
  });

  it('is empty when every claimed capability has a healthy system', () => {
    const list = [
      conn({ id: 'a', status: 'connected', powers: ['collections', 'scheduling'] }),
      conn({ id: 'b', status: 'not_connected', powers: ['collections'] }),
    ];
    expect(blindCapabilities(list)).toEqual([]);
  });

  it('does not invent capabilities nothing claims', () => {
    expect(blindCapabilities([conn({ powers: [] })])).toEqual([]);
    expect(blindCapabilities([])).toEqual([]);
  });
});

describe('connectionsPowering', () => {
  it('returns only healthy systems behind a capability', () => {
    const list = [
      conn({ id: 'good', status: 'connected', powers: ['collections'] }),
      conn({ id: 'broken', status: 'error', powers: ['collections'] }),
      conn({ id: 'other', status: 'connected', powers: ['scheduling'] }),
    ];
    expect(connectionsPowering(list, 'collections').map((c) => c.id)).toEqual(['good']);
  });
});

describe('catalogue ordering', () => {
  it('puts live systems above unconfigured ones', () => {
    const live = conn({ id: 'live', name: 'Zebra', status: 'connected' });
    const idle = conn({ id: 'idle', name: 'Alpha', status: 'not_connected' });
    expect([idle, live].sort(compareForCatalogue).map((c) => c.id)).toEqual(['live', 'idle']);
  });

  it('promotes commonly-used systems among the unconfigured', () => {
    const popular = conn({ id: 'pop', name: 'Zebra', status: 'not_connected', popular: true });
    const niche = conn({ id: 'niche', name: 'Alpha', status: 'not_connected' });
    expect([niche, popular].sort(compareForCatalogue).map((c) => c.id)).toEqual(['pop', 'niche']);
  });

  it('falls back to alphabetical', () => {
    const a = conn({ id: 'a', name: 'Alpha', status: 'not_connected' });
    const b = conn({ id: 'b', name: 'Beta', status: 'not_connected' });
    expect([b, a].sort(compareForCatalogue).map((c) => c.id)).toEqual(['a', 'b']);
  });
});

describe('isActionable', () => {
  it('blocks only the not-yet-buildable ones', () => {
    const actionable: ConnectionStatus[] = ['connected', 'degraded', 'error', 'not_connected'];
    for (const s of actionable) expect(isActionable(s)).toBe(true);
    expect(isActionable('coming_soon')).toBe(false);
  });
});

describe('the shipped catalogue', () => {
  it('covers the systems restorers named', () => {
    const ids = new Set(CONNECTIONS.map((c) => c.id));
    for (const required of [
      'xactimate',
      'xactanalysis',
      'dash',
      'quickbooks-online',
      'gmail',
      'outlook',
      'google-drive',
      'shared-drive',
      'docusketch',
    ]) {
      expect(ids.has(required), `missing ${required}`).toBe(true);
    }
  });

  it('has unique ids', () => {
    expect(new Set(CONNECTIONS.map((c) => c.id)).size).toBe(CONNECTIONS.length);
  });

  it('gives every connection a summary and at least one data flow', () => {
    for (const c of CONNECTIONS) {
      expect(c.summary.length, `${c.id} has no summary`).toBeGreaterThan(10);
      expect(c.dataFlows.length, `${c.id} declares no data flow`).toBeGreaterThan(0);
    }
  });

  it('only reports sync detail for systems that are actually live', () => {
    for (const c of CONNECTIONS) {
      if (!isLive(c)) {
        expect(c.lastSyncAt, `${c.id} claims a sync while not connected`).toBeNull();
        expect(c.accountLabel, `${c.id} claims an account while not connected`).toBeNull();
      }
    }
  });

  it('explains every degraded or errored system', () => {
    for (const c of CONNECTIONS.filter(needsAttention)) {
      expect(c.issue, `${c.id} is broken with no explanation`).toBeTruthy();
    }
  });

  it('summarises consistently', () => {
    const s = summarise(CONNECTIONS);
    expect(s.live + s.available).toBe(s.total);
    expect(s.healthy).toBeLessThanOrEqual(s.live);
    expect(s.attention).toBe(s.live - s.healthy);
  });
});

describe('capability coverage in the shipped catalogue', () => {
  it('backs every agent capability with at least one catalogued system', () => {
    // If a capability has nothing behind it even in the catalogue, the agent
    // could never work — that is a product gap, not a configuration one.
    const all: AgentCapability[] = [
      'scheduling',
      'estimating',
      'collections',
      'project_management',
      'compliance',
      'customer_comms',
      'documentation',
    ];
    const claimed = new Set(CONNECTIONS.flatMap((c) => c.powers));
    for (const cap of all) expect(claimed.has(cap), `nothing powers ${cap}`).toBe(true);
  });
});
