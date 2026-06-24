-- Operation cash injections.
-- Owner funds branch operations here; expenses reduce the visible balance in the app.

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
    select
      id::text as event_id,
      'injection'::text as event_type,
      branch_id,
      coalesce(note, 'Operation Cash Injection') as title,
      amount::numeric as amount,
      amount::numeric as delta,
      injected_by as actor_id,
      created_at,
      false as has_receipt
    from public.operation_cash_injections
    where branch_id = p_branch_id

    union all

    select
      id::text as event_id,
      'expense'::text as event_type,
      branch_id,
      title,
      amount::numeric as amount,
      (-amount)::numeric as delta,
      created_by as actor_id,
      created_at,
      (receipt_storage_path is not null or receipt_data_url is not null) as has_receipt
    from public.expenses
    where branch_id = p_branch_id
  ),
  running as (
    select
      events.*,
      sum(delta) over (order by created_at, event_type, event_id rows between unbounded preceding and current row) as balance_after
    from events
  )
  select
    running.event_id,
    running.event_type,
    running.branch_id,
    running.title,
    running.amount,
    running.actor_id,
    coalesce(profiles.full_name, running.actor_id::text, 'System') as actor_name,
    running.created_at,
    (running.balance_after - running.delta)::numeric as balance_before,
    running.balance_after::numeric as balance_after,
    running.has_receipt
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
  select
    expenses.id,
    expenses.branch_id,
    expenses.title,
    expenses.category,
    expenses.amount,
    expenses.receipt_file_name,
    (expenses.receipt_storage_path is not null or expenses.receipt_data_url is not null) as has_receipt,
    expenses.created_by,
    coalesce(profiles.full_name, expenses.created_by::text, 'System') as actor_name,
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
