/**
 * A realistic worked example: a Category 2 dishwasher supply-line failure that
 * ran for two days before anyone noticed.
 *
 * It exists for three reasons. It is the smoke test for the whole pipeline
 * (`npm run estimator:demo`). It is the "load a demo job" payload in the UI, so
 * the estimator can be evaluated before anyone uploads real claim data. And it
 * documents, by example, the shape each adapter expects — which is more useful
 * to the next person than a schema would be, because the adapters are
 * deliberately tolerant about shape.
 *
 * The numbers are chosen to exercise the interesting paths: water that sat long
 * enough to degrade its category, a wet wall cavity that forces a flood cut,
 * equipment left open in the log, and a missing monitoring-labour line.
 */

export const SAMPLE_DOCUSKETCH = {
  address: '1841 Cypress Bend Dr, Sarasota, FL 34231',
  rooms: [
    {
      id: 'kitchen',
      name: 'Kitchen',
      level: 'Main Level',
      dimensions: { length: 16, width: 13.5, height: 9 },
      floorArea: 216,
      perimeter: 59,
      wallArea: 531,
      openings: [
        { width: 3, height: 6.8 },
        { width: 5, height: 4 },
      ],
      offsets: 2,
      affectedFraction: 1,
      materials: [
        { material: 'sheet vinyl', quantity: 216, salvageable: false },
        { material: 'drywall', wetHeight: 14, cavityWet: true, salvageable: false },
        { material: 'baseboard', quantity: 59 },
        { material: 'cabinetry', quantity: 22 },
      ],
    },
    {
      id: 'dining',
      name: 'Dining Room',
      level: 'Main Level',
      dimensions: { length: 14, width: 12, height: 9 },
      floorArea: 168,
      perimeter: 52,
      offsets: 0,
      affectedFraction: 0.7,
      materials: [
        { material: 'carpet', quantity: 118, salvageable: false },
        { material: 'carpet pad', quantity: 118, salvageable: false },
        { material: 'drywall', wetHeight: 9, cavityWet: false, salvageable: true },
        { material: 'baseboard', quantity: 52 },
      ],
    },
    {
      id: 'hall',
      name: 'Hallway',
      level: 'Main Level',
      dimensions: { length: 22, width: 4, height: 9 },
      floorArea: 88,
      perimeter: 52,
      offsets: 1,
      affectedFraction: 1,
      materials: [
        { material: 'engineered wood', quantity: 88, salvageable: false },
        { material: 'baseboard', quantity: 52 },
      ],
    },
  ],
};

export const SAMPLE_MICA = {
  job: {
    claimNumber: 'FL-2026-0417839',
    carrier: 'Gulfstream Mutual',
    insured: 'R. Okonkwo',
    address: '1841 Cypress Bend Dr, Sarasota, FL 34231',
    // Two days between the loss and arrival — enough for Category 1 water to
    // degrade to Category 2 under S500 §10.5.4.
    dateOfLoss: '2026-06-14T22:10:00Z',
    dateOfArrival: '2026-06-16T13:40:00Z',
    cause: 'Dishwasher supply line failure under the sink',
    category: 2,
  },
  rooms: [
    { name: 'Kitchen', affectedPercent: 100, notes: 'Water tracked under the cabinet run.' },
    { name: 'Dining Room', affectedPercent: 70 },
    { name: 'Hallway', affectedPercent: 100 },
  ],
  moistureReadings: [
    { room: 'kitchen', material: 'drywall', value: 42, dryStandard: 12, takenAt: '2026-06-16T14:05:00Z', location: 'north wall, 12in AFF' },
    { room: 'kitchen', material: 'subfloor', value: 28, dryStandard: 14, takenAt: '2026-06-16T14:08:00Z' },
    { room: 'dining', material: 'carpet', value: 61, dryStandard: 10, takenAt: '2026-06-16T14:20:00Z' },
    { room: 'hall', material: 'engineered wood', value: 24, dryStandard: 9, takenAt: '2026-06-16T14:31:00Z' },
    { room: 'kitchen', material: 'drywall', value: 13, dryStandard: 12, takenAt: '2026-06-20T09:15:00Z', location: 'north wall, 12in AFF — final' },
  ],
  psychrometrics: [
    { zone: 'affected', temperature: 79, rh: 62, takenAt: '2026-06-16T14:00:00Z' },
    { zone: 'unaffected', temperature: 76, rh: 55, takenAt: '2026-06-16T14:00:00Z' },
    { zone: 'outside', temperature: 91, rh: 74, takenAt: '2026-06-16T14:00:00Z' },
    { zone: 'affected', temperature: 84, rh: 38, takenAt: '2026-06-19T09:00:00Z' },
    { zone: 'unaffected', temperature: 77, rh: 52, takenAt: '2026-06-19T09:00:00Z' },
  ],
  equipment: [
    { type: 'Air mover', quantity: 11, room: 'kitchen', placedAt: '2026-06-16T16:00:00Z', removedAt: '2026-06-20T11:00:00Z' },
    { type: 'Air mover', quantity: 6, room: 'dining', placedAt: '2026-06-16T16:20:00Z', removedAt: '2026-06-20T11:00:00Z' },
    { type: 'Air mover', quantity: 4, room: 'hall', placedAt: '2026-06-16T16:30:00Z', removedAt: '2026-06-20T11:00:00Z' },
    // Deliberately left open — this is the leak the profitability review catches.
    { type: 'LGR Dehumidifier', quantity: 3, placedAt: '2026-06-16T16:45:00Z' },
    { type: 'Air scrubber', quantity: 1, room: 'kitchen', placedAt: '2026-06-16T17:00:00Z', removedAt: '2026-06-20T11:00:00Z' },
  ],
  monitoring: [
    { date: '2026-06-17T09:10:00Z', notes: 'All readings falling. Repositioned two movers in the hallway.' },
    { date: '2026-06-18T08:55:00Z', notes: 'Kitchen wall cavity still elevated. Left equipment as set.' },
    { date: '2026-06-19T09:00:00Z', notes: 'Dining room at dry standard. Pulled two movers.' },
    { date: '2026-06-20T09:05:00Z', notes: 'All materials at dry standard. Demobilised.' },
  ],
};

