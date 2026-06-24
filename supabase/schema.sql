-- =====================================================================
-- Godown Stock Taking App - Supabase schema
-- Run this whole file once in Supabase Dashboard -> SQL Editor -> New query
-- =====================================================================

-- ---------------------------------------------------------------------
-- PROFILES (one row per auth user; role drives admin/staff permissions)
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  role text not null default 'cashier' check (role in ('owner', 'manager', 'cashier', 'admin', 'staff')),
  branch_id text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Returns true if the currently logged-in user is an admin.
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role in ('owner', 'manager', 'admin')
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
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and (
        role in ('owner', 'admin')
        or (p_branch_id is not null and branch_id = p_branch_id)
      )
  );
$$;

-- Auto-create a profile row whenever a new auth user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name');
  return new;
end;
$$;

drop trigger if exists trg_handle_new_user on auth.users;
create trigger trg_handle_new_user
after insert on auth.users
for each row execute function public.handle_new_user();

-- Only admins may change someone's role; everyone may edit their own full_name.
create or replace function public.protect_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role <> old.role and not public.is_admin() then
    new.role := old.role;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_profile_role on public.profiles;
create trigger trg_protect_profile_role
before update on public.profiles
for each row execute function public.protect_profile_role();

drop policy if exists "profiles_select_all" on public.profiles;
create policy "profiles_select_all"
  on public.profiles for select
  to authenticated
  using (true);

drop policy if exists "profiles_update_self_or_admin" on public.profiles;
create policy "profiles_update_self_or_admin"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id or public.is_admin())
  with check (auth.uid() = id or public.is_admin());

-- ---------------------------------------------------------------------
-- PRODUCTS
-- ---------------------------------------------------------------------
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sku text,
  unit text not null default 'pcs',
  category text,
  quantity numeric not null default 0,
  reorder_level numeric not null default 0,
  cost_price numeric,
  unit_price numeric,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

alter table public.products
  add column if not exists cost_price numeric;

alter table public.products enable row level security;

create index if not exists products_name_idx on public.products (name);

-- Quantity must only change via stock_movements triggers, never directly.
create or replace function public.protect_product_quantity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if pg_trigger_depth() <= 1 and new.quantity <> old.quantity then
    new.quantity := old.quantity;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_product_quantity on public.products;
create trigger trg_protect_product_quantity
before update on public.products
for each row execute function public.protect_product_quantity();

drop policy if exists "products_select" on public.products;
create policy "products_select"
  on public.products for select
  to authenticated
  using (true);

drop policy if exists "products_insert" on public.products;
create policy "products_insert"
  on public.products for insert
  to authenticated
  with check (public.is_admin());

drop policy if exists "products_update" on public.products;
create policy "products_update"
  on public.products for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "products_delete_admin" on public.products;
create policy "products_delete_admin"
  on public.products for delete
  to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------
-- STOCK MOVEMENTS (immutable ledger; products.quantity is kept in sync)
-- ---------------------------------------------------------------------
create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete restrict,
  type text not null check (type in ('IN', 'OUT')),
  quantity numeric not null check (quantity > 0),
  note text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

alter table public.stock_movements enable row level security;

create index if not exists stock_movements_product_id_idx on public.stock_movements (product_id);
create index if not exists stock_movements_created_at_idx on public.stock_movements (created_at desc);

