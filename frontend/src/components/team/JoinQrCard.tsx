import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { joinSignupUrl } from '../../lib/joinLink';

/**
 * The join code as something a phone can scan.
 *
 * Held up at a job site or on a screen share, the QR code takes the place of
 * reading eight characters aloud: the crew member scans it, lands on signup
 * with the company already filled in, and comes out the other side connected
 * to the organization — under the company's existing billing, so they are
 * never asked for a card.
 *
 * The QR encodes the same join link every member can already copy, nothing
 * more. Rendered locally (no lookup of any kind), always on white — scanners
 * need the contrast whatever the app theme says.
 */
export function JoinQrCard({ code, size = 148 }: { code: string; size?: number }) {
  const url = joinSignupUrl(window.location.origin, code);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(url, {
      errorCorrectionLevel: 'M',
      margin: 1,
      // Rendered at `size` CSS pixels; doubled here so it stays crisp on
      // the high-density screens it will mostly be scanned from.
      width: size * 2,
      color: { dark: '#111111', light: '#ffffff' },
    })
      .then((png) => {
        if (!cancelled) setDataUrl(png);
      })
      .catch(() => {
        // No QR is a display loss, not a flow loss — the code and link remain.
        if (!cancelled) setDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [url, size]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Join link', url);
    }
  }

  if (!dataUrl) return null;

  return (
    <div className="flex items-center gap-4">
      <span className="shrink-0 rounded-lg bg-white p-2 shadow-sm ring-1 ring-line">
        <img
          src={dataUrl}
          width={size}
          height={size}
          alt={`QR code — scan to join with code ${code}`}
          className="block"
        />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink-800">Scan to join this company</span>
        <span className="mt-1 block text-xs leading-relaxed text-ink-500">
          Opens sign-up with your company already filled in. The new account is linked to the
          organization — and its billing — the moment they finish.
        </span>
        <button
          type="button"
          onClick={() => void copyLink()}
          className="mt-2 rounded-full glass-card px-3 py-1 text-xs font-medium text-ink-600 hover:text-ink-900"
        >
          {copied ? 'Link copied' : 'Copy join link'}
        </button>
      </span>
    </div>
  );
}
