import type { ContactSource } from './types.js';

/**
 * Placeholder for a future CRM source. Registered so the Contacts page can
 * show it, never enabled, and it never makes a network call. Building the
 * integration means replacing this module, not touching the registry callers.
 */
export const crmContactSource: ContactSource = {
  id: 'crm',
  label: 'CRM',
  availability() {
    return { enabled: false, reason: 'Coming soon. No CRM is connected.' };
  },
  async list() {
    return { contacts: [], truncated: false };
  },
};
