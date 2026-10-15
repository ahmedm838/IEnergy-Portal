-- =====================================================================
-- Add the super_admin role.
--
-- On its own, deliberately: PostgreSQL will not let a new enum value be
-- USED in the same transaction that adds it, and supabase db push runs
-- each migration in its own transaction. Everything that references
-- super_admin lives in the next migration.
-- =====================================================================

alter type app_role add value if not exists 'super_admin';
