import { NEEDS_YOU_TITLE, type ComputerTaskView } from '../../lib/computer';

/** Sign-in, 2FA, captcha or anything else only the person can do. */
export function ComputerNeedsYouCard({
  needsYou,
  busy,
  onTakeControl,
  onResume,
  onCancel,
}: {
  needsYou: NonNullable<ComputerTaskView['needsYou']>;
  busy?: boolean;
  onTakeControl: () => void;
  onResume: () => void;
  onCancel: () => void;
}) {
  const step =
    needsYou.reason === 'captcha'
      ? 'Complete the captcha in the live view below.'
      : needsYou.reason === 'number_match'
        ? 'Approve that number in your authenticator app.'
        : needsYou.reason === 'two_factor'
          ? 'Enter the code from your phone or email in the live view.'
          : needsYou.reason === 'login'
            ? 'Sign in with your own account in the live view.'
            : needsYou.reason === 'clarification'
              ? 'Answer in Chat if needed, or finish the step in the live view.'
              : needsYou.reason === 'stuck'
                ? 'Take control and finish the step, or tell Computer what to do after you resume.'
                : 'Do the step on the page in the live view.';

  return (
    <div className="space-y-2.5 rounded-xl border border-brand-300 bg-brand-50 p-3" data-testid="computer-needs-you-card">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-700">Needs you</p>
        <p className="mt-0.5 text-[15px] font-semibold text-ink-900">{NEEDS_YOU_TITLE[needsYou.reason]}</p>
        <p className="mt-1 text-sm text-ink-700">{needsYou.message}</p>
      </div>
      {needsYou.screenshot ? (
        <img
          src={needsYou.screenshot}
          alt="What Computer sees on the page"
          className="max-h-48 w-full rounded-lg border border-line object-contain bg-paper-0"
          data-testid="computer-needs-you-screenshot"
        />
      ) : null}
      <ol className="list-decimal space-y-0.5 pl-5 text-[13px] text-ink-700">
        <li>Take control — the live browser opens below so you can use mouse and keyboard.</li>
        <li>{step}</li>
        <li>Press Resume and Computer carries on. It will not keep retrying while it waits.</li>
      </ol>
      <p className="text-[11px] text-ink-500">
        {needsYou.reason === 'clarification'
          ? 'Computer stops to ask when it cannot tell the next step. It never guesses MFA codes.'
          : 'Computer never types passwords or codes, never invents approval numbers, and never solves captchas. Your sign-in stays saved for your company next time.'}
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onTakeControl}
          className="rounded-full bg-brand-600 px-3.5 py-1.5 text-[13px] font-semibold text-ink-900 transition hover:bg-brand-700 disabled:opacity-50"
          data-testid="computer-needs-you-take-control"
        >
          Take control
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onResume}
          className="rounded-full border border-line bg-paper-0 px-3.5 py-1.5 text-[13px] font-semibold text-ink-800 transition hover:border-brand-200 disabled:opacity-50"
        >
          I&apos;m done, resume
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className="rounded-full border border-line bg-paper-0 px-3.5 py-1.5 text-[13px] font-medium text-ink-600 transition hover:text-danger-600 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
