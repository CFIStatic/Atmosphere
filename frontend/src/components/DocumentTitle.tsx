import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { documentTitleFor } from '../lib/documentTitle';
import { usePreferences } from '../lib/preferences';

/** Keeps the hosted tab titled as the product: "Dashboard · Atmosphere". */
export function DocumentTitle() {
  const { pathname, search } = useLocation();
  const { locale } = usePreferences();

  useEffect(() => {
    document.title = documentTitleFor(pathname, search);
  }, [pathname, search, locale]);

  return null;
}
