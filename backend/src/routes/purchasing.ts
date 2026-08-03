import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireOrgContext } from '../lib/orgContext.js';
import { HttpError } from '../lib/errors.js';
import { buildTakeoff, workLinesOf } from '../purchasing/takeoff.js';
import {
  ADAPTERS,
  SUPPLIERS,
  SupplierError,
  deleteSupplierConnection,
  listSupplierConnections,
  loadSupplierConnection,
  saveSupplierConnection,
  type SupplierId,
} from '../purchasing/suppliers.js';

/**
 * Purchase orders.
 *
 * The route layer is thin on purpose: the approval gate lives in the database
 * (a trigger refuses draft → placed, and refuses touching a placed order at
 * all), so nothing here has to be trusted to remember the rules. What this
 * layer adds is the vocabulary — takeoff previews, the approve/place verbs,
 * and the honest failure when a store's API is not connected yet.
 *
 * Money only ever moves after a named person approves, and the approval is a
 * row-level fact (approved_by, approved_at), not a UI state.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export const purchasingRouter = Router();
purchasingRouter.use(requireAuth);

const PO_SELECT =
  'id, estimate_id, job_name, claim_number, supplier, vendor_account_id, status, ' +
  'approved_by, approved_at, placed_at, external_ref, note, created_by, created_at, updated_at';
const LINE_SELECT =
  'id, material_key, description, detail, quantity, unit, unit_price, price_basis, source_summary, position';

const SUPPLIER_IDS = ['home_depot', 'lowes', 'manual'] as const;
const supplierSchema = z.enum(SUPPLIER_IDS);

const lineSchema = z.object({
  materialKey: z.string().min(1).max(80),
  description: z.string().min(1).max(300),
  detail: z.string().max(300).nullish(),
  quantity: z.number().positive().max(100000),
  unit: z.string().min(1).max(30),
  unitPrice: z.number().min(0).max(1000000).nullish(),
  sourceSummary: z.string().max(2000).nullish(),
});

const createSchema = z.object({
  estimateId: z.string().uuid().nullish(),
  jobName: z.string().min(1).max(200),
  claimNumber: z.string().max(60).nullish(),
  supplier: supplierSchema,
  note: z.string().max(1000).nullish(),
  lines: z.array(lineSchema).min(1).max(200),
});

const VENDOR_NAMES: Record<SupplierId, string> = {
  home_depot: 'The Home Depot',
  lowes: "Lowe's",
};

function serializeOrder(row: any) {
  return {
    id: row.id,
    estimateId: row.estimate_id,
    jobName: row.job_name,
    claimNumber: row.claim_number,
    supplier: row.supplier,
    vendorAccountId: row.vendor_account_id,
    status: row.status,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    placedAt: row.placed_at,
    externalRef: row.external_ref,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeLine(row: any) {
  return {
    id: row.id,
    materialKey: row.material_key,
    description: row.description,
    detail: row.detail,
    quantity: Number(row.quantity),
    unit: row.unit,
    unitPrice: row.unit_price === null ? null : Number(row.unit_price),
    priceBasis: row.price_basis,
    sourceSummary: row.source_summary,
  };
}

const orderTotal = (lines: Array<{ quantity: number; unitPrice: number | null }>) =>
  Math.round(lines.reduce((sum, l) => sum + l.quantity * (l.unitPrice ?? 0), 0) * 100) / 100;

/**
 * The supplier as a CRM account. This is the "accounts" half of the feature:
 * a store the org buys from is a vendor like any other, and putting it in
 * crm_accounts means supplier spend shows up in the same account structure,
 * links and history as the rest of the business — not in a parallel list.
 */
async function ensureVendorAccount(
  supabase: any,
  orgId: string,
  userId: string,
  supplier: SupplierId,
): Promise<string | null> {
  const name = VENDOR_NAMES[supplier];
  const { data: existing } = await supabase
    .from('crm_accounts')
    .select('id')
    .eq('org_id', orgId)
    .eq('type', 'vendor')
    .ilike('name', name)
    .limit(1)
    .maybeSingle();
  if (existing?.id) return existing.id;

  const { data: created, error } = await supabase
    .from('crm_accounts')
    .insert({ org_id: orgId, name, type: 'vendor', created_by: userId })
    .select('id')
    .single();
  // A vendor account is bookkeeping around the order, not a precondition for
  // it — if creation fails the order still goes through, unlinked.
  if (error) return null;
  return created.id;
}

