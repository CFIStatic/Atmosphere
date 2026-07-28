import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { catalogEntry, listCatalog } from './catalog.js';
import { SandboxCrmConnector } from './sandboxConnector.js';

describe('integrations/catalog', () => {
  it('includes Dash, Luxor, Salesforce, and a generic REST option', () => {
    const ids = listCatalog().map((e) => e.id);
    for (const id of ['dash', 'luxor', 'salesforce', 'hubspot', 'jobnimbus', 'encircle', 'rest', 'csv']) {
      assert.ok(ids.includes(id), `missing ${id}`);
    }
    assert.equal(catalogEntry('dash')?.direction, 'bidirectional');
    assert.equal(catalogEntry('csv')?.kind, 'csv');
  });
});

describe('integrations/sandbox', () => {
  it('returns demo contacts and properties for any system', async () => {
    const connector = new SandboxCrmConnector('dash');
    const result = await connector.fetch({
      config: {},
      credential: null,
      cursor: null,
      maxRecords: 100,
      signal: new AbortController().signal,
    });

    assert.equal(result.truncated, false);
    assert.ok(result.records.some((r) => r.entityType === 'contact'));
    assert.ok(result.records.some((r) => r.entityType === 'property'));
    const contact = result.records.find((r) => r.entityType === 'contact')!;
    assert.ok(contact.payload.email);
    assert.ok(typeof contact.payload.latitude === 'number');
  });
});
