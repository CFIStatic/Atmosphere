/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Org policy for child privacy blur. Default ON (protect by default).
 * Stored on public.orgs.child_blur_enabled.
 */

export type OrgChildBlurSettings = {
  orgId: string;
  /** When true, detect + apply child privacy blur. Default true. */
  childBlurEnabled: boolean;
};

export function defaultChildBlurSettings(orgId: string): OrgChildBlurSettings {
  return { orgId, childBlurEnabled: true };
}

export async function loadOrgChildBlurSettings(
  admin: any,
  orgId: string,
): Promise<OrgChildBlurSettings> {
  const { data, error } = await admin
    .from('orgs')
    .select('id, child_blur_enabled')
    .eq('id', orgId)
    .maybeSingle();

  if (error || !data) {
    // Missing column (pre-migration) or missing org → protect by default.
    return defaultChildBlurSettings(orgId);
  }

  return {
    orgId,
    // null/undefined → ON; only explicit false disables.
    childBlurEnabled: data.child_blur_enabled !== false,
  };
}

export async function updateOrgChildBlurSettings(
  admin: any,
  orgId: string,
  patch: { childBlurEnabled?: boolean },
): Promise<OrgChildBlurSettings> {
  const row: Record<string, unknown> = {};
  if (patch.childBlurEnabled !== undefined) {
    row.child_blur_enabled = Boolean(patch.childBlurEnabled);
  }
  if (Object.keys(row).length) {
    const { error } = await admin.from('orgs').update(row).eq('id', orgId);
    if (error) throw new Error(error.message);
  }
  return loadOrgChildBlurSettings(admin, orgId);
}

export async function isChildBlurEnabledForOrg(admin: any, orgId: string | null | undefined): Promise<boolean> {
  if (!orgId) return true;
  try {
    const settings = await loadOrgChildBlurSettings(admin, orgId);
    return settings.childBlurEnabled;
  } catch {
    return true;
  }
}
