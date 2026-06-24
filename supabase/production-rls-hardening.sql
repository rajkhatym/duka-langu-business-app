-- Production RLS hardening for Godown Stock App.
-- Run LAST after:
-- 1) schema.sql
-- 2) branches-two-locations.sql
-- 3) operations-roles-audit-closing.sql
-- 4) advanced-business-modules.sql
-- 5) equipment-sales-modules.sql
--
-- Role model:
-- Owner/Admin: all branches, all business data.
-- Manager: own branch business data, stock, finance, reports, approvals.
-- Cashier/Staff: own branch products + own sales only. No profit/expense/purchase/debt management.

begin;

-- ---------------------------------------------------------------------
-- Roles and helpers
-- ---------------------------------------------------------------------
alter table public.profiles
  add column if not exists branch_id text references public.branches (id);

alter table public.products
  add column if not exists cost_price numeric;

alter table public.sales
  add column if not exists payment_method text default 'cash'
  check (payment_method in ('cash', 'mpesa', 'bank', 'credit'));

alter table public.sales
  add column if not exists client_sale_id text;

alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('owner', 'manager', 'cashier', 'admin', 'staff'));

update public.profiles set role = 'owner' where role = 'admin';
update public.profiles set role = 'cashier' where role = 'staff';

create or replace function public.current_user_role()
returns text
language sql
security definer
stable
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_owner()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(public.current_user_role() in ('owner', 'admin'), false);
$$;

create or replace function public.is_manager()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(public.current_user_role() in ('manager', 'owner', 'admin'), false);
$$;

create or replace function public.is_cashier()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(public.current_user_role() in ('cashier', 'staff'), false);
$$;

create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.is_manager();
$$;

create or replace function public.user_branch_id()
returns text
language sql
security definer
stable
set search_path = public
as $$
  select branch_id from public.profiles where id = auth.uid();
$$;

