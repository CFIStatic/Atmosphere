import { useEffect } from 'react';
import { usePlatform } from '../lib/usePlatform';
import type { PlatformId } from '../lib/platforms';

/**
 * Pins a route to the platform that owns it.
 *
 * Verification and Field share one console. Opening a Field-only or
 * Verification-only screen while the other rail is active used to frame the
 * page with the wrong navigation. Arriving here is treated as intent to be
 * in that platform: the rail follows the page.
 *
 * The switch happens in an effect rather than during render, since it writes
 * to the platform store and to localStorage.
 */
export function RequirePlatform({
  platform,
  children,
}: {
  platform: PlatformId;
  children: React.ReactNode;
}) {
  const [active, setActive] = usePlatform();

  useEffect(() => {
    if (active !== platform) setActive(platform);
  }, [active, platform, setActive]);

  return <>{children}</>;
}
