-- Cleanup for rls-owner-role-test-data.sql and restore owner profile.

begin;

alter table public.profiles disable trigger trg_protect_profile_role;

update public.profiles
set role = 'owner', branch_id = 'adiasports'
where id = (select id from auth.users where email = 'rajabsalum889@gmail.com');

alter table public.profiles enable trigger trg_protect_profile_role;

delete from public.quotation_items
where quotation_id in (select id from public.quotations where quote_number like 'RLS-OWNER-%');
delete from public.quotations where quote_number like 'RLS-OWNER-%';
delete from public.purchases where invoice_number like 'RLS-OWNER-%';
delete from public.debts where customer_name like 'RLS Owner%';
delete from public.expenses where title like 'RLS Owner%';
delete from public.sales where product_id in (
  '40000000-0000-0000-0000-000000000101',
  '40000000-0000-0000-0000-000000000102'
);
delete from public.products where sku in ('RLS-OWNER-ADIA', 'RLS-OWNER-FIT');

commit;
