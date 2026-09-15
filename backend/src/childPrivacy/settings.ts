/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Child privacy blur is mandatory for every org — always on, no opt-out.
 * `orgs.child_blur_enabled` may still exist from an earlier optional policy;
 * application code ignores stored false and treats blur as always enabled.
 */

export type OrgChildBlurSettings = {
  orgId: string;
  /** Always true. Child privacy blur cannot be disabled. */
  childBlurEnabled: true;
};

export function defaultChildBlurSettings(orgId: string): OrgChildBlurSettings {
  return { orgId, childBlurEnabled: true };
}

/** Always returns enabled — stored org flag is ignored. */
export async function loadOrgChildBlurSettings(
  _admin: any,
  orgId: string,
): Promise<OrgChildBlurSettings> {
  return defaultChildBlurSettings(orgId);
}

/**
 * No-op writer kept for API compatibility. Never persists a disable;
 * always returns childBlurEnabled: true.
 */
export async function updateOrgChildBlurSettings(
  _admin: any,
  orgId: string,
  _patch: { childBlurEnabled?: boolean } = {},
): Promise<OrgChildBlurSettings> {
  return defaultChildBlurSettings(orgId);
}

/** Child privacy blur is mandatory for all orgs. */
export async function isChildBlurEnabledForOrg(
  _admin: any,
  _orgId: string | null | undefined,
): Promise<boolean> {
  return true;
}
