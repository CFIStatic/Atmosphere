import { Command } from 'cmdk';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CornerDownLeft, Search, Sparkles } from 'lucide-react';
import { Badge, Kbd, cn } from '../design';
import { CAPABILITY_LABELS, routeRequest } from '../domain/routing';
import { canSee } from '../domain/permissions';
import { NAV_ITEMS } from '../shell/navigation';
import type { Role } from '../domain/types';
import { useAssistant } from './AssistantContext';

/**
 * Global command bar (⌘K).
 *
 * Doubles as navigation and as the natural-language entry point, because on an
 * operational tool those are the same instinct: the user knows what they want,
 * and making them decide "is this a page or a request?" first is friction. Free
 * text routes to a capability; anything matching a page navigates.
 */

const SUGGESTIONS = [
  'Which jobs are at risk right now?',
  'Draft collection notices for everything past 30 days',
  "Rebalance Thursday's schedule",
  'Follow up with Travelers on the FIR-1038 supplement',
  'Show me every job missing moisture documentation',
];

export function CommandBar({ role }: { role: Role }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const navigate = useNavigate();
  const { send } = useAssistant();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const pages = NAV_ITEMS.filter((item) => canSee(role, item.key));
  const trimmed = query.trim();
  // Anything longer than a page name is almost certainly a request, not a jump.
  const looksLikeRequest = trimmed.length > 3 && trimmed.includes(' ');
  const routing = looksLikeRequest ? routeRequest(trimmed) : null;

  function ask(text: string) {
    send(text);
    setQuery('');
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'flex h-9 w-full max-w-md items-center gap-2 rounded-lg border border-white/10 bg-ink-800/70 px-3',
          'text-sm text-gray-500 transition hover:border-white/20 hover:bg-ink-700/70',
        )}
      >
        <Search className="h-4 w-4 shrink-0" />
        <span className="flex-1 text-left">Ask Atmosphere or jump to…</span>
        <Kbd>⌘K</Kbd>
      </button>

      <Command.Dialog
        open={open}
        onOpenChange={setOpen}
        label="Command bar"
        shouldFilter={!looksLikeRequest}
        className="fixed left-1/2 top-[15vh] z-50 w-[min(38rem,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-2xl border border-white/10 bg-ink-800 shadow-2xl shadow-black/70"
      >
        <div className="flex items-center gap-2.5 border-b border-white/10 px-4">
          <Sparkles className="h-4 w-4 shrink-0 text-brand-400" />
          <Command.Input
            value={query}
            onValueChange={setQuery}
            placeholder="Ask Atmosphere, or type a page name…"
            className="h-12 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-gray-600"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && looksLikeRequest) {
                e.preventDefault();
                ask(trimmed);
              }
            }}
          />
        </div>

        <Command.List className="max-h-[22rem] overflow-y-auto p-2">
          {looksLikeRequest && routing ? (
            <Command.Group heading={<GroupLabel>Ask Atmosphere</GroupLabel>}>
              <Command.Item value={trimmed} onSelect={() => ask(trimmed)} className={ITEM}>
                <CornerDownLeft className="h-4 w-4 shrink-0 text-brand-400" />
                <span className="flex-1 truncate text-gray-200">{trimmed}</span>
                <Badge tone="brand">{CAPABILITY_LABELS[routing.capability]}</Badge>
              </Command.Item>
              <p className="px-3 pb-1 pt-2 text-2xs text-gray-600">
                Atmosphere routes this to {CAPABILITY_LABELS[routing.capability]}. You approve
                anything it wants to change.
              </p>
            </Command.Group>
          ) : (
            <>
              <Command.Empty className="px-3 py-6 text-center text-sm text-gray-500">
                Keep typing to ask Atmosphere.
              </Command.Empty>

              <Command.Group heading={<GroupLabel>Go to</GroupLabel>}>
                {pages.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Command.Item
                      key={item.key}
                      value={item.label}
                      onSelect={() => {
                        navigate(item.to);
                        setOpen(false);
                        setQuery('');
                      }}
                      className={ITEM}
                    >
                      <Icon className="h-4 w-4 shrink-0 text-gray-500" />
                      <span className="text-gray-200">{item.label}</span>
                    </Command.Item>
                  );
                })}
              </Command.Group>

              <Command.Group heading={<GroupLabel>Try asking</GroupLabel>}>
                {SUGGESTIONS.map((s) => (
                  <Command.Item key={s} value={s} onSelect={() => ask(s)} className={ITEM}>
                    <Sparkles className="h-4 w-4 shrink-0 text-brand-400/70" />
                    <span className="text-gray-300">{s}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            </>
          )}
        </Command.List>
      </Command.Dialog>
    </>
  );
}

const ITEM =
  'flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm data-[selected=true]:bg-white/[0.06] aria-selected:bg-white/[0.06]';

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="px-3 text-2xs font-semibold uppercase tracking-wider text-gray-600">
      {children}
    </span>
  );
}
