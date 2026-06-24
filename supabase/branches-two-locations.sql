-- Branch setup for one company with two branches:
-- 1. adiasports
-- 2. Fitness Empire

create table if not exists public.branches (
  id text primary key,
  name text not null,
  created_at timestamptz not null default now()
);

insert into public.branches (id, name)
values
  ('adiasports', 'adiasports'),
  ('fitness-empire', 'Fitness Empire')
on conflict (id) do update set name = excluded.name;

alter table public.profiles
  add column if not exists branch_id text references public.branches (id);

alter table public.products
  add column if not exists branch_id text references public.branches (id) default 'adiasports';

alter table public.stock_movements
  add column if not exists branch_id text references public.branches (id) default 'adiasports';

alter table public.sales
  add column if not exists branch_id text references public.branches (id) default 'adiasports';

alter table public.expenses
  add column if not exists branch_id text references public.branches (id) default 'adiasports';

alter table public.debts
  add column if not exists branch_id text references public.branches (id) default 'adiasports';

update public.products set branch_id = 'adiasports' where branch_id is null;
update public.stock_movements set branch_id = 'adiasports' where branch_id is null;
update public.sales set branch_id = 'adiasports' where branch_id is null;
update public.expenses set branch_id = 'adiasports' where branch_id is null;
update public.debts set branch_id = 'adiasports' where branch_id is null;

create index if not exists products_branch_id_idx on public.products (branch_id);
create index if not exists stock_movements_branch_id_idx on public.stock_movements (branch_id);
create index if not exists sales_branch_id_idx on public.sales (branch_id);
create index if not exists expenses_branch_id_idx on public.expenses (branch_id);
create index if not exists debts_branch_id_idx on public.debts (branch_id);
