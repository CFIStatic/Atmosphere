import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Menu, Sparkles } from 'lucide-react';
import { Badge, Button, cn } from '../design';
import type { Role } from '../domain/types';
import { AssistantPanel } from '../assistant/AssistantPanel';
import { CommandBar } from '../assistant/CommandBar';
import { useAssistant } from '../assistant/AssistantContext';
import { useApprovals, useTasks } from '../data/hooks';
import { isFieldFirst } from '../domain/permissions';
import { LeftNav } from './LeftNav';
import { MobileNav } from './MobileNav';
import { UserMenu } from './UserMenu';
import { navItemFor } from './navigation';
import { useViewer } from './ViewerContext';

/**
 * The three-part operational layout: navigation, workspace, assistant.
 *
 * The assistant is a sibling of the workspace rather than an overlay, so it can
 * stay open while the user works — a floating chat bubble would make the
 * "persistent contextual panel" a lie the first time it covered a table.
 *
 * Below `xl` the assistant collapses to a launcher, and below `lg` navigation
 * moves into a drawer, because a field technician on a phone gets the same
 * product rather than a cut-down one.
 */
export function AppShell() {
  const { role } = useViewer();
  const location = useLocation();
  const { open: assistantOpen, setOpen: setAssistantOpen, setContextLabel } = useAssistant();

  const [navCollapsed, setNavCollapsed] = useState(() => isFieldFirst(role));
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const { data: approvals = [] } = useApprovals();
  const { data: tasks = [] } = useTasks();

  const pendingApprovals = approvals.filter((a) => a.status === 'proposed').length;
  const openTasks = tasks.filter((t) => t.status !== 'done').length;
  const current = navItemFor(location.pathname);

  // Tell the assistant what the user is looking at, so its header reflects the
  // page rather than claiming generic context.
  useEffect(() => {
    setContextLabel(current ? `Context: ${current.label}` : 'Atmosphere');
  }, [current, setContextLabel]);

  // The drawer closes via LeftNav's `onNavigate` callback rather than an effect
  // watching the pathname — same result, without a cascading render.

  return (
    <div className="flex h-screen w-full overflow-hidden bg-canvas text-fg-2">
      {/* ── Left navigation ───────────────────────────────────────────────── */}
      <div className="hidden shrink-0 lg:block">
        <LeftNav
          role={role}
          collapsed={navCollapsed}
          onToggleCollapsed={() => setNavCollapsed((c) => !c)}
          counts={{ approvals: pendingApprovals, 'my-work': openTasks }}
        />
      </div>

      <MobileNav
        open={mobileNavOpen}
        onOpenChange={setMobileNavOpen}
        role={role}
        counts={{ approvals: pendingApprovals, 'my-work': openTasks }}
      />

      {/* ── Workspace ─────────────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-topbar shrink-0 items-center gap-3 border-b border-line/10 bg-canvas/80 px-3 backdrop-blur-xl sm:px-4">
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            aria-label="Open navigation"
            className="rounded-md p-1.5 text-fg-3 transition hover:bg-line/5 hover:text-fg lg:hidden"
          >
            <Menu className="h-5 w-5" />
          </button>

          <div className="flex min-w-0 flex-1 items-center gap-3">
            <CommandBar role={role} />
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {pendingApprovals > 0 && (
              <Badge tone="warn" className="hidden sm:inline-flex">
                {pendingApprovals} awaiting approval
              </Badge>
            )}
            {!assistantOpen && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setAssistantOpen(true)}
                leadingIcon={<Sparkles className="h-3.5 w-3.5 text-brand-400" />}
                className="hidden xl:inline-flex"
              >
                Assistant
              </Button>
            )}
            <UserMenu />
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          <main className="min-w-0 flex-1 overflow-y-auto">
            <Outlet />
          </main>

          {/* ── Assistant panel ───────────────────────────────────────────── */}
          <div
            className={cn(
              'hidden shrink-0 transition-[width] duration-200 xl:block',
              assistantOpen ? 'w-assistant' : 'w-0 overflow-hidden',
            )}
          >
            {assistantOpen && (
              <AssistantPanel role={role} onClose={() => setAssistantOpen(false)} />
            )}
          </div>
        </div>
      </div>

      {/* Below xl the panel becomes an overlay sheet, launched from this button. */}
      <MobileAssistantLauncher role={role} />
    </div>
  );
}

function MobileAssistantLauncher({ role }: { role: Role }) {
  const [open, setOpen] = useState(false);
  const { messages } = useAssistant();

  // Escape closes the sheet — expected on any modal surface, and cheap here
  // because the panel owns no focusable state of its own on open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open Atmosphere assistant"
        className={cn(
          'fixed bottom-20 right-4 z-30 grid h-12 w-12 place-items-center rounded-full sm:bottom-6',
          'bg-gradient-to-br from-brand-500 to-brand-700 shadow-xl shadow-brand-900/50',
          'transition hover:scale-105 active:scale-95 xl:hidden',
        )}
      >
        <Sparkles className="h-5 w-5 text-white" />
        {messages.length > 0 && (
          <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-canvas bg-state-warn" />
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Atmosphere assistant"
          className="fixed inset-0 z-50 xl:hidden"
        >
          <button
            type="button"
            aria-label="Close assistant"
            className="absolute inset-0 bg-scrim/70 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <div className="absolute inset-y-0 right-0 w-[min(24rem,100vw)] animate-slide-in-right">
            <AssistantPanel role={role} onClose={() => setOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
}
