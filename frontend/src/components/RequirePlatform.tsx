import { useEffect } from 'react';
import { usePlatform } from '../lib/usePlatform';
import type { PlatformId } from '../lib/platforms';

/**
 * Pins a route to the platform that owns it.
 *
 * The four products share one console, so a route is reachable from anywhere
 * unless something says otherwise. That was fine for the screens every
 * platform has — My Work, Approvals — and wrong for the ones only one of them
 * owns: prospecting is a Sales tool, and opening it while the rail says
 * "Operations" showed a sales page framed by somebody else's navigation, with
 * no way back to the tool that had just been used.
 *
 * Arriving here is treated as intent to be in that platform rather than as an
 * error, because that is what it means every time it happens: a link was
 * shared, a bookmark was opened, a URL was typed. So the platform switches to
 * match the page and the rail follows. Blocking instead would leave someone
 * holding a link to a page they are allowed to see and cannot get to.
 *
 * The switch happens in an effect rather than during render, since it writes
 * to the platform store and to localStorage — both side effects that must not
 * run while React is deciding what to draw.
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