export const SAMPLE_PHOTOS = [
  { filename: 'IMG_4401.HEIC', capturedAt: '2026-06-16T13:44:00Z', roomName: 'Kitchen', caption: 'Source — dishwasher supply line burst under sink' },
  { filename: 'IMG_4402.HEIC', capturedAt: '2026-06-16T13:46:00Z', roomName: 'Kitchen', caption: 'Before — standing water across kitchen floor, extraction starting' },
  { filename: 'IMG_4407.HEIC', capturedAt: '2026-06-16T14:05:00Z', roomName: 'Kitchen', caption: 'Moisture meter reading drywall north wall 42%' },
  { filename: 'IMG_4411.HEIC', capturedAt: '2026-06-16T15:10:00Z', roomName: 'Kitchen', caption: 'Flood cut 24in north and west walls, insulation wet' },
  { filename: 'IMG_4412.HEIC', capturedAt: '2026-06-16T15:14:00Z', roomName: 'Kitchen', caption: 'Baseboard removed, cabinet toe kick opened for cavity drying' },
  { filename: 'IMG_4418.HEIC', capturedAt: '2026-06-16T15:40:00Z', roomName: 'Dining Room', caption: 'Carpet and pad out, contents moved to garage' },
  { filename: 'IMG_4423.HEIC', capturedAt: '2026-06-16T16:05:00Z', roomName: 'Kitchen', caption: 'Antimicrobial applied to affected surfaces' },
  { filename: 'IMG_4427.HEIC', capturedAt: '2026-06-16T16:30:00Z', roomName: 'Kitchen', caption: 'Air movers and LGR dehumidifier set, air scrubber running' },
  { filename: 'IMG_4431.HEIC', capturedAt: '2026-06-16T16:50:00Z', roomName: 'Hallway', caption: 'Containment poly at hallway, floor protection down the exit path' },
  { filename: 'IMG_4460.HEIC', capturedAt: '2026-06-20T10:45:00Z', roomName: 'Kitchen', caption: 'After — HEPA vacuum complete, all materials at dry standard' },
];

export const SAMPLE_NOTES = `Arrived 6/16 ~9:40am local. Cat 2 from the dishwasher supply line, ran overnight 6/14 into 6/15 before the homeowner noticed.

Kitchen 16x13.5x9 — sheet vinyl unsalvageable, wall cavity wet behind the north and west runs. Flood cut 24in both walls, insulation out, baseboard out. Toe kick opened on 22ft of cabinet.

Dining 14x12 — carpet and pad out, drywall reads high at the base but the cavity is dry so we're drying that in place.

Hall 22x4 — engineered wood cupping, coming out.

Set 21 air movers, 3 LGR, 1 scrubber. Contents to the garage. Antimicrobial on everything after demo.`;

export const SAMPLE_JOB = {
  jobId: 'demo-cypress-bend',
  docusketch: SAMPLE_DOCUSKETCH,
  mica: SAMPLE_MICA,
  photos: SAMPLE_PHOTOS,
  notes: SAMPLE_NOTES,
};
