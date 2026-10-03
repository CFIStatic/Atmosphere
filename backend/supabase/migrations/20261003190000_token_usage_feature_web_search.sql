-- ============================================================================
-- Web search gets its own metering line.
-- ============================================================================
-- Tavily credits and Gemini grounded-search tokens were recorded with feature
-- 'web_search', which classify_token_feature folded into 'other'; Settings ›
-- Billing showed the only search as "Other $0.08". This adds the enum value.
--
-- Kept alone in its own migration: Postgres does not allow a new enum value
-- to be used in the transaction that adds it. 20261003190100 uses it.
-- ============================================================================

alter type public.token_usage_feature add value if not exists 'web_search' before 'other';
