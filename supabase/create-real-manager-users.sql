-- Real manager login accounts for adiasports and Fitness Empire.
-- Run this in Supabase SQL Editor as project owner/service role.
--
-- Temporary passwords:
--   Fitness Empire manager: FitEmpire@2026!
--   adiasports manager:     AdiaSports@2026!
--
-- Ask each manager to change password after first successful login.

begin;

create extension if not exists pgcrypto with schema extensions;

insert into public.branches (id, name)
values
  ('adiasports', 'adiasports'),
  ('fitness-empire', 'Fitness Empire')
on conflict (id) do update set name = excluded.name;

insert into auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
select
  '40000000-0000-0000-0000-000000000201'::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated',
  'authenticated',
  'msangiyasinta08@gmail.com',
  extensions.crypt('FitEmpire@2026!', extensions.gen_salt('bf')),
  now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"sub":"40000000-0000-0000-0000-000000000201","email":"msangiyasinta08@gmail.com","full_name":"Yasinta Msangi","email_verified":true,"phone_verified":false}'::jsonb,
  now(),
  now()
where not exists (select 1 from auth.users where lower(email) = lower('msangiyasinta08@gmail.com'))
on conflict (id) do update
set
  email = excluded.email,
  encrypted_password = excluded.encrypted_password,
  email_confirmed_at = coalesce(auth.users.email_confirmed_at, now()),
  raw_app_meta_data = excluded.raw_app_meta_data,
  raw_user_meta_data = excluded.raw_user_meta_data,
  updated_at = now();

insert into auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
select
  '40000000-0000-0000-0000-000000000202'::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated',
  'authenticated',
  'eliwazajohnson5@gmail.com',
  extensions.crypt('AdiaSports@2026!', extensions.gen_salt('bf')),
  now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"sub":"40000000-0000-0000-0000-000000000202","email":"eliwazajohnson5@gmail.com","full_name":"Eliwaza Johnson","email_verified":true,"phone_verified":false}'::jsonb,
  now(),
  now()
where not exists (select 1 from auth.users where lower(email) = lower('eliwazajohnson5@gmail.com'))
on conflict (id) do update
set
  email = excluded.email,
  encrypted_password = excluded.encrypted_password,
  email_confirmed_at = coalesce(auth.users.email_confirmed_at, now()),
  raw_app_meta_data = excluded.raw_app_meta_data,
  raw_user_meta_data = excluded.raw_user_meta_data,
  updated_at = now();

update auth.users
set
  encrypted_password = extensions.crypt('FitEmpire@2026!', extensions.gen_salt('bf')),
  email_confirmed_at = coalesce(email_confirmed_at, now()),
  confirmation_token = '',
  recovery_token = '',
  email_change_token_new = '',
  email_change = '',
  phone_change = '',
  phone_change_token = '',
  reauthentication_token = '',
  raw_app_meta_data = '{"provider":"email","providers":["email"]}'::jsonb,
  raw_user_meta_data = jsonb_build_object(
    'sub', id::text,
    'email', email,
    'full_name', 'Yasinta Msangi',
    'email_verified', true,
    'phone_verified', false
  ),
  updated_at = now()
where lower(email) = lower('msangiyasinta08@gmail.com');

update auth.users
set
  encrypted_password = extensions.crypt('AdiaSports@2026!', extensions.gen_salt('bf')),
  email_confirmed_at = coalesce(email_confirmed_at, now()),
  confirmation_token = '',
  recovery_token = '',
  email_change_token_new = '',
  email_change = '',
  phone_change = '',
  phone_change_token = '',
  reauthentication_token = '',
  raw_app_meta_data = '{"provider":"email","providers":["email"]}'::jsonb,
  raw_user_meta_data = jsonb_build_object(
    'sub', id::text,
    'email', email,
    'full_name', 'Eliwaza Johnson',
    'email_verified', true,
    'phone_verified', false
  ),
  updated_at = now()
where lower(email) = lower('eliwazajohnson5@gmail.com');

insert into auth.identities (
  provider_id,
  user_id,
  identity_data,
  provider,
  last_sign_in_at,
  created_at,
  updated_at
)
select
  users.id::text,
  users.id,
  jsonb_build_object(
    'sub', users.id::text,
    'email', users.email,
    'full_name', users.raw_user_meta_data ->> 'full_name',
    'email_verified', true,
    'phone_verified', false
  ),
  'email',
  now(),
  now(),
  now()
from auth.users
where lower(email) in (lower('msangiyasinta08@gmail.com'), lower('eliwazajohnson5@gmail.com'))
on conflict (provider, provider_id) do update
set
  identity_data = excluded.identity_data,
  updated_at = now();

alter table public.profiles disable trigger trg_protect_profile_role;

insert into public.profiles (id, full_name, role, branch_id)
select users.id, 'Yasinta Msangi', 'manager', 'fitness-empire'
from auth.users
where lower(email) = lower('msangiyasinta08@gmail.com')
on conflict (id) do update
set
  full_name = excluded.full_name,
  role = excluded.role,
  branch_id = excluded.branch_id;

insert into public.profiles (id, full_name, role, branch_id)
select users.id, 'Eliwaza Johnson', 'manager', 'adiasports'
from auth.users
where lower(email) = lower('eliwazajohnson5@gmail.com')
on conflict (id) do update
set
  full_name = excluded.full_name,
  role = excluded.role,
  branch_id = excluded.branch_id;

alter table public.profiles enable trigger trg_protect_profile_role;

insert into public.staff_invites (full_name, email, role, branch_id, status, note)
values
  ('Yasinta Msangi', 'msangiyasinta08@gmail.com', 'manager', 'fitness-empire', 'registered', 'Real manager account created by SQL'),
  ('Eliwaza Johnson', 'eliwazajohnson5@gmail.com', 'manager', 'adiasports', 'registered', 'Real manager account created by SQL')
on conflict do nothing;

select
  profiles.full_name,
  users.email,
  profiles.role,
  profiles.branch_id
from public.profiles
join auth.users on users.id = profiles.id
where lower(users.email) in (lower('msangiyasinta08@gmail.com'), lower('eliwazajohnson5@gmail.com'))
order by profiles.branch_id;

commit;
