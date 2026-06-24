-- Staff security and activity utilities.
-- Adds forced password change, owner password reset, and staff activity summary.

begin;

create extension if not exists pgcrypto with schema extensions;

alter table public.profiles
  add column if not exists password_must_change boolean not null default false,
  add column if not exists last_password_change_at timestamptz;

update public.profiles
set password_must_change = true
where role = 'manager'
  and id in (
    select id
    from auth.users
    where lower(email) in (lower('msangiyasinta08@gmail.com'), lower('eliwazajohnson5@gmail.com'))
  );

create or replace function public.owner_reset_staff_password(
  p_user_id uuid,
  p_temp_password text
)
returns table (
  user_id uuid,
  email text,
  full_name text,
  role text,
  branch_id text,
  password_must_change boolean
)
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
begin
  if not public.is_owner() then
    raise exception 'Only owner can reset staff password';
  end if;

  if p_temp_password is null or length(p_temp_password) < 8 then
    raise exception 'Temporary password must be at least 8 characters';
  end if;

  if not exists (
    select 1
    from public.profiles
    where id = p_user_id
      and role in ('manager', 'cashier', 'staff')
  ) then
    raise exception 'User is not resettable staff';
  end if;

  update auth.users
  set
    encrypted_password = extensions.crypt(p_temp_password, extensions.gen_salt('bf')),
    confirmation_token = '',
    recovery_token = '',
    email_change_token_new = '',
    email_change = '',
    phone_change = '',
    phone_change_token = '',
    reauthentication_token = '',
    email_confirmed_at = coalesce(email_confirmed_at, now()),
    updated_at = now()
  where id = p_user_id;

  update public.profiles
  set
    password_must_change = true,
    last_password_change_at = null
  where id = p_user_id;

  return query
  select
    profiles.id,
    users.email,
    profiles.full_name,
    profiles.role,
    profiles.branch_id,
    profiles.password_must_change
  from public.profiles
  join auth.users on users.id = profiles.id
  where profiles.id = p_user_id;
end;
$$;

create or replace function public.mark_password_changed()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
  set
    password_must_change = false,
    last_password_change_at = now()
  where id = auth.uid();
end;
$$;

create or replace function public.get_staff_activity_summary(p_from timestamptz default date_trunc('day', now()))
returns table (
  user_id uuid,
  last_sign_in_at timestamptz,
  sales_today bigint,
  expenses_today bigint,
  audit_today bigint
)
language sql
security definer
set search_path = public, auth
as $$
  select
    profiles.id as user_id,
    users.last_sign_in_at,
    coalesce(sales.count, 0)::bigint as sales_today,
    coalesce(expenses.count, 0)::bigint as expenses_today,
    coalesce(audits.count, 0)::bigint as audit_today
  from public.profiles
  join auth.users on users.id = profiles.id
  left join lateral (
    select count(*)::bigint
    from public.sales
    where sales.created_by = profiles.id
      and sales.created_at >= p_from
  ) sales on true
  left join lateral (
    select count(*)::bigint
    from public.expenses
    where expenses.created_by = profiles.id
      and expenses.created_at >= p_from
  ) expenses on true
  left join lateral (
    select count(*)::bigint
    from public.audit_logs
    where audit_logs.actor_id = profiles.id
      and audit_logs.created_at >= p_from
  ) audits on true
  where public.is_owner();
$$;

grant execute on function public.owner_reset_staff_password(uuid, text) to authenticated;
grant execute on function public.mark_password_changed() to authenticated;
grant execute on function public.get_staff_activity_summary(timestamptz) to authenticated;

commit;
