-- Fitness equipment sales modules: product variants, warranty, quotations, layaway, bundles, returns.
-- Run after schema.sql and branches-two-locations.sql.

alter table public.products
  add column if not exists variant_size text,
  add column if not exists variant_color text,
  add column if not exists variant_weight text,
  add column if not exists warranty_months integer;

create table if not exists public.quotations (
  id uuid primary key default gen_random_uuid(),
  branch_id text references public.branches (id) default 'adiasports',
  customer_name text not null,
  customer_contact text,
  quote_number text,
  total_amount numeric not null default 0,
  status text not null default 'draft' check (status in ('draft', 'sent', 'accepted', 'rejected', 'converted')),
  note text,
  valid_until date,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create table if not exists public.quotation_items (
  id uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references public.quotations (id) on delete cascade,
  product_id uuid references public.products (id),
  description text not null,
  quantity numeric not null check (quantity > 0),
  unit_price numeric not null check (unit_price >= 0)
);

create table if not exists public.layaways (
  id uuid primary key default gen_random_uuid(),
  branch_id text references public.branches (id) default 'adiasports',
  customer_name text not null,
  customer_contact text,
  product_id uuid references public.products (id),
  total_amount numeric not null check (total_amount >= 0),
  amount_paid numeric not null default 0 check (amount_paid >= 0),
  status text not null default 'open' check (status in ('open', 'completed', 'cancelled')),
  due_date date,
  note text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create table if not exists public.layaway_payments (
  id uuid primary key default gen_random_uuid(),
  layaway_id uuid not null references public.layaways (id) on delete cascade,
  amount numeric not null check (amount > 0),
  paid_at timestamptz not null default now(),
  note text,
  created_by uuid references auth.users (id)
);

create table if not exists public.product_bundles (
  id uuid primary key default gen_random_uuid(),
  branch_id text references public.branches (id) default 'adiasports',
  name text not null,
  sku text,
  bundle_price numeric not null default 0,
  active boolean not null default true,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create table if not exists public.product_bundle_items (
  id uuid primary key default gen_random_uuid(),
  bundle_id uuid not null references public.product_bundles (id) on delete cascade,
  product_id uuid not null references public.products (id),
  quantity numeric not null check (quantity > 0)
);

create table if not exists public.warranty_claims (
  id uuid primary key default gen_random_uuid(),
  branch_id text references public.branches (id) default 'adiasports',
  sale_id uuid references public.sales (id),
  product_id uuid references public.products (id),
  customer_name text not null,
  issue text not null,
  action text not null default 'review' check (action in ('review', 'repair', 'exchange', 'refund', 'reject')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'completed')),
  created_by uuid references auth.users (id),
  reviewed_by uuid references auth.users (id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.quotations enable row level security;
alter table public.quotation_items enable row level security;
alter table public.layaways enable row level security;
alter table public.layaway_payments enable row level security;
alter table public.product_bundles enable row level security;
alter table public.product_bundle_items enable row level security;
alter table public.warranty_claims enable row level security;

drop policy if exists "quotations_manage_branch" on public.quotations;
create policy "quotations_manage_branch" on public.quotations
  for all to authenticated
  using (public.can_manage_branch(branch_id))
  with check (public.can_manage_branch(branch_id));

drop policy if exists "quotation_items_manage_branch" on public.quotation_items;
create policy "quotation_items_manage_branch" on public.quotation_items
  for all to authenticated
  using (exists (select 1 from public.quotations q where q.id = quotation_id and public.can_manage_branch(q.branch_id)))
  with check (exists (select 1 from public.quotations q where q.id = quotation_id and public.can_manage_branch(q.branch_id)));

drop policy if exists "layaways_manage_branch" on public.layaways;
create policy "layaways_manage_branch" on public.layaways
  for all to authenticated
  using (public.can_manage_branch(branch_id))
  with check (public.can_manage_branch(branch_id));

drop policy if exists "layaway_payments_manage_branch" on public.layaway_payments;
create policy "layaway_payments_manage_branch" on public.layaway_payments
  for all to authenticated
  using (exists (select 1 from public.layaways l where l.id = layaway_id and public.can_manage_branch(l.branch_id)))
  with check (exists (select 1 from public.layaways l where l.id = layaway_id and public.can_manage_branch(l.branch_id)));

drop policy if exists "product_bundles_manage_branch" on public.product_bundles;
create policy "product_bundles_manage_branch" on public.product_bundles
  for all to authenticated
  using (public.can_manage_branch(branch_id))
  with check (public.can_manage_branch(branch_id));

drop policy if exists "product_bundle_items_manage_branch" on public.product_bundle_items;
create policy "product_bundle_items_manage_branch" on public.product_bundle_items
  for all to authenticated
  using (exists (select 1 from public.product_bundles b where b.id = bundle_id and public.can_manage_branch(b.branch_id)))
  with check (exists (select 1 from public.product_bundles b where b.id = bundle_id and public.can_manage_branch(b.branch_id)));

drop policy if exists "warranty_claims_manage_branch" on public.warranty_claims;
create policy "warranty_claims_manage_branch" on public.warranty_claims
  for all to authenticated
  using (public.can_manage_branch(branch_id))
  with check (public.can_manage_branch(branch_id));
