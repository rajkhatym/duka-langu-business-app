-- Safe RLS verification audit for Godown Stock App.
-- Run after production-rls-hardening.sql. This does not modify data.

with expected_policies(table_name, policyname) as (
  values
    ('branches', 'branches_select_accessible'),
    ('profiles', 'profiles_select_role_scoped'),
    ('products', 'products_select_branch'),
    ('products', 'products_insert_manager'),
    ('products', 'products_update_manager'),
    ('products', 'products_delete_manager'),
    ('sales', 'sales_select_role_scoped'),
    ('sales', 'sales_insert_cashier_or_manager'),
    ('sales', 'sales_delete_manager'),
    ('stock_movements', 'stock_movements_select_manager'),
    ('stock_movements', 'stock_movements_insert_manager'),
    ('stock_transfers', 'stock_transfers_insert_manager'),
    ('expenses', 'expenses_select_manager'),
    ('expenses', 'expenses_insert_manager'),
    ('debts', 'debts_select_manager'),
    ('debts', 'debts_insert_manager'),
    ('purchases', 'purchases_select_manager'),
    ('purchases', 'purchases_insert_manager'),
    ('daily_closings', 'daily_closings_select_manager'),
    ('quotations', 'quotations_manage_manager'),
    ('layaways', 'layaways_manage_manager'),
    ('audit_logs', 'audit_logs_owner_select')
),
missing_policies as (
  select expected_policies.*
  from expected_policies
  left join pg_policies
    on pg_policies.schemaname = 'public'
   and pg_policies.tablename = expected_policies.table_name
   and pg_policies.policyname = expected_policies.policyname
  where pg_policies.policyname is null
),
dev_policies as (
  select tablename, policyname
  from pg_policies
  where schemaname = 'public'
    and policyname ilike '%dev%'
),
rls_disabled as (
  select relname as table_name
  from pg_class
  join pg_namespace on pg_namespace.oid = pg_class.relnamespace
  where pg_namespace.nspname = 'public'
    and relname in (
      'branches',
      'profiles',
      'products',
      'sales',
      'stock_movements',
      'stock_transfers',
      'expenses',
      'debts',
      'purchases',
      'daily_closings',
      'audit_logs',
      'quotations',
      'layaways',
      'warranty_claims'
    )
    and relrowsecurity is false
),
owner_profile as (
  select profiles.id, profiles.full_name, profiles.role, profiles.branch_id
  from public.profiles
  join auth.users on auth.users.id = profiles.id
  where auth.users.email = 'rajabsalum889@gmail.com'
)
select
  'missing_required_policies' as check_name,
  case when count(*) = 0 then 'PASS' else 'FAIL' end as status,
  coalesce(jsonb_agg(to_jsonb(missing_policies)), '[]'::jsonb) as details
from missing_policies

union all

select
  'dev_policies_removed' as check_name,
  case when count(*) = 0 then 'PASS' else 'FAIL' end as status,
  coalesce(jsonb_agg(to_jsonb(dev_policies)), '[]'::jsonb) as details
from dev_policies

union all

select
  'rls_enabled_on_business_tables' as check_name,
  case when count(*) = 0 then 'PASS' else 'FAIL' end as status,
  coalesce(jsonb_agg(to_jsonb(rls_disabled)), '[]'::jsonb) as details
from rls_disabled

union all

select
  'owner_profile_ready' as check_name,
  case when count(*) = 1 and bool_and(role in ('owner', 'admin')) then 'PASS' else 'FAIL' end as status,
  coalesce(jsonb_agg(to_jsonb(owner_profile)), '[]'::jsonb) as details
from owner_profile;
