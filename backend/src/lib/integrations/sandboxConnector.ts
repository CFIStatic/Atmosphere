/**
 * Sandbox CRM feed — deterministic contacts/properties for development.
 *
 * Lets a salesperson connect Dash / Luxor / Salesforce / any catalog CRM and
 * exercise pull → promote → email marketing → push without a live vendor key.
 */

import type { Connector, ExternalRecord, FetchContext, FetchResult } from './types.js';

function demoContacts(system: string): ExternalRecord[] {
  const stamp = new Date().toISOString();
  return [
    {
      entityType: 'contact',
      externalId: `${system}-contact-1`,
      sourceUpdatedAt: stamp,
      payload: {
        id: `${system}-contact-1`,
        firstName: 'Maria',
        lastName: 'Chen',
        email: 'maria.chen@example.com',
        phone: '515-555-0142',
        city: 'Des Moines',
        region: 'IA',
        postalCode: '50309',
        addressLine1: '412 Walnut St',
        country: 'US',
        latitude: 41.5868,
        longitude: -93.625,
        _sandbox: true,
        _system: system,
      },
    },
    {
      entityType: 'contact',
      externalId: `${system}-contact-2`,
      sourceUpdatedAt: stamp,
      payload: {
        id: `${system}-contact-2`,
        firstName: 'James',
        lastName: 'Okoye',
        email: 'james.okoye@example.com',
        phone: '319-555-0198',
        city: 'Cedar Rapids',
        region: 'IA',
        postalCode: '52402',
        addressLine1: '880 1st Ave NE',
        country: 'US',
        latitude: 41.9778,
        longitude: -91.6656,
        _sandbox: true,
        _system: system,
      },
    },
    {
      entityType: 'contact',
      externalId: `${system}-contact-3`,
      sourceUpdatedAt: stamp,
      payload: {
        id: `${system}-contact-3`,
        firstName: 'Priya',
        lastName: 'Nair',
        companyName: 'Nair Property Group',
        email: 'priya@nairproperty.example',
        phone: '563-555-0110',
        city: 'Davenport',
        region: 'IA',
        postalCode: '52803',
        addressLine1: '2215 E 12th St',
        country: 'US',
        latitude: 41.5431,
        longitude: -90.5513,
        _sandbox: true,
        _system: system,
      },
    },
  ];
}

function demoProperties(system: string): ExternalRecord[] {
  const stamp = new Date().toISOString();
  return [
    {
      entityType: 'property',
      externalId: `${system}-property-1`,
      sourceUpdatedAt: stamp,
      payload: {
        id: `${system}-property-1`,
        contactExternalId: `${system}-contact-1`,
        label: 'Walnut residence',
        addressLine1: '412 Walnut St',
        city: 'Des Moines',
        region: 'IA',
        postalCode: '50309',
        country: 'US',
        latitude: 41.5868,
        longitude: -93.625,
        _sandbox: true,
      },
    },
    {
      entityType: 'property',
      externalId: `${system}-property-2`,
      sourceUpdatedAt: stamp,
      payload: {
        id: `${system}-property-2`,
        contactExternalId: `${system}-contact-2`,
        label: '1st Ave duplex',
        addressLine1: '880 1st Ave NE',
        city: 'Cedar Rapids',
        region: 'IA',
        postalCode: '52402',
        country: 'US',
        latitude: 41.9778,
        longitude: -91.6656,
        _sandbox: true,
      },
    },
    {
      entityType: 'property',
      externalId: `${system}-property-3`,
      sourceUpdatedAt: stamp,
      payload: {
        id: `${system}-property-3`,
        contactExternalId: `${system}-contact-3`,
        label: 'E 12th commercial',
        addressLine1: '2215 E 12th St',
        city: 'Davenport',
        region: 'IA',
        postalCode: '52803',
        country: 'US',
        latitude: 41.5431,
        longitude: -90.5513,
        _sandbox: true,
      },
    },
  ];
}

export class SandboxCrmConnector implements Connector {
  readonly kind = 'sandbox';

  constructor(private readonly system: string) {}

  async fetch(ctx: FetchContext): Promise<FetchResult> {
    void ctx;
    const records = [...demoContacts(this.system), ...demoProperties(this.system)];
    return { records, nextCursor: null, truncated: false };
  }
}
