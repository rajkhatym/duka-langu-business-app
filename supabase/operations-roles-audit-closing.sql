-- Adds role levels, stock transfers, daily closing, and audit log.
-- Run after branches-two-locations.sql.

alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('owner', 'manager', 'cashier', 'admin', 'staff'));

update public.profiles set role = 'owner' where role = 'admin';
update public.profiles set role = 'cashier' where role = 'staff';

create or replace function public.is_owner()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('owner', 'admin')
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('owner', 'manager', 'admin')
  );
$$;

create or replace function public.user_branch_id()
returns text
language sql
security definer
set search_path = public
as $$
  select branch_id from public.profiles where id = auth.uid();
$$;

create or replace function public.can_access_branch(p_branch_id text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select public.is_owner() or p_branch_id = public.user_branch_id();
$$;

create or replace function public.can_manage_branch(p_branch_id text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select public.is_owner() or exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role in ('manager', 'admin')
      and branch_id = p_branch_id
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

drop policy if exists "products_select_public_dev" on public.products;
drop policy if exists "products_insert_public_dev" on public.products;
drop policy if exists "products_update_public_dev" on public.products;

drop policy if exists "profiles_select_all" on public.profiles;
create policy "profiles_select_all"
  on public.profiles for select
  to authenticated
  using (public.is_owner() or id = auth.uid() or branch_id = public.user_branch_id());

drop policy if exists "profiles_update_self_or_admin" on public.profiles;
create policy "profiles_update_self_or_admin"
  on public.profiles for update
  to authenticated
  using (public.is_owner() or id = auth.uid())
  with check (public.is_owner() or id = auth.uid());

drop policy if exists "products_select" on public.products;
create policy "products_select"
  on public.products for select
  to authenticated
  using (public.can_access_branch(branch_id));

drop policy if exists "products_insert" on public.products;
create policy "products_insert"
  on public.products for insert
  to authenticated
  with check (public.can_manage_branch(branch_id));

drop policy if exists "products_update" on public.products;
create policy "products_update"
  on public.products for update
  to authenticated
  using (public.can_manage_branch(branch_id))
  with check (public.can_manage_branch(branch_id));

drop policy if exists "products_delete_admin" on public.products;
create policy "products_delete_admin"
  on public.products for delete
  to authenticated
  using (public.can_manage_branch(branch_id));

drop policy if exists "stock_movements_select" on public.stock_movements;
create policy "stock_movements_select"
  on public.stock_movements for select
  to authenticated
  using (public.can_access_branch(branch_id));

drop policy if exists "stock_movements_insert" on public.stock_movements;
create policy "stock_movements_insert"
  on public.stock_movements for insert
  to authenticated
  with check (public.can_manage_branch(branch_id));

drop policy if exists "stock_movements_delete_admin" on public.stock_movements;
create policy "stock_movements_delete_admin"
  on public.stock_movements for delete
  to authenticated
  using (public.can_manage_branch(branch_id));

drop policy if exists "sales_select" on public.sales;
create policy "sales_select"
  on public.sales for select
  to authenticated
  using (
    public.is_owner()
    or public.can_manage_branch(branch_id)
    or (public.can_access_branch(branch_id) and created_by = auth.uid())
  );

drop policy if exists "sales_insert" on public.sales;
create policy "sales_insert"
  on public.sales for insert
  to authenticated
  with check (public.can_access_branch(branch_id) and created_by = auth.uid());

drop policy if exists "sales_delete_admin" on public.sales;
create policy "sales_delete_admin"
  on public.sales for delete
  to authenticated
  using (public.can_manage_branch(branch_id));

drop policy if exists "expenses_select" on public.expenses;
create policy "expenses_select"
  on public.expenses for select
  to authenticated
  using (public.can_manage_branch(branch_id));

drop policy if exists "expenses_insert" on public.expenses;
create policy "expenses_insert"
  on public.expenses for insert
  to authenticated
  with check (public.can_manage_branch(branch_id));

drop policy if exists "expenses_delete_admin" on public.expenses;
create policy "expenses_delete_admin"
  on public.expenses for delete
  to authenticated
  using (public.can_manage_branch(branch_id));

drop policy if exists "debts_select" on public.debts;
create policy "debts_select"
  on public.debts for select
  to authenticated
  using (public.can_manage_branch(branch_id));

drop policy if exists "debts_insert" on public.debts;
create policy "debts_insert"
  on public.debts for insert
  to authenticated
  with check (public.can_manage_branch(branch_id));

drop policy if exists "debts_update" on public.debts;
create policy "debts_update"
  on public.debts for update
  to authenticated
  using (public.can_manage_branch(branch_id))
  with check (public.can_manage_branch(branch_id));

drop policy if exists "debts_delete_admin" on public.debts;
create policy "debts_delete_admin"
  on public.debts for delete
  to authenticated
  using (public.can_manage_branch(branch_id));

create table if not exists public.stock_transfers (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete restrict,
  from_branch_id text not null references public.branches (id),
  to_branch_id text not null references public.branches (id),
  quantity numeric not null check (quantity > 0),
  note text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  check (from_branch_id <> to_branch_id)
);

alter table public.stock_transfers enable row level security;

create index if not exists stock_transfers_created_at_idx on public.stock_transfers (created_at desc);
create index if not exists stock_transfers_from_branch_idx on public.stock_transfers (from_branch_id);
create index if not exists stock_transfers_to_branch_idx on public.stock_transfers (to_branch_id);

drop policy if exists "stock_transfers_select" on public.stock_transfers;
create policy "stock_transfers_select"
  on public.stock_transfers for select
  to authenticated
  using (
    public.can_access_branch(from_branch_id)
    or public.can_access_branch(to_branch_id)
  );

drop policy if exists "stock_transfers_insert_manager" on public.stock_transfers;
create policy "stock_transfers_insert_manager"
  on public.stock_transfers for insert
  to authenticated
  with check (public.can_manage_branch(from_branch_id));

create table if not exists public.daily_closings (
  id uuid primary key default gen_random_uuid(),
  branch_id text not null references public.branches (id),
  closing_date date not null,
  expected_cash numeric not null default 0,
  actual_cash numeric not null default 0,
  difference numeric generated always as (actual_cash - expected_cash) stored,
  note text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  unique (branch_id, closing_date)
);

alter table public.daily_closings enable row level security;

drop policy if exists "daily_closings_select" on public.daily_closings;
create policy "daily_closings_select"
  on public.daily_closings for select
  to authenticated
  using (
    public.can_manage_branch(branch_id)
  );

drop policy if exists "daily_closings_insert_manager" on public.daily_closings;
create policy "daily_closings_insert_manager"
  on public.daily_closings for insert
  to authenticated
  with check (public.can_manage_branch(branch_id));

drop policy if exists "daily_closings_update_manager" on public.daily_closings;
create policy "daily_closings_update_manager"
  on public.daily_closings for update
  to authenticated
  using (public.can_manage_branch(branch_id))
  with check (public.can_manage_branch(branch_id));

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users (id),
  branch_id text references public.branches (id),
  table_name text not null,
  action text not null,
  record_id text,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

alter table public.audit_logs enable row level security;

drop policy if exists "audit_logs_owner_select" on public.audit_logs;
create policy "audit_logs_owner_select"
  on public.audit_logs for select
  to authenticated
  using (public.is_owner());

create or replace function public.write_audit_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch_id text;
  v_old_data jsonb;
  v_new_data jsonb;
begin
  if tg_op = 'INSERT' then
    v_new_data := to_jsonb(new);
  elsif tg_op = 'UPDATE' then
    v_old_data := to_jsonb(old);
    v_new_data := to_jsonb(new);
  else
    v_old_data := to_jsonb(old);
  end if;

  v_branch_id := coalesce(v_new_data ->> 'branch_id', v_old_data ->> 'branch_id');

  insert into public.audit_logs (
    actor_id, branch_id, table_name, action, record_id, old_data, new_data
  ) values (
    auth.uid(),
    v_branch_id,
    tg_table_name,
    tg_op,
    coalesce(v_new_data ->> 'id', v_old_data ->> 'id'),
    v_old_data,
    v_new_data
  );

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_audit_products on public.products;
create trigger trg_audit_products
after insert or update or delete on public.products
for each row execute function public.write_audit_log();

drop trigger if exists trg_audit_stock_movements on public.stock_movements;
create trigger trg_audit_stock_movements
after insert or update or delete on public.stock_movements
for each row execute function public.write_audit_log();

drop trigger if exists trg_audit_sales on public.sales;
create trigger trg_audit_sales
after insert or update or delete on public.sales
for each row execute function public.write_audit_log();

drop trigger if exists trg_audit_expenses on public.expenses;
create trigger trg_audit_expenses
after insert or update or delete on public.expenses
for each row execute function public.write_audit_log();

drop trigger if exists trg_audit_debts on public.debts;
create trigger trg_audit_debts
after insert or update or delete on public.debts
for each row execute function public.write_audit_log();
