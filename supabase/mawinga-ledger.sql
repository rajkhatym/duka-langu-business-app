-- Mawinga registry: people who take stock to sell and later bring payments.
-- Run this once in Supabase SQL editor before using Mawinga registration online.

create table if not exists public.mawinga (
  id uuid primary key default gen_random_uuid(),
  branch_id text references public.branches (id) on delete set null,
  name text not null,
  contact text,
  note text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.mawinga enable row level security;

create index if not exists mawinga_branch_id_idx on public.mawinga (branch_id);
create index if not exists mawinga_status_idx on public.mawinga (status);
create unique index if not exists mawinga_branch_name_unique_idx
  on public.mawinga (branch_id, lower(name));

drop policy if exists "mawinga_select_manager" on public.mawinga;
create policy "mawinga_select_manager"
  on public.mawinga for select
  to authenticated
  using (public.can_access_branch(branch_id));

drop policy if exists "mawinga_insert_manager" on public.mawinga;
create policy "mawinga_insert_manager"
  on public.mawinga for insert
  to authenticated
  with check (public.can_access_branch(branch_id));

drop policy if exists "mawinga_update_manager" on public.mawinga;
create policy "mawinga_update_manager"
  on public.mawinga for update
  to authenticated
  using (public.can_access_branch(branch_id))
  with check (public.can_access_branch(branch_id));

drop policy if exists "mawinga_delete_owner" on public.mawinga;
create policy "mawinga_delete_owner"
  on public.mawinga for delete
  to authenticated
  using (public.is_owner());
