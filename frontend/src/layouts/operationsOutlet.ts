import { useOutletContext } from 'react-router-dom';

/** What OperationsShell hands the page it renders. */
export type OperationsOutletContext = {
  chrome: 'operations';
  /** Spot in the top bar, left of the account chip, for a page's title and actions. */
  headerSlot: HTMLElement | null;
};

/** The top bar slot when the page sits in OperationsShell, else null. */
export function useOperationsHeaderSlot(): HTMLElement | null {
  const outlet = useOutletContext<Partial<OperationsOutletContext> | null>();
  return outlet?.headerSlot ?? null;
}
