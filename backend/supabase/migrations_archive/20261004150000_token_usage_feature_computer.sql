-- ============================================================================
-- token_usage_feature: add 'computer'
-- ============================================================================
-- Chat can run a browser task for an org ("Computer"). Its agent tokens and
-- its hosted-browser minutes land on their own billing line, so Settings ›
-- AI usage, Billing, the allowance and internal Analytics show Computer
-- spend apart from Chat. A new enum value must be committed before any
-- function can use it, so this file only adds the value; the classifier and
-- tables follow in 20261004150100_computer_tasks.sql.
--
-- Safe to re-run.
-- ============================================================================

alter type public.token_usage_feature add value if not exists 'computer' before 'other';