async function writeEvent(
  supabase: any,
  input: { poId: string; orgId: string; actor: string; action: string; detail?: string },
): Promise<void> {
  await supabase.from('purchase_order_events').insert({
    po_id: input.poId,
    org_id: input.orgId,
    actor: input.actor,
    action: input.action,
    detail: input.detail ?? '',
  });
}

async function loadOrder(supabase: any, id: string) {
  const { data, error } = await supabase
    .from('purchase_orders')
    .select(PO_SELECT)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new HttpError(500, error.message, 'po_load_failed');
  if (!data) throw new HttpError(404, 'No such purchase order.', 'po_not_found');
  return data;
}

/* ------------------------------------------------------------------ *
 * Sources & takeoff
 * ------------------------------------------------------------------ */

/** GET /api/purchasing/sources — recent estimates to build an order from. */
purchasingRouter.get('/sources', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase, orgId } = await requireOrgContext(req);
    const { data, error } = await supabase
      .from('estimator_estimates')
      .select('id, total, created_at, estimator_jobs (name, claim_number)')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .limit(25);
    if (error) throw new HttpError(500, error.message, 'sources_failed');
    res.json({
      sources: (data ?? []).map((row: any) => ({
        estimateId: row.id,
        jobName: row.estimator_jobs?.name ?? 'Untitled job',
        claimNumber: row.estimator_jobs?.claim_number ?? null,
        total: Number(row.total),
        createdAt: row.created_at,
      })),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/purchasing/takeoff { estimateId }
 *
 * Pure preview — nothing is written. The person sees what the estimate's
 * quantities become in purchase units, edits, and only then creates a draft.
 */
purchasingRouter.post('/takeoff', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { estimateId } = z.object({ estimateId: z.string().uuid() }).parse(req.body);
    const { supabase } = await requireOrgContext(req);
    const { data, error } = await supabase
      .from('estimator_estimates')
      .select('id, payload, created_at, estimator_jobs (name, claim_number)')
      .eq('id', estimateId)
      .maybeSingle();
    if (error) throw new HttpError(500, error.message, 'takeoff_failed');
    if (!data) throw new HttpError(404, 'That estimate was not found.', 'estimate_not_found');

    const takeoff = buildTakeoff(workLinesOf(data.payload));
    res.json({
      source: {
        estimateId: data.id,
        jobName: (data as any).estimator_jobs?.name ?? 'Untitled job',
        claimNumber: (data as any).estimator_jobs?.claim_number ?? null,
        createdAt: data.created_at,
      },
      takeoff,
    });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------ *
 * Orders
 * ------------------------------------------------------------------ */

/** GET /api/purchasing/orders */
purchasingRouter.get('/orders', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase, orgId } = await requireOrgContext(req);
    const [orders, lines] = await Promise.all([
      supabase
        .from('purchase_orders')
        .select(PO_SELECT)
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })
        .limit(100),
      supabase.from('purchase_order_lines').select('po_id, quantity, unit_price').eq('org_id', orgId),
    ]);
    if (orders.error) throw new HttpError(500, orders.error.message, 'orders_failed');

    const totals = new Map<string, { count: number; total: number }>();
    for (const row of lines.data ?? []) {
      const entry = totals.get(row.po_id) ?? { count: 0, total: 0 };
      entry.count += 1;
      entry.total += Number(row.quantity) * Number(row.unit_price ?? 0);
      totals.set(row.po_id, entry);
    }

    res.json({
      orders: (orders.data ?? []).map((row: any) => ({
        ...serializeOrder(row),
        lineCount: totals.get(row.id)?.count ?? 0,
        estTotal: Math.round((totals.get(row.id)?.total ?? 0) * 100) / 100,
      })),
    });
  } catch (err) {
    next(err);
  }
});

