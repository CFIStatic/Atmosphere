import { createContext, useContext } from 'react';

export const JobFilesSearchContext = createContext<{
  query: string;
  setQuery: (query: string) => void;
}>({ query: '', setQuery: () => undefined });

export function useJobFilesSearch() {
  return useContext(JobFilesSearchContext);
}
