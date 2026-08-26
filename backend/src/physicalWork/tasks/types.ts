/** TaskEpisode is the operational `work_episodes` row. */
export type TaskEpisodeId = string;
export const ACTOR_KINDS = [
  'human',
  'crew',
  'robot',
  'autonomous',
  'human_robot',
  'machine',
  'mixed',
] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];