-- Adjusts a product's quantity, raising an error if it would go negative.
create or replace function public.adjust_product_quantity(p_product_id uuid, p_delta numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new numeric;
  v_exists boolean;
begin
  update public.products
  set quantity = quantity + p_delta
  where id = p_product_id
    and quantity + p_delta >= 0
  returning quantity into v_new;

  if v_new is not null then
    return;
  end if;

  select exists(select 1 from public.products where id = p_product_id) into v_exists;
  if not v_exists then
    raise exception 'Product haijapatikana kwenye stock: %', p_product_id;
  end if;

  raise exception 'Stock haitoshi kwa bidhaa %. Huna bidhaa za kutosha stoo.', p_product_id;
end;
$$;

create or replace function public.apply_stock_movement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.type = 'IN' then
    perform public.adjust_product_quantity(new.product_id, new.quantity);
  else
    perform public.adjust_product_quantity(new.product_id, -new.quantity);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_apply_stock_movement on public.stock_movements;
create trigger trg_apply_stock_movement
after insert on public.stock_movements
for each row execute function public.apply_stock_movement();

-- If an admin deletes a movement (correction), reverse its effect on quantity.
create or replace function public.reverse_stock_movement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.type = 'IN' then
    perform public.adjust_product_quantity(old.product_id, -old.quantity);
  else
    perform public.adjust_product_quantity(old.product_id, old.quantity);
  end if;
  return old;
end;
$$;

drop trigger if exists trg_reverse_stock_movement on public.stock_movements;
create trigger trg_reverse_stock_movement
after delete on public.stock_movements
for each row execute function public.reverse_stock_movement();

drop policy if exists "stock_movements_select" on public.stock_movements;
create policy "stock_movements_select"
  on public.stock_movements for select
  to authenticated
  using (true);

drop policy if exists "stock_movements_insert" on public.stock_movements;
create policy "stock_movements_insert"
  on public.stock_movements for insert
  to authenticated
  with check (public.is_admin());

drop policy if exists "stock_movements_delete_admin" on public.stock_movements;
create policy "stock_movements_delete_admin"
  on public.stock_movements for delete
  to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------
-- SALES (duka sales ledger; inserting a sale reduces stock)
-- ---------------------------------------------------------------------
create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  sale_number text,
  product_id uuid not null references public.products (id) on delete restrict,
  quantity numeric not null check (quantity > 0),
  unit_price numeric not null check (unit_price >= 0),
  amount_paid numeric not null default 0 check (amount_paid >= 0),
  customer_name text,
  payment_status text not null default 'paid' check (payment_status in ('paid', 'partial', 'credit')),
  note text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

alter table public.sales enable row level security;

create index if not exists sales_product_id_idx on public.sales (product_id);
create index if not exists sales_created_at_idx on public.sales (created_at desc);
create unique index if not exists sales_sale_number_key on public.sales (sale_number) where sale_number is not null;

create table if not exists public.sale_number_counters (
  branch_id text not null,
  sale_year integer not null,
  last_number integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (branch_id, sale_year)
);

alter table public.sale_number_counters enable row level security;

create or replace function public.sale_branch_prefix(p_branch_id text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_source text;
  v_clean text;
begin
  select name into v_source from public.branches where id = p_branch_id limit 1;
  v_source := coalesce(v_source, p_branch_id, 'SALE');
  if lower(v_source) like 'adia%' then return 'ADIA'; end if;
  if lower(v_source) like '%fitness%' then return 'FITN'; end if;
  v_clean := regexp_replace(upper(v_source), '[^A-Z0-9]', '', 'g');
  return rpad(left(coalesce(nullif(v_clean, ''), 'SALE'), 4), 4, 'X');
end;
$$;

create or replace function public.next_sale_number(p_branch_id text, p_created_at timestamptz default now())
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch_key text := coalesce(nullif(p_branch_id, ''), 'default');
  v_year integer := extract(year from coalesce(p_created_at, now()))::integer;
  v_next integer;
begin
  insert into public.sale_number_counters (branch_id, sale_year, last_number, updated_at)
  values (v_branch_key, v_year, 1, now())
  on conflict (branch_id, sale_year)
  do update set last_number = public.sale_number_counters.last_number + 1, updated_at = now()
  returning last_number into v_next;
  return public.sale_branch_prefix(p_branch_id) || '-' || v_year || '-' || lpad(v_next::text, 4, '0');
end;
$$;

create or replace function public.assign_sale_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.sale_number is null or btrim(new.sale_number) = '' then
    new.sale_number := public.next_sale_number(new.branch_id, new.created_at);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_assign_sale_number on public.sales;
create trigger trg_assign_sale_number
  before insert on public.sales
  for each row
  execute function public.assign_sale_number();

create or replace function public.apply_sale_stock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.adjust_product_quantity(new.product_id, -new.quantity);
  return new;
end;
$$;

drop trigger if exists trg_apply_sale_stock on public.sales;
create trigger trg_apply_sale_stock
after insert on public.sales
for each row execute function public.apply_sale_stock();

create or replace function public.reverse_sale_stock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.adjust_product_quantity(old.product_id, old.quantity);
  return old;
end;
$$;

drop trigger if exists trg_reverse_sale_stock on public.sales;
create trigger trg_reverse_sale_stock
after delete on public.sales
for each row execute function public.reverse_sale_stock();

drop policy if exists "sales_select" on public.sales;
create policy "sales_select"
  on public.sales for select
  to authenticated
  using (public.is_admin() or created_by = auth.uid());

drop policy if exists "sales_insert" on public.sales;
create policy "sales_insert"
  on public.sales for insert
  to authenticated
  with check (true);

drop policy if exists "sales_delete_admin" on public.sales;
create policy "sales_delete_admin"
  on public.sales for delete
  to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------
-- EXPENSES
-- ---------------------------------------------------------------------
create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text,
  amount numeric not null check (amount > 0),
  note text,
  receipt_file_name text,
  receipt_mime_type text,
  receipt_data_url text,
  receipt_storage_path text,
  receipt_attached_at timestamptz,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

alter table public.expenses enable row level security;

create index if not exists expenses_created_at_idx on public.expenses (created_at desc);

drop policy if exists "expenses_select" on public.expenses;
create policy "expenses_select"
  on public.expenses for select
  to authenticated
  using (public.is_admin());

drop policy if exists "expenses_insert" on public.expenses;
create policy "expenses_insert"
  on public.expenses for insert
  to authenticated
  with check (public.is_admin());

drop policy if exists "expenses_delete_admin" on public.expenses;
create policy "expenses_delete_admin"
  on public.expenses for delete
  to authenticated
  using (public.is_admin());

drop policy if exists "expense_receipts_delete_owner" on storage.objects;
create policy "expense_receipts_delete_owner"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'expense-receipts' and (owner = auth.uid() or public.is_admin()));

-- ---------------------------------------------------------------------
-- OPERATION CASH INJECTIONS
-- ---------------------------------------------------------------------
create or replace function public.is_owner()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role in ('owner', 'admin')
  );
