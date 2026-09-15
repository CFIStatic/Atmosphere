import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { isShareSurfacePath, SHARE_SURFACE_ROBOTS } from '../lib/shareSurfaceRobots';

const META_ATTR = 'data-atmosphere-share-robots';

/**
 * Sets meta robots=noindex on share/guest surfaces. Complements nginx
 * X-Robots-Tag for crawlers that execute (or re-fetch) SPA HTML.
 */
export function DocumentRobotsMeta() {
  const { pathname, search } = useLocation();

  useEffect(() => {
    const share = isShareSurfacePath(pathname, search);
    let meta = document.querySelector(`meta[name="robots"][${META_ATTR}]`) as HTMLMetaElement | null;

    if (share) {
      if (!meta) {
        meta = document.createElement('meta');
        meta.setAttribute('name', 'robots');
        meta.setAttribute(META_ATTR, '1');
        document.head.appendChild(meta);
      }
      meta.content = SHARE_SURFACE_ROBOTS;
      return;
    }

    if (meta) meta.remove();
  }, [pathname, search]);

  return null;
}
