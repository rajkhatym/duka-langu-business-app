-- Badilisha email hapa chini iwe email ya akaunti yako, kisha run Supabase SQL Editor.
-- Baada ya kurun, refresh app au logout/login ili Owner side ifunguke.

begin;

alter table public.profiles disable trigger trg_protect_profile_role;

update public.profiles
set role = 'owner',
    branch_id = coalesce(branch_id, 'adiasports')
where id = (
  select id
  from auth.users
  where email = 'rajabsalum889@gmail.com'
);

alter table public.profiles enable trigger trg_protect_profile_role;

commit;
