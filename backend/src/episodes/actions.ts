/**
 * The action vocabulary.
 *
 * A closed list, deliberately. The value of labelling an action sequence comes
 * entirely from the same physical motion getting the same name every time — a
 * dataset where one episode says "fasten", another "screw" and a third
 * "attach" is three datasets, none of them large enough to be worth anything.
 *
 * The list is short and physical. It describes what a body did, not what a
 * trade calls it: soldering a joint and gluing a joint are both `connect`,
 * with the tool and material carrying the difference. Trade vocabulary lives
 * in the ontology, where it belongs; this layer has to stay small enough that
 * a model can label reliably and a person can check the label in a second.
 *
 * Adding a verb is a real decision, not a convenience. Every addition
 * retroactively splits a category that older episodes are already labelled
 * with, so `OTHER` exists as the honest escape hatch: an action nobody can
 * name is recorded as unnamed rather than forced into the nearest verb.
 */

export const WORK_ACTIONS = [
  'locate',
  'measure',
  'mark',
  'pick_up',
  'carry',
  'position',
  'align',
  'cut',
  'drill',
  'fasten',
  'apply',
  'connect',
  'test',
  'inspect',
  'remove',
  'clean',
  'protect',
  'correct',
  'wait',
  'other',
] as const;

export type WorkAction = (typeof WORK_ACTIONS)[number];

const ACTION_SET = new Set<string>(WORK_ACTIONS);

export interface ActionDefinition {
  /** What the body is doing, in terms a labeller can check against footage. */
  meaning: string;
  /** Where the verb is easy to confuse with a neighbour, say so here. */
  notConfusedWith?: string;
}

export const ACTION_DEFINITIONS: Record<WorkAction, ActionDefinition> = {
  locate: {
    meaning: 'Finding where something is or should go — studs, a valve, a leak, a layout point.',
    notConfusedWith: 'measure, which produces a number. Locating produces a place.',
  },
  measure: { meaning: 'Producing a dimension or reading with an instrument.' },
  mark: { meaning: 'Making a physical mark that later work follows.' },
  pick_up: { meaning: 'Taking hold of a tool, material or object.' },
  carry: { meaning: 'Moving something from one place to another.' },
  position: { meaning: 'Placing an object roughly where it belongs.' },
  align: {
    meaning: 'Adjusting an already-placed object to meet a tolerance.',
    notConfusedWith: 'position, which is the coarse placement. Align is the correction after it.',
  },
  cut: { meaning: 'Separating material — saw, knife, shears, torch.' },
  drill: { meaning: 'Making a hole.' },
  fasten: { meaning: 'Mechanically holding two things together — screw, nail, clamp, bolt.' },
  apply: { meaning: 'Spreading or dispensing a substance — adhesive, flux, coating, sealant.' },
  connect: {
    meaning: 'Joining two elements into one continuous assembly — solder, weld, glue, crimp, thread.',
    notConfusedWith: 'fasten, which holds parts adjacent. Connect makes them one system.',
  },
  test: { meaning: 'Applying a deliberate stress or instrument to see whether the work holds.' },
  inspect: { meaning: 'Looking deliberately at work to judge it, without changing it.' },
  remove: { meaning: 'Taking existing material out — demolition, tear-out, extraction, stripping.' },
  clean: { meaning: 'Removing debris, dust or contamination from a surface or space.' },
  protect: { meaning: 'Covering, masking or containing to prevent damage or spread.' },
  correct: {
    meaning: 'Redoing or adjusting work already performed, because it was wrong.',
    notConfusedWith: 'align. Correct implies a prior attempt judged unacceptable.',
  },
  wait: { meaning: 'Deliberate elapsed time the work requires — cure, dry, set, pressurise.' },
  other: { meaning: 'A real action the vocabulary cannot name. Better than a wrong verb.' },
};

export function isWorkAction(value: string): value is WorkAction {
  return ACTION_SET.has(value);
}

/**
 * Coerce a model's free-text verb onto the vocabulary.
 *
 * Returns null rather than guessing when nothing matches — the caller records
 * `other` with the original text, which keeps the unmatched verb visible for
 * the next time the vocabulary is reviewed. Silently mapping "torque" to
 * "fasten" would be right; silently mapping "prime" to "clean" would be wrong,
 * and this layer cannot tell the difference, so it does neither.
 */
export function normaliseAction(raw: string): WorkAction | null {
  const value = raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (isWorkAction(value)) return value;

  const synonyms: Record<string, WorkAction> = {
    screw: 'fasten',
    nail: 'fasten',
    bolt: 'fasten',
    attach: 'fasten',
    solder: 'connect',
    weld: 'connect',
    glue: 'connect',
    crimp: 'connect',
    join: 'connect',
    saw: 'cut',
    trim: 'cut',
    demo: 'remove',
    demolish: 'remove',
    tear_out: 'remove',
    extract: 'remove',
    strip: 'remove',
    vacuum: 'clean',
    wipe: 'clean',
    spray: 'apply',
    coat: 'apply',
    seal: 'apply',
    cover: 'protect',
    mask: 'protect',
    contain: 'protect',
    check: 'inspect',
    verify: 'inspect',
    dry: 'wait',
    cure: 'wait',
    set: 'wait',
    place: 'position',
    lift: 'pick_up',
    move: 'carry',
    rework: 'correct',
    redo: 'correct',
  };

  return synonyms[value] ?? null;
}
