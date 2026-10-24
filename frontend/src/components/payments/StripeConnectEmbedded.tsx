import { useEffect, useState } from 'react';
import { loadConnectAndInitialize, type StripeConnectInstance } from '@stripe/connect-js';
import {
  ConnectAccountManagement,
  ConnectAccountOnboarding,
  ConnectComponentsProvider,
  ConnectNotificationBanner,
  ConnectPayouts,
} from '@stripe/react-connect-js';
import { api } from '../../lib/api';

export type EmbeddedView = 'onboarding' | 'payouts' | 'account';

/**
 * Stripe Connect embedded components, rendered inside Settings so contractors
 * set up and manage payouts without leaving Atmosphere. The Account Session
 * client secret comes from our server (owner only) and goes straight to
 * connect-js; it is never stored.
 */
export function StripeConnectEmbedded({ view, onExit }: { view: EmbeddedView; onExit?: () => void }) {
  const [instance, setInstance] = useState<StripeConnectInstance | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api
      .payoutsSession()
      .then(({ publishableKey }) => {
        if (!live) return;
        setInstance(
          loadConnectAndInitialize({
            publishableKey,
            // connect-js calls this again whenever the session expires.
            fetchClientSecret: async () => (await api.payoutsSession()).clientSecret,
            appearance: {
              overlays: 'dialog',
              variables: { colorPrimary: '#2563eb', fontFamily: 'inherit', borderRadius: '10px' },
            },
          }),
        );
      })
      .catch((err) => live && setError(err instanceof Error ? err.message : 'Could not load payout setup.'));
    return () => {
      live = false;
    };
  }, []);

  if (error) return <p className="text-xs text-danger-700">{error}</p>;
  if (!instance) return <p className="text-xs text-ink-500">Loading payout setup…</p>;
  return (
    <ConnectComponentsProvider connectInstance={instance}>
      <div data-testid={`stripe-embedded-${view}`}>
        {view === 'onboarding' ? (
          <ConnectAccountOnboarding onExit={() => onExit?.()} />
        ) : (
          <>
            <ConnectNotificationBanner />
            {view === 'payouts' ? <ConnectPayouts /> : <ConnectAccountManagement />}
          </>
        )}
      </div>
    </ConnectComponentsProvider>
  );
}

export default StripeConnectEmbedded;
