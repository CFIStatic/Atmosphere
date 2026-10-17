import { formatClipClock } from './clipDuration';

/** Poster badge length: unknown (empty WebM header) reads as a dash, never 0:00. */
export function posterClock(seconds: number | null | undefined): string {
  return formatClipClock(seconds);
}

/** Clearly labeled sample for office users with nothing filmed yet. Not customer data. */
export const SAMPLE_EVIDENCE = {
  title: 'Kitchen leak walkthrough',
  /** Synthetic poster of the sample scene. Not a customer clip. */
  posterUrl: '/samples/kitchen-leak-poster.jpg',
  durationSeconds: 38,
  summary:
    'Leak under the kitchen sink; the lower cabinet reads 28% moisture. Plan said on camera: pull the toe kick and set two air movers today; the base cabinet comes out if it is wet behind.',
  lines: [
    { at: '0:04', text: 'This is the kitchen. The leak started under the sink.' },
    { at: '0:11', text: 'Moisture reads twenty-eight percent on the lower cabinet.' },
    { at: '0:19', text: "We'll pull the toe kick and set two air movers today." },
    { at: '0:27', text: 'If the base cabinet is wet behind, it comes out.' },
  ],
  ask: {
    question: 'What was said about the cabinet?',
    answer: '“Moisture reads twenty-eight percent on the lower cabinet.” [0:11] and “If the base cabinet is wet behind, it comes out.” [0:27] Speaker not identified.',
  },
} as const;
