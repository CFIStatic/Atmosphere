# Atmosphere Chat + Computer: materials list and Home Depot order

Approved 6:40 PM CT on Oct 5, 2026.

## What it does

1. **Materials extraction** — Chat builds a structured list (item, spec/color, quantity, unit, source citation) from transcripts, video analysis, and scope/estimate documents. Quantities missing from evidence are marked **unknown** (never guessed).
2. **Order command** — “Order the materials for this job from Home Depot” routes to Computer, which signs in with the company’s saved Logins when present. Passwords never reach the model; two-step and card checks stay with the person.
3. **Product matching** — Public Home Depot search (then live-site verify) records product name, SKU/URL, price, and confidence. Low-confidence matches are flagged on the Approve card.
4. **Fulfillment** — Delivery vs pickup using the job address; stock checked on the live site.
5. **Approve card** — Items, quantities, matched products with links, prices, total, out-of-stock/substitutions, delivery address/date. Checkout only after Approve, using the card already on the Home Depot account. Audit + `order_key_hash` idempotency (same pattern as send-fingerprint from PR #659) block double Place Order.
6. **Playbooks** — Reuses cross-company, PII-scrubbed site playbooks (PR #662). Home Depot seed steps live in `backend/src/computer/homeDepotPlaybook.ts`.

Lowe’s, ABC Supply, and SRS share the same design; Home Depot ships first.

## Safety

- Never purchase without Approve.
- Never handle raw card numbers.
- Never commit secrets or clip content.
- Customer UI never shows AI dollar amounts (cart prices come from the retailer listing).
- Migration `20261005220000_computer_supply_orders.sql` is in the PR only — do not apply to prod from this change set without explicit approval.

## Testing

- Demo account `appreview@` and Sample Job `058b09a8` only.
- End-to-end stops at the Approve card with a filled cart — do not place a real order.
- If no Home Depot Login is saved, exercise extraction, public matching, and the Approve card shape; report that a test Login is needed for live checkout.