create or replace function public.can_access_branch(p_branch_id text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.is_owner()
    or (p_branch_id is not null and p_branch_id = public.user_branch_id());
$$;

create or replace function public.can_manage_branch(p_branch_id text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.is_owner()
    or (
      public.current_user_role() = 'manager'
      and p_branch_id is not null
      and p_branch_id = public.user_branch_id()
    );
$$;

create or replace function public.can_sell_branch(p_branch_id text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.is_owner()
    or (
      public.current_user_role() in ('manager', 'cashier', 'staff')
      and p_branch_id is not null
      and p_branch_id = public.user_branch_id()
    );
$$;

create or replace function public.protect_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.role <> old.role or new.branch_id is distinct from old.branch_id) and not public.is_owner() then
    new.role := old.role;
    new.branch_id := old.branch_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_profile_role on public.profiles;
create trigger trg_protect_profile_role
before update on public.profiles
for each row execute function public.protect_profile_role();

-- ---------------------------------------------------------------------
-- RLS on all business tables
-- ---------------------------------------------------------------------
alter table public.branches enable row level security;
alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.stock_movements enable row level security;
alter table public.sales enable row level security;
alter table public.expenses enable row level security;
alter table public.debts enable row level security;
alter table public.stock_transfers enable row level security;
alter table public.daily_closings enable row level security;
alter table public.audit_logs enable row level security;
alter table public.purchases enable row level security;
alter table public.cash_shifts enable row level security;
alter table public.stock_adjustment_requests enable row level security;
alter table public.stock_counts enable row level security;
alter table public.quotations enable row level security;
alter table public.quotation_items enable row level security;
alter table public.layaways enable row level security;
alter table public.layaway_payments enable row level security;
alter table public.product_bundles enable row level security;
alter table public.product_bundle_items enable row level security;
alter table public.warranty_claims enable row level security;

-- Remove old/dev policy names.
drop policy if exists "products_select_public_dev" on public.products;
drop policy if exists "products_insert_public_dev" on public.products;
drop policy if exists "products_update_public_dev" on public.products;
drop policy if exists "profiles_select_all" on public.profiles;
drop policy if exists "profiles_update_self_or_admin" on public.profiles;
drop policy if exists "products_select" on public.products;
drop policy if exists "products_insert" on public.products;
drop policy if exists "products_update" on public.products;
drop policy if exists "products_delete_admin" on public.products;
drop policy if exists "stock_movements_select" on public.stock_movements;
drop policy if exists "stock_movements_insert" on public.stock_movements;
drop policy if exists "stock_movements_delete_admin" on public.stock_movements;
drop policy if exists "sales_select" on public.sales;
drop policy if exists "sales_insert" on public.sales;
drop policy if exists "sales_delete_admin" on public.sales;
drop policy if exists "expenses_select" on public.expenses;
drop policy if exists "expenses_insert" on public.expenses;
drop policy if exists "expenses_delete_admin" on public.expenses;
drop policy if exists "debts_select" on public.debts;
drop policy if exists "debts_insert" on public.debts;
drop policy if exists "debts_update" on public.debts;
drop policy if exists "debts_delete_admin" on public.debts;
drop policy if exists "stock_transfers_select" on public.stock_transfers;
drop policy if exists "stock_transfers_insert_manager" on public.stock_transfers;
drop policy if exists "daily_closings_select" on public.daily_closings;
drop policy if exists "daily_closings_insert_manager" on public.daily_closings;
drop policy if exists "daily_closings_update_manager" on public.daily_closings;
drop policy if exists "audit_logs_owner_select" on public.audit_logs;
drop policy if exists "purchases_select" on public.purchases;
drop policy if exists "purchases_insert" on public.purchases;
drop policy if exists "purchases_update" on public.purchases;
drop policy if exists "cash_shifts_select" on public.cash_shifts;
drop policy if exists "cash_shifts_insert" on public.cash_shifts;
drop policy if exists "cash_shifts_update" on public.cash_shifts;
drop policy if exists "stock_adjustment_requests_select" on public.stock_adjustment_requests;
drop policy if exists "stock_adjustment_requests_insert" on public.stock_adjustment_requests;
drop policy if exists "stock_adjustment_requests_update" on public.stock_adjustment_requests;
drop policy if exists "stock_counts_select" on public.stock_counts;
drop policy if exists "stock_counts_insert" on public.stock_counts;
drop policy if exists "quotations_manage_branch" on public.quotations;
drop policy if exists "quotation_items_manage_branch" on public.quotation_items;
drop policy if exists "layaways_manage_branch" on public.layaways;
drop policy if exists "layaway_payments_manage_branch" on public.layaway_payments;
drop policy if exists "product_bundles_manage_branch" on public.product_bundles;
drop policy if exists "product_bundle_items_manage_branch" on public.product_bundle_items;
drop policy if exists "warranty_claims_manage_branch" on public.warranty_claims;

-- Branches.
create policy "branches_select_accessible"
  on public.branches for select
  to authenticated
  using (public.is_owner() or id = public.user_branch_id());

create policy "branches_owner_insert"
  on public.branches for insert
  to authenticated
  with check (public.is_owner());

create policy "branches_owner_update"
  on public.branches for update
  to authenticated
  using (public.is_owner())
  with check (public.is_owner());

create policy "branches_owner_delete"
  on public.branches for delete
  to authenticated
  using (public.is_owner());

-- Profiles.
create policy "profiles_select_role_scoped"
  on public.profiles for select
  to authenticated
  using (public.is_owner() or id = auth.uid() or branch_id = public.user_branch_id());

create policy "profiles_insert_self"
  on public.profiles for insert
  to authenticated
  with check (id = auth.uid());

create policy "profiles_update_self_or_owner"
  on public.profiles for update
  to authenticated
  using (public.is_owner() or id = auth.uid())
  with check (public.is_owner() or id = auth.uid());

-- Products: everyone in branch can read stock; only Owner/Manager can change stock/product master data.
create policy "products_select_branch"
  on public.products for select
  to authenticated
  using (public.can_access_branch(branch_id));

create policy "products_insert_manager"
  on public.products for insert
  to authenticated
  with check (public.can_manage_branch(branch_id));

create policy "products_update_manager"
  on public.products for update
  to authenticated
  using (public.can_manage_branch(branch_id))
  with check (public.can_manage_branch(branch_id));

create policy "products_delete_manager"
  on public.products for delete
  to authenticated
  using (public.can_manage_branch(branch_id));

-- Sales: cashier can insert and see only own sales; manager sees branch; owner sees all.
create policy "sales_select_role_scoped"
  on public.sales for select
  to authenticated
  using (
    public.is_owner()
    or public.can_manage_branch(branch_id)
    or (public.can_access_branch(branch_id) and created_by = auth.uid())
  );

create policy "sales_insert_cashier_or_manager"
  on public.sales for insert
  to authenticated
  with check (
    public.can_sell_branch(branch_id)
    and created_by = auth.uid()
  );

create policy "sales_delete_manager"
  on public.sales for delete
  to authenticated
  using (public.can_manage_branch(branch_id));

-- Stock movements and transfers: Owner/Manager only.
create policy "stock_movements_select_manager"
  on public.stock_movements for select
  to authenticated
  using (public.can_manage_branch(branch_id));

create policy "stock_movements_insert_manager"
  on public.stock_movements for insert
  to authenticated
  with check (public.can_manage_branch(branch_id));

create policy "stock_movements_delete_manager"
  on public.stock_movements for delete
  to authenticated
  using (public.can_manage_branch(branch_id));

create policy "stock_transfers_select_branch_manager"
  on public.stock_transfers for select
  to authenticated
  using (public.can_manage_branch(from_branch_id) or public.can_manage_branch(to_branch_id));

create policy "stock_transfers_insert_manager"
  on public.stock_transfers for insert
  to authenticated
  with check (public.can_manage_branch(from_branch_id));

-- Finance: Owner/Manager only.
create policy "expenses_select_manager"
  on public.expenses for select
  to authenticated
  using (public.can_manage_branch(branch_id));

create policy "expenses_insert_manager"
  on public.expenses for insert
  to authenticated
  with check (public.can_manage_branch(branch_id));

create policy "expenses_delete_manager"
  on public.expenses for delete
  to authenticated
  using (public.can_manage_branch(branch_id));

create policy "debts_select_manager"
  on public.debts for select
  to authenticated
  using (public.can_manage_branch(branch_id));

create policy "debts_insert_manager"
  on public.debts for insert
  to authenticated
  with check (public.can_manage_branch(branch_id));

create policy "debts_update_manager"
  on public.debts for update
  to authenticated
  using (public.can_manage_branch(branch_id))
  with check (public.can_manage_branch(branch_id));

create policy "debts_delete_manager"
  on public.debts for delete
  to authenticated
  using (public.can_manage_branch(branch_id));

create policy "purchases_select_manager"
  on public.purchases for select
  to authenticated
  using (public.can_manage_branch(branch_id));

create policy "purchases_insert_manager"
  on public.purchases for insert
  to authenticated
  with check (public.can_manage_branch(branch_id));

create policy "purchases_update_manager"
  on public.purchases for update
  to authenticated
  using (public.can_manage_branch(branch_id))
  with check (public.can_manage_branch(branch_id));

create policy "daily_closings_select_manager"
  on public.daily_closings for select
  to authenticated
  using (public.can_manage_branch(branch_id));

create policy "daily_closings_insert_manager"
  on public.daily_closings for insert
  to authenticated
  with check (public.can_manage_branch(branch_id));

create policy "daily_closings_update_manager"
  on public.daily_closings for update
  to authenticated
  using (public.can_manage_branch(branch_id))
  with check (public.can_manage_branch(branch_id));

-- Optional cash shifts remain secured even if hidden in UI.
create policy "cash_shifts_select_scoped"
  on public.cash_shifts for select
  to authenticated
  using (public.can_manage_branch(branch_id) or cashier_id = auth.uid());

create policy "cash_shifts_insert_self"
  on public.cash_shifts for insert
  to authenticated
  with check (public.can_sell_branch(branch_id) and cashier_id = auth.uid());

create policy "cash_shifts_update_scoped"
  on public.cash_shifts for update
  to authenticated
  using (public.can_manage_branch(branch_id) or cashier_id = auth.uid())
  with check (public.can_manage_branch(branch_id) or cashier_id = auth.uid());

-- Approvals/counts.
create policy "stock_adjustment_requests_select_scoped"
  on public.stock_adjustment_requests for select
  to authenticated
  using (public.can_manage_branch(branch_id) or requested_by = auth.uid());

create policy "stock_adjustment_requests_insert_branch"
  on public.stock_adjustment_requests for insert
  to authenticated
  with check (public.can_access_branch(branch_id) and requested_by = auth.uid());

create policy "stock_adjustment_requests_update_owner"
  on public.stock_adjustment_requests for update
  to authenticated
  using (public.is_owner())
  with check (public.is_owner());

create policy "stock_counts_select_manager"
  on public.stock_counts for select
  to authenticated
  using (public.can_manage_branch(branch_id));

create policy "stock_counts_insert_manager"
  on public.stock_counts for insert
  to authenticated
  with check (public.can_manage_branch(branch_id));

-- Documents and layaways: Owner/Manager only because they expose customer balances/pricing.
create policy "quotations_manage_manager"
  on public.quotations for all
  to authenticated
  using (public.can_manage_branch(branch_id))
  with check (public.can_manage_branch(branch_id));

create policy "quotation_items_manage_manager"
  on public.quotation_items for all
  to authenticated
  using (
    exists (
      select 1 from public.quotations q
      where q.id = quotation_id and public.can_manage_branch(q.branch_id)
    )
  )
  with check (
    exists (
      select 1 from public.quotations q
      where q.id = quotation_id and public.can_manage_branch(q.branch_id)
    )
  );

create policy "layaways_manage_manager"
  on public.layaways for all
  to authenticated
  using (public.can_manage_branch(branch_id))
  with check (public.can_manage_branch(branch_id));

create policy "layaway_payments_manage_manager"
  on public.layaway_payments for all
  to authenticated
  using (
    exists (
      select 1 from public.layaways l
      where l.id = layaway_id and public.can_manage_branch(l.branch_id)
    )
  )
  with check (
    exists (
      select 1 from public.layaways l
      where l.id = layaway_id and public.can_manage_branch(l.branch_id)
    )
  );

create policy "product_bundles_manage_manager"
  on public.product_bundles for all
  to authenticated
  using (public.can_manage_branch(branch_id))
  with check (public.can_manage_branch(branch_id));

create policy "product_bundle_items_manage_manager"
  on public.product_bundle_items for all
  to authenticated
  using (
    exists (
      select 1 from public.product_bundles b
      where b.id = bundle_id and public.can_manage_branch(b.branch_id)
    )
  )
  with check (
    exists (
      select 1 from public.product_bundles b
      where b.id = bundle_id and public.can_manage_branch(b.branch_id)
    )
  );

create policy "warranty_claims_manage_manager"
  on public.warranty_claims for all
  to authenticated
  using (public.can_manage_branch(branch_id))
  with check (public.can_manage_branch(branch_id));

-- Audit log: Owner only.
create policy "audit_logs_owner_select"
  on public.audit_logs for select
  to authenticated
  using (public.is_owner());

-- ---------------------------------------------------------------------
-- Performance indexes for RLS filters
-- ---------------------------------------------------------------------
create index if not exists profiles_branch_id_idx on public.profiles (branch_id);
create index if not exists profiles_role_idx on public.profiles (role);
create index if not exists products_branch_id_idx on public.products (branch_id);
create index if not exists stock_movements_branch_id_idx on public.stock_movements (branch_id);
create index if not exists stock_movements_created_at_idx on public.stock_movements (created_at desc);
create index if not exists sales_branch_id_idx on public.sales (branch_id);
create unique index if not exists sales_client_sale_id_key
  on public.sales (client_sale_id);
create index if not exists sales_created_by_idx on public.sales (created_by);
create index if not exists sales_created_at_idx on public.sales (created_at desc);
create index if not exists expenses_branch_id_idx on public.expenses (branch_id);
create index if not exists debts_branch_id_idx on public.debts (branch_id);
create index if not exists purchases_branch_id_idx on public.purchases (branch_id);
create index if not exists quotations_branch_id_idx on public.quotations (branch_id);
create index if not exists layaways_branch_id_idx on public.layaways (branch_id);
create index if not exists product_bundles_branch_id_idx on public.product_bundles (branch_id);
create index if not exists warranty_claims_branch_id_idx on public.warranty_claims (branch_id);
create index if not exists audit_logs_created_at_idx on public.audit_logs (created_at desc);
create index if not exists audit_logs_branch_id_idx on public.audit_logs (branch_id);

-- Grants: RLS still decides which rows each user can touch.
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;

-- Do not expose trigger/internal functions as RPC.
revoke execute on function public.adjust_product_quantity(uuid, numeric) from public, anon, authenticated;
revoke execute on function public.apply_stock_movement() from public, anon, authenticated;
revoke execute on function public.reverse_stock_movement() from public, anon, authenticated;
revoke execute on function public.write_audit_log() from public, anon, authenticated;
revoke execute on function public.protect_profile_role() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

grant execute on function public.current_user_role() to authenticated;
grant execute on function public.is_owner() to authenticated;
grant execute on function public.is_manager() to authenticated;
grant execute on function public.is_cashier() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.user_branch_id() to authenticated;
grant execute on function public.can_access_branch(text) to authenticated;
grant execute on function public.can_manage_branch(text) to authenticated;
grant execute on function public.can_sell_branch(text) to authenticated;

commit;
