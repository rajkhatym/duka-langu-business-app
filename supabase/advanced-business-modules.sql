-- Adds purchase/supplier management, cashier shifts, stock approvals, and stock count tables.
-- Run after branches-two-locations.sql and operations-roles-audit-closing.sql.

create table if not exists public.purchases (
  id uuid primary key default gen_random_uuid(),
  branch_id text references public.branches (id) default 'adiasports',
  supplier_name text not null,
  invoice_number text,
  product_id uuid not null references public.products (id) on delete restrict,
  quantity numeric not null check (quantity > 0),
  cost_price numeric not null check (cost_price >= 0),
  amount_paid numeric not null default 0 check (amount_paid >= 0),
  payment_status text not null default 'credit' check (payment_status in ('paid', 'partial', 'credit')),
  note text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

alter table public.purchases enable row level security;

create index if not exists purchases_branch_id_idx on public.purchases (branch_id);
create index if not exists purchases_supplier_name_idx on public.purchases (supplier_name);
create index if not exists purchases_created_at_idx on public.purchases (created_at desc);

drop policy if exists "purchases_select" on public.purchases;
create policy "purchases_select"
  on public.purchases for select
  to authenticated
  using (public.can_manage_branch(branch_id));

drop policy if exists "purchases_insert" on public.purchases;
create policy "purchases_insert"
  on public.purchases for insert
  to authenticated
  with check (public.can_manage_branch(branch_id));

drop policy if exists "purchases_update" on public.purchases;
create policy "purchases_update"
  on public.purchases for update
  to authenticated
  using (public.can_manage_branch(branch_id))
  with check (public.can_manage_branch(branch_id));

create table if not exists public.cash_shifts (
  id uuid primary key default gen_random_uuid(),
  branch_id text references public.branches (id) default 'adiasports',
  cashier_id uuid references auth.users (id),
  opening_cash numeric not null default 0,
  closing_cash numeric,
  expected_cash numeric,
  difference numeric,
  status text not null default 'open' check (status in ('open', 'closed')),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  note text
);

alter table public.cash_shifts enable row level security;

create index if not exists cash_shifts_branch_status_idx on public.cash_shifts (branch_id, status);
create index if not exists cash_shifts_cashier_idx on public.cash_shifts (cashier_id);

drop policy if exists "cash_shifts_select" on public.cash_shifts;
create policy "cash_shifts_select"
  on public.cash_shifts for select
  to authenticated
  using (public.can_manage_branch(branch_id) or cashier_id = auth.uid());

drop policy if exists "cash_shifts_insert" on public.cash_shifts;
create policy "cash_shifts_insert"
  on public.cash_shifts for insert
  to authenticated
  with check (public.can_access_branch(branch_id) and cashier_id = auth.uid());

drop policy if exists "cash_shifts_update" on public.cash_shifts;
create policy "cash_shifts_update"
  on public.cash_shifts for update
  to authenticated
  using (public.can_manage_branch(branch_id) or cashier_id = auth.uid())
  with check (public.can_manage_branch(branch_id) or cashier_id = auth.uid());

create table if not exists public.stock_adjustment_requests (
  id uuid primary key default gen_random_uuid(),
  branch_id text references public.branches (id) default 'adiasports',
  product_id uuid not null references public.products (id) on delete restrict,
  requested_quantity numeric not null,
  reason text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_by uuid references auth.users (id),
  reviewed_by uuid references auth.users (id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.stock_adjustment_requests enable row level security;

drop policy if exists "stock_adjustment_requests_select" on public.stock_adjustment_requests;
create policy "stock_adjustment_requests_select"
  on public.stock_adjustment_requests for select
  to authenticated
  using (public.can_manage_branch(branch_id) or requested_by = auth.uid());

drop policy if exists "stock_adjustment_requests_insert" on public.stock_adjustment_requests;
create policy "stock_adjustment_requests_insert"
  on public.stock_adjustment_requests for insert
  to authenticated
  with check (public.can_access_branch(branch_id));

drop policy if exists "stock_adjustment_requests_update" on public.stock_adjustment_requests;
create policy "stock_adjustment_requests_update"
  on public.stock_adjustment_requests for update
  to authenticated
  using (public.is_owner())
  with check (public.is_owner());

create table if not exists public.stock_counts (
  id uuid primary key default gen_random_uuid(),
  branch_id text references public.branches (id) default 'adiasports',
  product_id uuid not null references public.products (id) on delete restrict,
  system_quantity numeric not null,
  counted_quantity numeric not null,
  difference numeric generated always as (counted_quantity - system_quantity) stored,
  note text,
  counted_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

alter table public.stock_counts enable row level security;

drop policy if exists "stock_counts_select" on public.stock_counts;
create policy "stock_counts_select"
  on public.stock_counts for select
  to authenticated
  using (public.can_manage_branch(branch_id));

drop policy if exists "stock_counts_insert" on public.stock_counts;
create policy "stock_counts_insert"
  on public.stock_counts for insert
  to authenticated
  with check (public.can_manage_branch(branch_id));

drop trigger if exists trg_audit_purchases on public.purchases;
create trigger trg_audit_purchases
after insert or update or delete on public.purchases
for each row execute function public.write_audit_log();

drop trigger if exists trg_audit_cash_shifts on public.cash_shifts;
create trigger trg_audit_cash_shifts
after insert or update or delete on public.cash_shifts
for each row execute function public.write_audit_log();

drop trigger if exists trg_audit_stock_adjustment_requests on public.stock_adjustment_requests;
create trigger trg_audit_stock_adjustment_requests
after insert or update or delete on public.stock_adjustment_requests
for each row execute function public.write_audit_log();

drop trigger if exists trg_audit_stock_counts on public.stock_counts;
create trigger trg_audit_stock_counts
after insert or update or delete on public.stock_counts
for each row execute function public.write_audit_log();
