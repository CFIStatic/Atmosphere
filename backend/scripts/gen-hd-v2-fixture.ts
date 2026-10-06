import { writeFileSync, mkdirSync } from 'node:fs';
import {
  extractJobMaterials,
  materialsRowsForUi,
  formatMaterialsListForChat,
} from '../src/shared/jobMaterials.js';
import {
  matchMaterialsForVendor,
  checkFulfillment,
  buildSupplyCart,
} from '../src/computer/supplyOrder.js';

async function main() {
  const JOB_ID = '058b09a8-3ca0-4d29-b554-4c54de26dea5';
  const PROOF_ID = 'cedca9e4-5f44-4094-bd03-e4289f44e183';

  const file = {
    job: { id: JOB_ID, title: 'Birch Lane Kitchen Remodel', claimNumber: null },
    facts: {},
    scope: [],
    clips: [
      {
        workDate: '2026-10-04',
        proofId: PROOF_ID,
        summary:
          'A short handheld walkthrough through cabinets, laminate countertop measurement, birch plywood, glue-up, and flooring.',
        narration:
          'Opens on a white cabinet face with a raw maple/birch plywood box above it. Measuring a dark stone-pattern laminate slab. Glue bottle visible during clamp-up. Birch plywood cabinet interior.',
        transcript: `[0:00] Morning. We are at the Birch Lane kitchen. The base cabinet for the sink wall is assembled. The countertop is not on yet.
[0:08] Measuring the laminate countertop. 61 and a half inches. Cutting it with a circular saw and a board guide.
[0:16] The countertop is glued, clamped, and screwed down to the base cabinet. Let it set about an hour before anybody leans on it.
[0:23] Heads up! The top drawer on this base cabinet sits about a quarter inch off center. We will shim the slides before the handles go on. Do not install the handles yet.
[0:32] The upper cabinet for the microwave is going up. Using the level and two boards to hold it while we screw it into the studs.
[0:40] Crown molding. The corner pieces are in. Running the straight lengths now with glue and finished nails.
[0:47] Flooring in the back room is underway. Going right over the old black and white tile.
[0:53] The back room floor is done. Tomorrow we hang the microwave, fix that drawer, and caulk the countertop. That's it for today.
[1:02] Morning.`,
        concerns: [],
        changes: [],
      },
    ],
    documents: [],
  };

  const list = extractJobMaterials(file as unknown as Parameters<typeof extractJobMaterials>[0], null);
  const rows = materialsRowsForUi(list, { jobId: JOB_ID });
  const summary = formatMaterialsListForChat(list, { jobId: JOB_ID });

  const priority = [
    /laminate\s*countertop/i,
    /base\s*cabinet/i,
    /birch\s*plywood|plywood/i,
    /drawer\s*slides|slides/i,
    /construction\s*adhesive|adhesive|glue/i,
    /crown\s*molding|molding/i,
    /caulk/i,
    /finished\s*nails|nails/i,
    /upper\s*cabinet|cabinet/i,
    /flooring/i,
  ];
  const ranked = [...list.items].sort((a, b) => {
    const ai = priority.findIndex((r) => r.test(a.item));
    const bi = priority.findIndex((r) => r.test(b.item));
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
  });
  const top = { ...list, items: ranked };

  const matches = await matchMaterialsForVendor(top, 'home_depot', async () => ({
    ok: false,
    status: 403,
    text: '',
  }));
  const fulfillment = checkFulfillment({ jobAddress: null, matches });
  const cart = buildSupplyCart({ vendor: 'home_depot', matches, fulfillment });

  const out = {
    job: {
      id: JOB_ID,
      title: 'Birch Lane Kitchen Remodel',
      account: 'appreview@atmosphereteam.com',
      proofId: PROOF_ID,
      workDate: '2026-10-04',
      clipTitle: 'Cabinets, countertop and floors — day 1',
    },
    materialsSummary: summary,
    materialsRows: rows,
    approve: {
      actionKind: 'pay' as const,
      buttonLabel: 'Place Order',
      summary: cart.summary,
      pageUrl: 'https://www.homedepot.com/checkout/review-order',
      fields: cart.approvalFields,
      screenshot: null as string | null,
    },
    cart: {
      subtotalCents: cart.subtotalCents,
      lineCount: cart.lines.length,
      notAdded: cart.notAdded,
      lines: cart.lines.map((l) => ({
        item: l.match.materialItem,
        product: l.match.productName,
        sku: l.match.sku,
        url: l.match.url,
        qty: l.match.quantity,
        unit: l.match.unit,
        unitPriceCents: l.match.priceCents,
        lineTotalCents: l.lineTotalCents,
        confidence: l.match.confidence,
      })),
    },
  };

  mkdirSync('/workspace/screens/hd-order', { recursive: true });
  writeFileSync('/workspace/screens/hd-order/hd-v2-fixture.json', JSON.stringify(out, null, 2));
  mkdirSync('/workspace/Atmosphere-hd-order/frontend/src/dev', { recursive: true });
  writeFileSync(
    '/workspace/Atmosphere-hd-order/frontend/src/dev/hdOrderV2Fixture.json',
    JSON.stringify(out, null, 2),
  );
  console.log('items', list.items.map((i) => `${i.item} qty=${i.quantity}`).join(' | '));
  console.log('cart lines', out.cart.lines.length, 'subtotal', out.cart.subtotalCents);
  for (const l of out.cart.lines) {
    console.log(' -', l.item, '->', l.product?.slice(0, 50), 'qty', l.qty, 'line', l.lineTotalCents);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
