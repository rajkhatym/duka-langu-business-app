-- Cleanup for rls-live-test-setup.sql.

begin;

delete from public.quotation_items
where quotation_id in (select id from public.quotations where quote_number like 'RLS-LIVE-%');
delete from public.quotations where quote_number like 'RLS-LIVE-%';
delete from public.purchases where invoice_number like 'RLS-LIVE-%';
delete from public.debts where customer_name like 'RLS Live%';
delete from public.expenses where title like 'RLS Live%';
delete from public.sales where product_id in (
  '30000000-0000-0000-0000-000000000101',
  '30000000-0000-0000-0000-000000000102'
);
delete from public.products where sku in ('RLS-LIVE-ADIA', 'RLS-LIVE-FIT');
delete from auth.identities where email in (
  'rajabsalum889+rlsmanageradia@gmail.com',
  'rajabsalum889+rlscashieradia@gmail.com',
  'rajabsalum889+rlsmanagerfit@gmail.com'
);
delete from auth.users where email in (
  'rajabsalum889+rlsmanageradia@gmail.com',
  'rajabsalum889+rlscashieradia@gmail.com',
  'rajabsalum889+rlsmanagerfit@gmail.com'
);

commit;
