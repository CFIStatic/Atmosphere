/** Hard spend cap for the eval. Every model call is pre-checked against a worst-case estimate and recorded after. */
export class SpendCapError extends Error {
  readonly spendCap = true;
}

export class SpendGuard {
  spentUsd = 0;
  calls = 0;
  constructor(readonly capUsd: number) {
    if (!(capUsd > 0) || capUsd > 300) throw new Error('Eval budget must be between $0 and $300.');
  }
  /** Throws before a call whose worst case would cross the cap. */
  reserve(worstCaseUsd: number): void {
    if (this.spentUsd + worstCaseUsd > this.capUsd) {
      throw new SpendCapError(`Spend cap $${this.capUsd} would be exceeded (spent $${this.spentUsd.toFixed(4)}, next ≤ $${worstCaseUsd.toFixed(4)}).`);
    }
  }
  record(usd: number): void {
    this.spentUsd += Math.max(0, usd);
    this.calls += 1;
  }
}
