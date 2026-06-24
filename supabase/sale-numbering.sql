-- Official receipt numbering for sales.
-- Format: ADIA-2026-0001, FITN-2026-0001, etc.

alter table public.sales
  add column if not exists sale_number text;

create unique index if not exists sales_sale_number_key
  on public.sales (sale_number)
  where sale_number is not null;

create table if not exists public.sale_number_counters (
  branch_id text not null,
  sale_year integer not null,
  last_number integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (branch_id, sale_year)
);

alter table public.sale_number_counters enable row level security;

drop policy if exists "sale_number_counters_read_admin" on public.sale_number_counters;
create policy "sale_number_counters_read_admin"
  on public.sale_number_counters for select
  to authenticated
  using (public.is_admin());

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
  select name into v_source
  from public.branches
  where id = p_branch_id
  limit 1;

  v_source := coalesce(v_source, p_branch_id, 'SALE');

  if lower(v_source) like 'adia%' then
    return 'ADIA';
  end if;

  if lower(v_source) like '%fitness%' then
    return 'FITN';
  end if;

  v_clean := regexp_replace(upper(v_source), '[^A-Z0-9]', '', 'g');
  return rpad(left(coalesce(nullif(v_clean, ''), 'SALE'), 4), 4, 'X');
end;
$$;

create or replace function public.next_sale_number(
  p_branch_id text,
  p_created_at timestamptz default now()
)
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
  do update
    set last_number = public.sale_number_counters.last_number + 1,
        updated_at = now()
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

do $$
declare
  v_sale record;
begin
  for v_sale in
    select id, branch_id, created_at
    from public.sales
    where sale_number is null
    order by created_at, id
  loop
    update public.sales
    set sale_number = public.next_sale_number(v_sale.branch_id, v_sale.created_at)
    where id = v_sale.id;
  end loop;
end $$;
