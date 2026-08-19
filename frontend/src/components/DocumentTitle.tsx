import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { documentTitleFor } from '../lib/documentTitle';

/** Keeps the hosted tab titled as the product: "Dashboard · Atmosphere". */
export function DocumentTitle() {
  const { pathname, search } = useLocation();

  useEffect(() => {
    document.title = documentTitleFor(pathname, search);
  }, [pathname, search]);

  return null;
}