$$;

create table if not exists public.operation_cash_injections (
  id uuid primary key default gen_random_uuid(),
  branch_id text,
  amount numeric not null check (amount > 0),
  note text,
  injected_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

alter table public.operation_cash_injections enable row level security;

create index if not exists operation_cash_injections_branch_created_idx
  on public.operation_cash_injections (branch_id, created_at desc);

drop policy if exists "operation_cash_injections_select_admin" on public.operation_cash_injections;
drop policy if exists "operation_cash_injections_select_branch_users" on public.operation_cash_injections;
create policy "operation_cash_injections_select_branch_users"
  on public.operation_cash_injections for select
  to authenticated
  using (public.can_access_branch(branch_id));

drop policy if exists "operation_cash_injections_insert_owner" on public.operation_cash_injections;
create policy "operation_cash_injections_insert_owner"
  on public.operation_cash_injections for insert
  to authenticated
  with check (public.is_owner());

drop policy if exists "operation_cash_injections_delete_owner" on public.operation_cash_injections;
create policy "operation_cash_injections_delete_owner"
  on public.operation_cash_injections for delete
  to authenticated
  using (public.is_owner());

create or replace function public.get_operation_cash_summary(p_branch_id text)
returns table (
  injected_total numeric,
  expenses_total numeric,
  balance numeric
)
language sql
security definer
stable
set search_path = public
as $$
  select
    coalesce((select sum(amount) from public.operation_cash_injections where branch_id = p_branch_id), 0)::numeric as injected_total,
    coalesce((select sum(amount) from public.expenses where branch_id = p_branch_id), 0)::numeric as expenses_total,
    (
      coalesce((select sum(amount) from public.operation_cash_injections where branch_id = p_branch_id), 0)
      - coalesce((select sum(amount) from public.expenses where branch_id = p_branch_id), 0)
    )::numeric as balance
  where public.can_access_branch(p_branch_id);
$$;

grant execute on function public.get_operation_cash_summary(text) to authenticated;

create or replace function public.get_operation_cash_audit(p_branch_id text, p_limit integer default 30)
returns table (
  event_id text,
  event_type text,
  branch_id text,
  title text,
  amount numeric,
  actor_id uuid,
  actor_name text,
  created_at timestamptz,
  balance_before numeric,
  balance_after numeric,
  has_receipt boolean
)
language sql
security definer
stable
set search_path = public
as $$
  with events as (
    select id::text as event_id, 'injection'::text as event_type, branch_id,
      coalesce(note, 'Operation Cash Injection') as title, amount::numeric as amount,
      amount::numeric as delta, injected_by as actor_id, created_at, false as has_receipt
    from public.operation_cash_injections
    where branch_id = p_branch_id
    union all
    select id::text as event_id, 'expense'::text as event_type, branch_id, title,
      amount::numeric as amount, (-amount)::numeric as delta, created_by as actor_id,
      created_at, (receipt_storage_path is not null or receipt_data_url is not null) as has_receipt
    from public.expenses
    where branch_id = p_branch_id
  ),
  running as (
    select events.*, sum(delta) over (order by created_at, event_type, event_id rows between unbounded preceding and current row) as balance_after
    from events
  )
  select running.event_id, running.event_type, running.branch_id, running.title, running.amount,
    running.actor_id, coalesce(profiles.full_name, running.actor_id::text, 'System') as actor_name,
    running.created_at, (running.balance_after - running.delta)::numeric as balance_before,
    running.balance_after::numeric as balance_after, running.has_receipt
  from running
  left join public.profiles on profiles.id = running.actor_id
  where public.can_access_branch(p_branch_id)
  order by running.created_at desc, running.event_id desc
  limit greatest(1, least(coalesce(p_limit, 30), 100));
$$;

grant execute on function public.get_operation_cash_audit(text, integer) to authenticated;

create or replace function public.get_cashier_today_expenses(p_branch_id text, p_from timestamptz)
returns table (
  id uuid,
  branch_id text,
  title text,
  category text,
  amount numeric,
  receipt_file_name text,
  has_receipt boolean,
  created_by uuid,
  actor_name text,
  created_at timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  select expenses.id, expenses.branch_id, expenses.title, expenses.category, expenses.amount,
    expenses.receipt_file_name,
    (expenses.receipt_storage_path is not null or expenses.receipt_data_url is not null) as has_receipt,
    expenses.created_by, coalesce(profiles.full_name, expenses.created_by::text, 'System') as actor_name,
    expenses.created_at
  from public.expenses
  left join public.profiles on profiles.id = expenses.created_by
  where public.can_access_branch(p_branch_id)
    and expenses.branch_id = p_branch_id
    and expenses.created_at >= p_from
  order by expenses.created_at desc
  limit 50;
$$;

grant execute on function public.get_cashier_today_expenses(text, timestamptz) to authenticated;

drop policy if exists "expenses_insert_branch_users" on public.expenses;
create policy "expenses_insert_branch_users"
  on public.expenses for insert
  to authenticated
  with check (public.can_access_branch(branch_id) and created_by = auth.uid());

-- ---------------------------------------------------------------------
-- DEBTS (manual customer debt ledger for non-stock or adjusted credit)
-- ---------------------------------------------------------------------
create table if not exists public.debts (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid references public.sales (id) on delete set null,
  customer_name text not null,
  description text,
  amount numeric not null check (amount > 0),
  amount_paid numeric not null default 0 check (amount_paid >= 0),
  due_date date,
  status text not null default 'open' check (status in ('open', 'partial', 'paid')),
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

alter table public.debts enable row level security;

create index if not exists debts_sale_id_idx on public.debts (sale_id);
create index if not exists debts_created_at_idx on public.debts (created_at desc);
create index if not exists debts_status_idx on public.debts (status);

drop policy if exists "debts_select" on public.debts;
create policy "debts_select"
  on public.debts for select
  to authenticated
  using (public.is_admin());

drop policy if exists "debts_insert" on public.debts;
create policy "debts_insert"
  on public.debts for insert
  to authenticated
  with check (public.is_admin());

drop policy if exists "debts_update" on public.debts;
create policy "debts_update"
  on public.debts for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "debts_delete_admin" on public.debts;
create policy "debts_delete_admin"
  on public.debts for delete
  to authenticated
  using (public.is_admin());

create or replace function public.create_debt_from_credit_sale()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total numeric;
  v_product_name text;
begin
  v_total := new.quantity * new.unit_price;

  if v_total > new.amount_paid then
    select name into v_product_name from public.products where id = new.product_id;

    insert into public.debts (
      sale_id,
      customer_name,
      description,
      amount,
      amount_paid,
      status,
      created_by,
      created_at
    )
    values (
      new.id,
      coalesce(nullif(new.customer_name, ''), 'Mteja wa mauzo'),
      concat('Mauzo ya ', coalesce(v_product_name, 'bidhaa')),
      v_total,
      new.amount_paid,
      case when new.amount_paid > 0 then 'partial' else 'open' end,
      new.created_by,
      new.created_at
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_create_debt_from_credit_sale on public.sales;
create trigger trg_create_debt_from_credit_sale
after insert on public.sales
for each row execute function public.create_debt_from_credit_sale();
