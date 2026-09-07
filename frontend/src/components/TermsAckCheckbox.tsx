import type { ReactNode } from 'react';
import { PRIVACY_PUBLIC_URL, TERMS_PUBLIC_URL } from '../lib/terms';

export function TermsAckLabel({
  termsHref = TERMS_PUBLIC_URL,
  privacyHref = PRIVACY_PUBLIC_URL,
}: {
  termsHref?: string;
  privacyHref?: string;
}): ReactNode {
  return (
    <>
      I acknowledge and agree to the{' '}
      <a
        href={termsHref}
        target="_blank"
        rel="noopener noreferrer"
        className="font-semibold text-brand-600 underline underline-offset-2 hover:text-brand-700"
      >
        Terms of Service
      </a>{' '}
      and have read the{' '}
      <a
        href={privacyHref}
        target="_blank"
        rel="noopener noreferrer"
        className="font-semibold text-brand-600 underline underline-offset-2 hover:text-brand-700"
      >
        Privacy Policy
      </a>
      .
    </>
  );
}

export function TermsAckCheckbox({
  id,
  checked,
  onChange,
  className = '',
}: {
  id: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  className?: string;
}) {
  return (
    <label
      htmlFor={id}
      className={`flex cursor-pointer items-start gap-3 rounded-lg border border-line bg-paper-50 px-3.5 py-3 text-sm text-ink-700 ${className}`}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 rounded border-line text-brand-600 focus:ring-brand-200"
      />
      <span>
        <TermsAckLabel />
      </span>
    </label>
  );
}