/** POST /api/purchasing/orders — create a draft from an edited takeoff. */
purchasingRouter.post('/orders', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = createSchema.parse(req.body);
    const { supabase, orgId, userId } = await requireOrgContext(req);

    const vendorAccountId =
      body.supplier === 'manual'
        ? null
        : await ensureVendorAccount(supabase, orgId, userId, body.supplier);

    const { data: created, error } = await supabase
      .from('purchase_orders')
      .insert({
        org_id: orgId,
        created_by: userId,
        estimate_id: body.estimateId ?? null,
        job_name: body.jobName,
        claim_number: body.claimNumber ?? null,
        supplier: body.supplier,
        vendor_account_id: vendorAccountId,
        note: body.note ?? null,
      })
      .select(PO_SELECT)
      .single();
    if (error) throw new HttpError(400, error.message, 'po_create_failed');
    const po = created as any;

    const { error: lineError } = await supabase.from('purchase_order_lines').insert(
      body.lines.map((line, index) => ({
        po_id: po.id,
        org_id: orgId,
        material_key: line.materialKey,
        description: line.description,
        detail: line.detail ?? null,
        quantity: line.quantity,
        unit: line.unit,
        unit_price: line.unitPrice ?? null,
        source_summary: line.sourceSummary ?? null,
        position: index,
      })),
    );
    if (lineError) {
      // A draft with no lines is noise; take the header back out.
      await supabase.from('purchase_orders').delete().eq('id', po.id);
      throw new HttpError(400, lineError.message, 'po_lines_failed');
    }

    const total = orderTotal(body.lines.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice ?? null })));
    await writeEvent(supabase, {
      poId: po.id,
      orgId,
      actor: userId,
      action: 'created',
      detail: `${body.lines.length} lines, estimated $${total.toFixed(2)}, from ${body.jobName}`,
    });

    res.status(201).json({ order: serializeOrder(po) });
  } catch (err) {
    next(err);
  }
});

/** GET /api/purchasing/orders/:id — the order, its lines, and its history. */
purchasingRouter.get('/orders/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase } = await requireOrgContext(req);
    const po = await loadOrder(supabase, req.params.id);

    const [lines, events] = await Promise.all([
      supabase.from('purchase_order_lines').select(LINE_SELECT).eq('po_id', po.id).order('position'),
      supabase.from('purchase_order_events').select('id, actor, action, detail, at').eq('po_id', po.id).order('at'),
    ]);

    const actorIds = [...new Set((events.data ?? []).map((e: any) => e.actor).filter(Boolean))];
    const names = new Map<string, string>();
    if (actorIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name, email')
        .in('id', actorIds);
      for (const p of profiles ?? []) names.set(p.id, p.full_name || p.email || 'Someone');
    }

    const serializedLines = (lines.data ?? []).map(serializeLine);
    res.json({
      order: serializeOrder(po),
      lines: serializedLines,
      estTotal: orderTotal(serializedLines),
      events: (events.data ?? []).map((e: any) => ({
        id: e.id,
        actorName: e.actor ? (names.get(e.actor) ?? 'Someone') : 'System',
        action: e.action,
        detail: e.detail,
        at: e.at,
      })),
    });
  } catch (err) {
    next(err);
  }
});

