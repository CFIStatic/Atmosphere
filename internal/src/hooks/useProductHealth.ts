import { api } from '../lib/api';
import { useApi } from './useApi';

export function useProductHealth(weeks = 12) {
  return useApi(() => api.productHealth(weeks), [weeks]);
}
