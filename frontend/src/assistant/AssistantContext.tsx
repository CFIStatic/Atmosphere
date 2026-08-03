import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  CAPABILITY_LABELS,
  needsClarification,
  routeRequest,
  type RoutingResult,
} from '../domain/routing';
import { dataClient } from '../data/client';
import type { ApprovalRequest } from '../domain/types';

/**
 * The single Atmosphere assistant.
 *
 * Users address one assistant and never choose an agent; `routeRequest` decides
 * which capability handles a request, and the answer reports that routing back
 * as provenance. Keeping conversation state here — rather than inside the panel
 * — is what lets the command bar, the panel, and inline entity actions all feed
 * the same thread.
 *
 * The reply logic below is deterministic and local. It is a stand-in for the
 * agent runtime, not a pretend model: it routes honestly, surfaces the real
 * pending approval that matches the request, and says plainly when it has
 * nothing. When the runtime lands, `send` becomes a call to it and nothing else
 * in the UI changes.
 */

export interface AssistantMessage {
  id: string;
  author: 'user' | 'atmosphere';
  text: string;
  at: string;
  routing?: RoutingResult;
  /** When the reply corresponds to a real pending action, it is linked here. */
  proposal?: ApprovalRequest;
}

interface AssistantValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  messages: AssistantMessage[];
  thinking: boolean;
  send: (text: string) => void;
  clear: () => void;
  /** What the panel should describe itself as being about, per route. */
  contextLabel: string;
  setContextLabel: (label: string) => void;
}

const AssistantContext = createContext<AssistantValue | undefined>(undefined);

let messageSeq = 0;
const nextId = () => `m-${++messageSeq}`;

export function AssistantProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(true);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [thinking, setThinking] = useState(false);
  const [contextLabel, setContextLabel] = useState('Atmosphere');
  const timers = useRef<number[]>([]);

  const send = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    const routing = routeRequest(trimmed);

    setMessages((prev) => [
      ...prev,
      { id: nextId(), author: 'user', text: trimmed, at: new Date().toISOString() },
    ]);
    setThinking(true);
    setOpen(true);

    const timer = window.setTimeout(async () => {
      const approvals = await dataClient.approvals.list();
      const match = approvals.find(
        (a) => a.capability === routing.capability && a.status === 'proposed',
      );

      const reply: AssistantMessage = {
        id: nextId(),
        author: 'atmosphere',
        at: new Date().toISOString(),
        routing,
        proposal: match,
        text: composeReply(routing, match),
      };

      setMessages((prev) => [...prev, reply]);
      setThinking(false);
    }, 550);

    timers.current.push(timer);
  }, []);

  const clear = useCallback(() => {
    timers.current.forEach(window.clearTimeout);
    timers.current = [];
    setMessages([]);
    setThinking(false);
  }, []);

  const value = useMemo<AssistantValue>(
    () => ({ open, setOpen, messages, thinking, send, clear, contextLabel, setContextLabel }),
    [open, messages, thinking, send, clear, contextLabel],
  );

  return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>;
}

function composeReply(routing: RoutingResult, match: ApprovalRequest | undefined): string {
  const capability = CAPABILITY_LABELS[routing.capability];

  if (needsClarification(routing)) {
    return `I'm not confident which part of the business this belongs to — my best guess is ${capability}. Tell me the job number or what outcome you want and I'll route it properly rather than guess.`;
  }

  if (match) {
    return `Routed to ${capability}. There's already a proposed action covering this — review the changes, impact, and risks below before approving.`;
  }

  return `Routed to ${capability}. Nothing is queued for this right now, so there's no action to approve. If you want me to start one, say what outcome you're after and I'll draft it for review.`;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAssistant(): AssistantValue {
  const ctx = useContext(AssistantContext);
  if (!ctx) throw new Error('useAssistant must be used within an AssistantProvider');
  return ctx;
}
