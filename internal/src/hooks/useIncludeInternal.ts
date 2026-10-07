import { useSyncExternalStore } from 'react';
import { getIncludeInternal, onIncludeInternalChange } from '../lib/scope';

/** Current "Include internal & test accounts" setting; re-renders on change. */
export function useIncludeInternal(): boolean {
  return useSyncExternalStore(onIncludeInternalChange, getIncludeInternal, () => false);
}
