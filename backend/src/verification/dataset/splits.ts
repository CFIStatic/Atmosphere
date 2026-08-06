/**
 * Deterministic project-grouped dataset splits (prevents leakage).
 */

import { createHash } from 'node:crypto';

export type DatasetSplit =
  | 'train'
  | 'validation'
  | 'test'
  | 'benchmark'
  | 'holdout'
  | 'private_evaluation';

/**
 * Hash project ID into a stable bucket. Same project always maps to the same
 * split; related frames from one project never cross train/test.
 */
export function assignSplit(opts: {
  projectId: string;
  seed?: string;
  ratios?: { train: number; validation: number; test: number };
}): DatasetSplit {
  const seed = opts.seed ?? 'atmosphere-split-v1';
  const ratios = opts.ratios ?? { train: 0.8, validation: 0.1, test: 0.1 };
  const digest = createHash('sha256').update(`${seed}:${opts.projectId}`).digest();
  const bucket = digest.readUInt32BE(0) / 0xffffffff;
  if (bucket < ratios.train) return 'train';
  if (bucket < ratios.train + ratios.validation) return 'validation';
  return 'test';
}