/** PATCH /api/purchasing/orders/:id — replace a draft's lines and note. */
purchasingRouter.patch('/orders/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z
      .object({
        note: z.string().max(1000).nullish(),
        supplier: supplierSchema.optional(),
        lines: z.array(lineSchema).min(1).max(200),
      })
      .parse(req.body);
    const { supabase, orgId, userId } = await requireOrgContext(req);
    const po = await loadOrder(supabase, req.params.id);
    if (po.status !== 'draft') {
      throw new HttpError(409, 'Only a draft can be edited. Reopen it first.', 'not_draft');
    }

    // Wholesale replace: the draft's lines are whatever the person last saw.
    const { error: clearError } = await supabase
      .from('purchase_order_lines')
      .delete()
      .eq('po_id', po.id);
    if (clearError) throw new HttpError(400, clearError.message, 'po_edit_failed');

    const { error: lineError } = await supabase.from('purchase_order_lines').insert(
      body.lines.map((line, index) => ({
        po_id: po.id,
        org_id: orgId,
        material_key: line.materialKey,
        description: line.description,
        detail: line.detail ?? null,
        quantity: line.quantity,
        unit: line.unit,
        unit_price: line.unitPrice ?? null,
        source_summary: line.sourceSummary ?? null,
        position: index,
      })),
    );
    if (lineError) throw new HttpError(400, lineError.message, 'po_edit_failed');

    const updates: Record<string, unknown> = {};
    if (body.note !== undefined) updates.note = body.note;
    if (body.supplier) {
      updates.supplier = body.supplier;
      updates.vendor_account_id =
        body.supplier === 'manual'
          ? null
          : await ensureVendorAccount(supabase, orgId, userId, body.supplier);
    }
    if (Object.keys(updates).length > 0) {
      const { error } = await supabase.from('purchase_orders').update(updates).eq('id', po.id);
      if (error) throw new HttpError(400, error.message, 'po_edit_failed');
    }

    const total = orderTotal(body.lines.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice ?? null })));
    await writeEvent(supabase, {
      poId: po.id,
      orgId,
      actor: userId,
      action: 'edited',
      detail: `${body.lines.length} lines, estimated $${total.toFixed(2)}`,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/purchasing/orders/:id/approve
 *
 * The gate. The row records who and when; the trigger refuses to let a placed
 * order exist without this having happened first.
 */
purchasingRouter.post(
  '/orders/:id/approve',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { supabase, orgId, userId } = await requireOrgContext(req);
      const po = await loadOrder(supabase, req.params.id);
      if (po.status !== 'draft') {
        throw new HttpError(409, `This order is ${po.status}, not a draft.`, 'not_draft');
      }

      const { data, error } = await supabase
        .from('purchase_orders')
        .update({ status: 'approved', approved_by: userId, approved_at: new Date().toISOString() })
        .eq('id', po.id)
        .select(PO_SELECT)
        .single();
      if (error) throw new HttpError(400, error.message, 'approve_failed');

      const { data: lineRows } = await supabase
        .from('purchase_order_lines')
        .select('quantity, unit_price')
        .eq('po_id', po.id);
      const total = orderTotal(
        (lineRows ?? []).map((l: any) => ({
          quantity: Number(l.quantity),
          unitPrice: l.unit_price === null ? null : Number(l.unit_price),
        })),
      );

      await writeEvent(supabase, {
        poId: po.id,
        orgId,
        actor: userId,
        action: 'approved',
        detail: `estimated $${total.toFixed(2)}`,
      });
      res.json({ order: serializeOrder(data) });
    } catch (err) {
      next(err);
    }
  },
);

/** POST /api/purchasing/orders/:id/reopen — withdraw approval, back to draft. */
purchasingRouter.post(
  '/orders/:id/reopen',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { supabase, orgId, userId } = await requireOrgContext(req);
      const po = await loadOrder(supabase, req.params.id);
      if (po.status !== 'approved') {
        throw new HttpError(409, `Only an approved order can be reopened.`, 'not_approved');
      }
      const { data, error } = await supabase
        .from('purchase_orders')
        .update({ status: 'draft' })
        .eq('id', po.id)
        .select(PO_SELECT)
        .single();
      if (error) throw new HttpError(400, error.message, 'reopen_failed');
      await writeEvent(supabase, { poId: po.id, orgId, actor: userId, action: 'reopened' });
      res.json({ order: serializeOrder(data) });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /api/purchasing/orders/:id/place { reference? }
 *
 * With a reference: the order was placed outside Atmosphere (pro desk, phone,
 * the store's own site) and this records it. Without one: the connected
 * supplier API places it — and until those integrations go live, that path
 * fails with instructions rather than pretending.
 */
purchasingRouter.post(
  '/orders/:id/place',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = z.object({ reference: z.string().max(120).nullish() }).parse(req.body ?? {});
      const { supabase, orgId, userId } = await requireOrgContext(req);
      const po = await loadOrder(supabase, req.params.id);
      if (po.status !== 'approved') {
        throw new HttpError(
          409,
          'An order is placed only after it is approved.',
          'not_approved',
        );
      }

      let externalRef = body.reference?.trim() || null;
      let how = 'recorded — ordered outside Atmosphere';

      if (!externalRef && po.supplier !== 'manual') {
        const supplier = po.supplier as SupplierId;
        const credential = await loadSupplierConnection(orgId, supplier);
        if (!credential) {
          throw new HttpError(
            409,
            `${ADAPTERS[supplier].label} is not connected. Connect it in Purchase orders → Suppliers, or place the order there yourself and record the order number here.`,
            'supplier_not_connected',
          );
        }
        const { data: lineRows } = await supabase
          .from('purchase_order_lines')
          .select(LINE_SELECT)
          .eq('po_id', po.id)
          .order('position');
        try {
          const placed = await ADAPTERS[supplier].place(credential, {
            poId: po.id,
            note: po.note,
            lines: (lineRows ?? []).map((l: any) => ({
              description: l.description,
              detail: l.detail,
              quantity: Number(l.quantity),
              unit: l.unit,
            })),
          });
          externalRef = placed.externalRef;
          how = `placed through ${ADAPTERS[supplier].label}`;
        } catch (err) {
          if (err instanceof SupplierError) throw new HttpError(502, err.message, 'supplier_failed');
          throw err;
        }
      }

      const { data, error } = await supabase
        .from('purchase_orders')
        .update({ status: 'placed', placed_at: new Date().toISOString(), external_ref: externalRef })
        .eq('id', po.id)
        .select(PO_SELECT)
        .single();
      if (error) throw new HttpError(400, error.message, 'place_failed');

      await writeEvent(supabase, {
        poId: po.id,
        orgId,
        actor: userId,
        action: 'placed',
        detail: externalRef ? `${how}, ref ${externalRef}` : how,
      });
      res.json({ order: serializeOrder(data) });
    } catch (err) {
      next(err);
    }
  },
);

