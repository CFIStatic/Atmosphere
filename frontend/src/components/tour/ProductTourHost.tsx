import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import {
  clearPendingTour,
  markTourCompleted,
  PRODUCT_TOURS,
  queueProductTour,
  takePendingTour,
  WORK_VERIFICATION_TOUR,
  type ProductTourDefinition,
  type TourStep,
} from '../../lib/productTour';
import { usePreferences } from '../../lib/preferences';
import { TourSimulationPanel } from './TourSimulationPanel';

type Rect = { top: number; left: number; width: number; height: number };

function measureTarget(selector: string): Rect | null {
  const el = document.querySelector(`[data-tour="${selector}"]`);
  if (!el) return null;
  const box = el.getBoundingClientRect();
  if (box.width < 1 || box.height < 1) return null;
  return { top: box.top, left: box.left, width: box.width, height: box.height };
}

export function ProductTourHost() {
  const { user, membership } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { reduceMotion } = usePreferences();

  const [tour, setTour] = useState<ProductTourDefinition | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [spotlight, setSpotlight] = useState<Rect | null>(null);
  const [ready, setReady] = useState(false);

  const step: TourStep | null = tour?.steps[stepIndex] ?? null;

  const finish = useCallback(() => {
    if (tour) markTourCompleted(tour.id);
    setTour(null);
    setStepIndex(0);
    setSpotlight(null);
    if (searchParams.has('tour')) {
      const next = new URLSearchParams(searchParams);
      next.delete('tour');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams, tour]);

  const startTour = useCallback((definition: ProductTourDefinition) => {
    setTour(definition);
    setStepIndex(0);
    setReady(false);
  }, []);

  // Auto-start after signup (?tour=1), pending queue, or navigation while pending.
  useEffect(() => {
    if (!user || !membership || tour) return;

    const replay = searchParams.get('tour');
    if (replay === '1' || replay === WORK_VERIFICATION_TOUR.id) {
      clearPendingTour();
      startTour(WORK_VERIFICATION_TOUR);
      return;
    }

    const pending = takePendingTour();
    if (pending && PRODUCT_TOURS[pending]) {
      startTour(PRODUCT_TOURS[pending]);
    }
  }, [user, membership, searchParams, location.pathname, location.search, startTour, tour]);

  // Navigate when step changes
  useEffect(() => {
    if (!tour || !step?.route) {
      setReady(true);
      return;
    }
    if (location.pathname !== step.route) {
      setReady(false);
      navigate(step.route);
      return;
    }
    const timer = window.setTimeout(() => setReady(true), reduceMotion ? 0 : 320);
    return () => window.clearTimeout(timer);
  }, [tour, step, location.pathname, navigate, reduceMotion]);

  // Measure spotlight target
  useLayoutEffect(() => {
    if (!tour || !step || !ready) {
      setSpotlight(null);
      return;
    }
    if (!step.target || step.placement === 'center') {
      setSpotlight(null);
      return;
    }

    let frame = 0;
    const measure = () => {
      const rect = measureTarget(step.target!);
      setSpotlight(rect);
    };

    measure();
    const onResize = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(measure);
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
    };
  }, [tour, step, ready, location.pathname]);

  if (!tour || !step) return null;

  const isLast = stepIndex >= tour.steps.length - 1;
  const isCenter = step.placement === 'center' || !step.target || !spotlight;

  function next() {
    if (isLast) finish();
    else setStepIndex((i) => i + 1);
  }

  function back() {
    if (stepIndex > 0) setStepIndex((i) => i - 1);
  }

  const pad = 8;
  const hole = spotlight
    ? {
        top: spotlight.top - pad,
        left: spotlight.left - pad,
        width: spotlight.width + pad * 2,
        height: spotlight.height + pad * 2,
      }
    : null;

  const card = (
    <div className="w-full max-w-md animate-fade-in-up rounded-2xl border border-brand-200 bg-paper-0 p-6 shadow-lift-xl">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-brand-600">
        Step {stepIndex + 1} of {tour.steps.length}
      </p>
      <h2 id="tour-title" className="mt-2 text-lg font-bold text-ink-900">
        {step.title}
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-ink-600">{step.body}</p>

      {step.simulation ? (
        <div className="mt-4">
          <TourSimulationPanel kind={step.simulation} />
        </div>
      ) : null}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={finish}
          className="text-sm font-medium text-ink-500 transition hover:text-ink-800"
        >
          Skip tour
        </button>
        <div className="flex items-center gap-2">
          {stepIndex > 0 && (
            <button
              type="button"
              onClick={back}
              className="rounded-lg px-3 py-2 text-sm font-medium text-ink-600 hover:bg-paper-100"
            >
              Back
            </button>
          )}
          <button
            type="button"
            onClick={next}
            className="rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-semibold text-ink-900 shadow hover:bg-brand-400"
          >
            {isLast ? 'Start working' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );

  const cardStyle = !isCenter && hole ? cardPosition(step.placement ?? 'bottom', hole) : undefined;

  return (
    <div className="fixed inset-0 z-[100]" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      {hole ? (
        <div
          className="pointer-events-none absolute rounded-xl ring-2 ring-brand-400 transition-all duration-300"
          style={{
            top: hole.top,
            left: hole.left,
            width: hole.width,
            height: hole.height,
            boxShadow: '0 0 0 9999px rgba(15, 12, 10, 0.72)',
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-scrim/75 backdrop-blur-[2px]" />
      )}

      {isCenter ? (
        <div className="pointer-events-auto absolute inset-0 flex items-center justify-center p-4">
          {card}
        </div>
      ) : (
        <div className="pointer-events-auto absolute p-4" style={cardStyle}>
          {card}
        </div>
      )}
    </div>
  );
}

function cardPosition(
  placement: NonNullable<TourStep['placement']>,
  hole: Rect,
): { top: number; left: number; maxWidth: number } {
  const margin = 12;
  const cardWidth = Math.min(420, window.innerWidth - margin * 2);
  const centerX = hole.left + hole.width / 2;

  switch (placement) {
    case 'right':
      return {
        top: Math.max(margin, hole.top),
        left: Math.min(hole.left + hole.width + margin, window.innerWidth - cardWidth - margin),
        maxWidth: cardWidth,
      };
    case 'left':
      return {
        top: Math.max(margin, hole.top),
        left: Math.max(margin, hole.left - cardWidth - margin),
        maxWidth: cardWidth,
      };
    case 'top':
      return {
        top: Math.max(margin, hole.top - 280),
        left: Math.max(margin, Math.min(centerX - cardWidth / 2, window.innerWidth - cardWidth - margin)),
        maxWidth: cardWidth,
      };
    default:
      return {
        top: Math.min(hole.top + hole.height + margin, window.innerHeight - 320),
        left: Math.max(margin, Math.min(centerX - cardWidth / 2, window.innerWidth - cardWidth - margin)),
        maxWidth: cardWidth,
      };
  }
}

/** Call after signup billing completes to show the walkthrough on first dashboard entry. */
export function scheduleWorkVerificationTour() {
  queueProductTour(WORK_VERIFICATION_TOUR.id);
}

export { WORK_VERIFICATION_TOUR };
