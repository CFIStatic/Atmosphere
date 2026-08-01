import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CONNECTOR_CATEGORY_ORDER,
  filterCatalogForContractorType,
  getConnectorDefinition,
  listConnectorCatalog,
} from './catalog.js';

describe('connector catalog', () => {
  it('includes restoration, roofing, and contractor apps', () => {
    const keys = new Set(listConnectorCatalog().map((c) => c.key));
    for (const expected of [
      'servicetitan',
      'jobber',
      'housecall-pro',
      'acculynx',
      'roofr',
      'xactimate',
      'docusketch',
      'symbility',
      'contractor-connection',
      'custom-web',
      'custom-computer',
    ]) {
      assert.ok(keys.has(expected), `missing ${expected}`);
    }
  });

  it('every entry has at least one access mode and a task template', () => {
    for (const entry of listConnectorCatalog()) {
      assert.ok(entry.accessModes.length > 0, `${entry.key} has no access modes`);
      assert.ok(entry.taskTemplates.length > 0, `${entry.key} has no templates`);
      assert.ok(CONNECTOR_CATEGORY_ORDER.includes(entry.category), `${entry.key} bad category`);
    }
  });

  it('filters by contractor type without dropping universal apps', () => {
    const roofing = filterCatalogForContractorType('roofing');
    const keys = new Set(roofing.map((c) => c.key));
    assert.ok(keys.has('acculynx'));
    assert.ok(keys.has('custom-web'));
    assert.ok(keys.has('xactimate'));
    assert.equal(keys.has('buildertrend'), false);
  });

  it('looks up definitions by key', () => {
    const st = getConnectorDefinition('servicetitan');
    assert.ok(st);
    assert.equal(st.name, 'ServiceTitan');
    assert.ok(st.accessModes.includes('web'));
    assert.equal(getConnectorDefinition('nope'), undefined);
  });

  it('api connectors declare an estimator provider', () => {
    for (const entry of listConnectorCatalog()) {
      if (entry.accessModes.includes('api')) {
        assert.ok(entry.estimatorProvider, `${entry.key} api mode needs estimatorProvider`);
      }
    }
  });
});
