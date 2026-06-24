-- Real onboarding storage for company settings, categories, and staff invite setup.
-- Run after branches-two-locations.sql and production-rls-hardening.sql.

create table if not exists public.company_settings (
  id text primary key default 'default',
  name text not null,
  tagline text,
  location text,
  phones_text text,
  email text,
  tax text,
  bank_text text,
  logo_text text,
  logo_url text,
  currency text not null default 'TZS',
  receipt_footer text,
  updated_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.product_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create table if not exists public.staff_invites (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text not null,
  role text not null default 'cashier' check (role in ('owner', 'manager', 'cashier')),
  branch_id text references public.branches (id),
  status text not null default 'pending' check (status in ('pending', 'registered', 'cancelled')),
  note text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create index if not exists staff_invites_branch_id_idx on public.staff_invites (branch_id);
create index if not exists staff_invites_email_idx on public.staff_invites (lower(email));
create index if not exists product_categories_active_idx on public.product_categories (active);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_company_settings_updated_at on public.company_settings;
create trigger trg_company_settings_updated_at
before update on public.company_settings
for each row execute function public.set_updated_at();

alter table public.company_settings enable row level security;
alter table public.product_categories enable row level security;
alter table public.staff_invites enable row level security;

drop policy if exists "company_settings_select_authenticated" on public.company_settings;
drop policy if exists "company_settings_owner_insert" on public.company_settings;
drop policy if exists "company_settings_owner_update" on public.company_settings;
drop policy if exists "categories_select_authenticated" on public.product_categories;
drop policy if exists "categories_owner_manage" on public.product_categories;
drop policy if exists "staff_invites_select_owner_manager" on public.staff_invites;
drop policy if exists "staff_invites_owner_manage" on public.staff_invites;

create policy "company_settings_select_authenticated"
  on public.company_settings for select
  to authenticated
  using (true);

create policy "company_settings_owner_insert"
  on public.company_settings for insert
  to authenticated
  with check (public.is_owner());

create policy "company_settings_owner_update"
  on public.company_settings for update
  to authenticated
  using (public.is_owner())
  with check (public.is_owner());

create policy "categories_select_authenticated"
  on public.product_categories for select
  to authenticated
  using (active or public.is_owner());

create policy "categories_owner_manage"
  on public.product_categories for all
  to authenticated
  using (public.is_owner())
  with check (public.is_owner());

create policy "staff_invites_select_owner_manager"
  on public.staff_invites for select
  to authenticated
  using (public.is_owner() or public.can_manage_branch(branch_id));

create policy "staff_invites_owner_manage"
  on public.staff_invites for all
  to authenticated
  using (public.is_owner())
  with check (public.is_owner());
