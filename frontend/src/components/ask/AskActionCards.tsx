import { ArrowUpRight } from 'lucide-react';
import type { AskActionCard } from '../../lib/askActionCards';

/** Next steps under the latest answer. Each one asks Chat, so the usual approvals apply. */
export function AskActionCards({ cards, disabled, onPick }: { cards: AskActionCard[]; disabled?: boolean; onPick: (card: AskActionCard) => void }) {
  if (!cards.length) return null;
  return (
    <div className="mt-2.5 flex flex-wrap gap-1.5" data-testid="ask-action-cards">
      {cards.map((card) => (
        <button
          key={card.id}
          type="button"
          data-testid="ask-action-card"
          data-action={card.id}
          disabled={disabled}
          onClick={() => onPick(card)}
          title={card.mode === 'prefill' ? 'Starts the request in the box below so you can add the details' : undefined}
          className="inline-flex items-center gap-1 rounded-lg border border-brand-200 bg-brand-50 px-2.5 py-1 text-[12px] font-semibold text-ink-800 transition hover:border-brand-300 hover:bg-brand-100 disabled:opacity-40"
        >
          {card.label}
          <ArrowUpRight size={12} aria-hidden />
        </button>
      ))}
    </div>
  );
}
