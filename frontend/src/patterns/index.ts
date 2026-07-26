/**
 * Domain-aware presentational compositions.
 *
 * `patterns/` is the only layer allowed to import from both `design/` and
 * `domain/`. It still holds no business rules — it decides how a Job *looks*,
 * never what makes one healthy.
 */
export { ActionProposal } from './ActionProposal';
export { AgentActivityFeed } from './AgentActivityFeed';
export { ConnectionLogo } from './ConnectionLogo';
export { KpiTile } from './KpiTile';
export { PageHeader, PageBody } from './PageHeader';
export * from './tone';
