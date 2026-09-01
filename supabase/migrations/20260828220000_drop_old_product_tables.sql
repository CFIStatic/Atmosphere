-- Drop leftover multi-product tables (CRM/sales/finance/estimator/web-access/…).
-- Applied migrations stay in git. Railway does not migrate on boot — deploy
-- runs backend/scripts/applyOldProductTables.mjs.
--
-- KEEP (live Work Verification / Field Capture / Verifier / Stripe / portal):
--   crm_jobs, crm_properties, crm_counters
--   job_*, field_*, verification_*, work_episodes / episode_*, media_*, geometry_*
--   legal_*, homeowner_portal_*, org_*, profiles, device_credentials
--   pm_projects / tasks / drying / equipment / documents / updates / automation
--   pm_communications / pm_approvals / pm_threads
--   estimator_jobs, zip_centroids
--   org_billing, billing_plans, credit_*, payments, stripe_*, metering_*, usage_*
--   network_erasures, experiments_*, analytics_*, memory_*, crew_locations
--
-- CASCADE only removes FKs/views that pointed at dropped tables. Live columns
-- such as crm_jobs.account_id stay as unconstrained uuids.

drop view if exists public.crm_account_tree cascade;
drop view if exists public.crm_account_rollup cascade;
drop view if exists public.crm_campaign_audience cascade;
drop view if exists public.crm_outreach_people cascade;

-- Sales / campaigns / prospecting
drop table if exists public.sales_events cascade;
drop table if exists public.sales_meetings cascade;
drop table if exists public.sales_outreach cascade;
drop table if exists public.sales_contacts cascade;
drop table if exists public.sales_businesses cascade;
drop table if exists public.sales_campaigns cascade;
drop table if exists public.sales_people_searches cascade;

drop table if exists public.crm_sends cascade;
drop table if exists public.crm_send_policy cascade;
drop table if exists public.crm_unsubscribes cascade;
drop table if exists public.crm_campaign_fires cascade;
drop table if exists public.crm_campaign_members cascade;
drop table if exists public.crm_campaigns cascade;
drop table if exists public.crm_places cascade;
drop table if exists public.crm_territories cascade;
drop table if exists public.crm_prospects cascade;
drop table if exists public.crm_suppressions cascade;
drop table if exists public.feature_prices cascade;

-- CRM product (not the job file)
drop table if exists public.crm_account_merges cascade;
drop table if exists public.crm_account_links cascade;
drop table if exists public.crm_contact_roles cascade;
drop table if exists public.crm_job_links cascade;
drop table if exists public.crm_sync_connections cascade;
drop table if exists public.crm_oauth_grants cascade;
drop table if exists public.crm_push_runs cascade;
drop table if exists public.crm_sync_runs cascade;
drop table if exists public.crm_external_records cascade;
drop table if exists public.crm_external_sources cascade;
drop table if exists public.crm_audit_log cascade;
drop table if exists public.crm_activities cascade;
drop table if exists public.crm_leads cascade;
drop table if exists public.crm_contacts cascade;
drop table if exists public.crm_accounts cascade;

-- Kept tables (crm_jobs, crm_properties) still had audit triggers that write
-- into crm_audit_log. After the drop above, soft-deleting a job file fails
-- with "relation public.crm_audit_log does not exist". Remove the orphans.
drop trigger if exists crm_jobs_audit on public.crm_jobs;
drop trigger if exists crm_properties_audit on public.crm_properties;
drop trigger if exists crm_accounts_audit on public.crm_accounts;
drop trigger if exists crm_contacts_audit on public.crm_contacts;
drop trigger if exists crm_leads_audit on public.crm_leads;
drop trigger if exists crm_activities_audit on public.crm_activities;
drop function if exists private.crm_audit();

-- Finance
drop table if exists public.finance_share_links cascade;
drop table if exists public.finance_share_documents cascade;
drop table if exists public.finance_share_packages cascade;
drop table if exists public.finance_briefs cascade;
drop table if exists public.finance_alerts cascade;
drop table if exists public.finance_job_costs cascade;
drop table if exists public.finance_cost_codes cascade;
drop table if exists public.finance_accounts cascade;
drop table if exists public.finance_connections cascade;
drop table if exists public.finance_automation_settings cascade;

-- Estimator / mitigation / carriers
drop table if exists public.purchase_order_events cascade;
drop table if exists public.purchase_order_lines cascade;
drop table if exists public.purchase_orders cascade;
drop table if exists public.supplier_connections cascade;
drop table if exists public.estimator_runs cascade;
drop table if exists public.estimator_credentials cascade;
drop table if exists public.estimator_estimates cascade;
drop table if exists public.estimator_settings cascade;
drop table if exists public.xactimate_audit cascade;
drop table if exists public.xactimate_price_lists cascade;
drop table if exists public.xactimate_connections cascade;
drop table if exists public.symbility_audit cascade;
drop table if exists public.symbility_connections cascade;
drop table if exists public.carrier_deviations cascade;
drop table if exists public.carrier_agreements cascade;

-- Email marketing
drop table if exists public.em_checkins cascade;
drop table if exists public.em_outreach_messages cascade;
drop table if exists public.em_outreach cascade;
drop table if exists public.em_storms cascade;
drop table if exists public.em_settings cascade;

-- Web Access / computer-use agent (not the video Verifier)
drop table if exists public.web_escalations cascade;
drop table if exists public.web_verifications cascade;
drop table if exists public.web_run_records cascade;
drop table if exists public.web_runs cascade;
drop table if exists public.web_credentials cascade;
drop table if exists public.web_connections cascade;
drop table if exists public.app_connectors cascade;

-- PM network / orchestration (HomeOwner Report keeps pm_projects and drying;
-- mention intake and network APIs still write communications / approvals / threads)
drop table if exists public.pm_procurement_bids cascade;
drop table if exists public.pm_procurement_requests cascade;
drop table if exists public.pm_vendor_referrals cascade;
drop table if exists public.pm_equipment_plan_items cascade;
drop table if exists public.pm_equipment_plans cascade;
drop table if exists public.pm_platform_events cascade;
drop table if exists public.pm_platform_links cascade;
drop table if exists public.pm_platform_connections cascade;
drop table if exists public.pm_thread_messages cascade;
drop table if exists public.pm_thread_participants cascade;
drop table if exists public.pm_partnerships cascade;
drop table if exists public.pm_partner_invites cascade;
drop table if exists public.pm_partner_profiles cascade;

-- Cyber / backups / unused contact network (keep network_erasures)
drop table if exists public.cyber_patches cascade;
drop table if exists public.cyber_ip_blocks cascade;
drop table if exists public.cyber_security_events cascade;
drop table if exists public.backup_verifications cascade;
drop table if exists public.backup_snapshot_items cascade;
drop table if exists public.backup_snapshots cascade;
drop table if exists public.network_contacts cascade;
drop table if exists public.network_contribution_settings cascade;
