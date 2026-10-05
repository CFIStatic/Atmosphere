-- Rate card: Claude Opus/Sonnet 5.5 and Gemini 3.8 / 3.1 Pro (verified 2026-10-05).
-- Mirrors backend/src/metering/modelPriceTable.ts. Do not edit the 2026-10-02 card.

insert into private.model_costs (
  model_id, display_name, family, provider,
  input_cost_per_mtok, output_cost_per_mtok,
  cache_write_5m_multiplier, cache_write_1h_multiplier, cache_read_multiplier,
  context_window, max_output_tokens, sort_order, price_source_url, price_verified_at
) values
  ('claude-opus-5-5',         'Atmosphere Pro 5.5',     'pro',    'anthropic',  4.000000, 20.000000, 1.25, 2.0, 0.1, 1000000, 128000, 15, 'https://platform.claude.com/docs/en/about-claude/pricing', '2026-10-05'),
  ('claude-sonnet-5-5',       'Atmosphere Core 5.5',    'core',   'anthropic',  2.000000, 10.000000, 1.25, 2.0, 0.1, 1000000, 128000, 35, 'https://platform.claude.com/docs/en/about-claude/pricing', '2026-10-05'),
  ('claude-fable-5-1',        'Atmosphere Apex 5.1',    'apex',   'anthropic', 10.000000, 50.000000, 1.25, 2.0, 0.1, 1000000, 128000, 5,  'https://platform.claude.com/docs/en/about-claude/pricing', '2026-10-05'),
  ('gemini-3.8-flash',        'Gemini 3.8 Flash',       'gemini', 'google',     0.750000,  3.750000, 0,    0,   0.1, 1048576,  65536, 69, 'https://ai.google.dev/gemini-api/docs/pricing', '2026-10-05'),
  ('gemini-3.1-pro-preview',  'Gemini 3.1 Pro Preview', 'gemini', 'google',     2.000000, 12.000000, 0,    0,   0.1, 1048576,  65536, 68, 'https://ai.google.dev/gemini-api/docs/pricing', '2026-10-05')
on conflict (model_id) do update set
  display_name              = excluded.display_name,
  family                    = excluded.family,
  provider                  = excluded.provider,
  input_cost_per_mtok       = excluded.input_cost_per_mtok,
  output_cost_per_mtok      = excluded.output_cost_per_mtok,
  cache_write_5m_multiplier = excluded.cache_write_5m_multiplier,
  cache_write_1h_multiplier = excluded.cache_write_1h_multiplier,
  cache_read_multiplier     = excluded.cache_read_multiplier,
  context_window            = excluded.context_window,
  max_output_tokens         = excluded.max_output_tokens,
  sort_order                = excluded.sort_order,
  price_source_url          = excluded.price_source_url,
  price_verified_at         = excluded.price_verified_at,
  is_active                 = true;
