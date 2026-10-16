-- Rate card: cache-read prices for Claude Opus 5.5 and Claude Fable 5.1 (verified 2026-10-14).
-- Opus 5.5 cache reads are $0.20 / MTok (0.05x input), Fable 5.1 $0.25 / MTok
-- (0.025x input); the 2026-10-05 card had both at 0.1x. Every other price is
-- unchanged. Mirrors backend/src/metering/modelPriceTable.ts.

update private.model_costs
set cache_read_multiplier = v.cache_read_multiplier::numeric,
    price_verified_at     = v.price_verified_at::date
from (values
  ('claude-opus-5-5',  'Atmosphere Pro 5.5',  'pro',  'anthropic',  4.000000, 20.000000, 1.25, 2.0, 0.05,  1000000, 128000, 15, 'https://platform.claude.com/docs/en/about-claude/pricing', '2026-10-14'),
  ('claude-fable-5-1', 'Atmosphere Apex 5.1', 'apex', 'anthropic', 10.000000, 50.000000, 1.25, 2.0, 0.025, 1000000, 128000, 5,  'https://platform.claude.com/docs/en/about-claude/pricing', '2026-10-14')
) as v(model_id, display_name, family, provider, input_cost_per_mtok, output_cost_per_mtok,
       cache_write_5m_multiplier, cache_write_1h_multiplier, cache_read_multiplier,
       context_window, max_output_tokens, sort_order, price_source_url, price_verified_at)
where private.model_costs.model_id = v.model_id;