/** POST /api/purchasing/orders/:id/cancel */
purchasingRouter.post(
  '/orders/:id/cancel',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { supabase, orgId, userId } = await requireOrgContext(req);
      const po = await loadOrder(supabase, req.params.id);
      if (po.status === 'placed') {
        throw new HttpError(
          409,
          'A placed order is a record of money spent — cancel it with the store, then note the outcome on the job.',
          'already_placed',
        );
      }
      if (po.status === 'cancelled') {
        throw new HttpError(409, 'Already cancelled.', 'already_cancelled');
      }
      const { data, error } = await supabase
        .from('purchase_orders')
        .update({ status: 'cancelled' })
        .eq('id', po.id)
        .select(PO_SELECT)
        .single();
      if (error) throw new HttpError(400, error.message, 'cancel_failed');
      await writeEvent(supabase, { poId: po.id, orgId, actor: userId, action: 'cancelled' });
      res.json({ order: serializeOrder(data) });
    } catch (err) {
      next(err);
    }
  },
);

/* ------------------------------------------------------------------ *
 * Suppliers
 * ------------------------------------------------------------------ */

/** GET /api/purchasing/suppliers — connection status, labels only. */
purchasingRouter.get('/suppliers', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId } = await requireOrgContext(req);
    let connections: Awaited<ReturnType<typeof listSupplierConnections>> = [];
    try {
      connections = await listSupplierConnections(orgId);
    } catch {
      // No service role in this environment — every store simply reads as
      // not connected, which is true from where the user stands.
    }
    const byId = new Map(connections.map((c) => [c.supplier, c]));
    res.json({
      suppliers: SUPPLIERS.map((s) => ({
        id: s.id,
        label: s.label,
        connected: byId.has(s.id),
        accountLabel: byId.get(s.id)?.accountLabel ?? null,
        connectedAt: byId.get(s.id)?.connectedAt ?? null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/purchasing/suppliers/:id/connect
 *
 * The fields are an opaque bag on purpose: each store's API will demand its
 * own set, and the vault seals whatever arrives. Connecting also creates the
 * vendor account, so the store exists in the books from day one.
 */
purchasingRouter.post(
  '/suppliers/:id/connect',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const supplier = z.enum(['home_depot', 'lowes']).parse(req.params.id);
      const body = z
        .object({
          fields: z.record(z.string(), z.string().max(2000)).refine((f) => Object.keys(f).length > 0, {
            message: 'At least one credential field is required.',
          }),
          accountLabel: z.string().max(120).nullish(),
        })
        .parse(req.body);
      const { supabase, orgId, userId } = await requireOrgContext(req);

      await saveSupplierConnection({
        orgId,
        userId,
        supplier,
        fields: body.fields,
        accountLabel: body.accountLabel ?? null,
      });
      await ensureVendorAccount(supabase, orgId, userId, supplier);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

/** DELETE /api/purchasing/suppliers/:id — disconnect. */
purchasingRouter.delete(
  '/suppliers/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const supplier = z.enum(['home_depot', 'lowes']).parse(req.params.id);
      const { orgId } = await requireOrgContext(req);
      await deleteSupplierConnection(orgId, supplier);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);
