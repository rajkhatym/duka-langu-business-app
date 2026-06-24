-- Temporary RLS role test data using the current owner account as the actor.
-- This avoids creating extra auth users. Run cleanup after checks.

begin;

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

insert into public.products (
  id,
  branch_id,
  name,
  sku,
  unit,
  category,
  quantity,
  reorder_level,
  cost_price,
  unit_price,
  created_by
)
values
  (
    '40000000-0000-0000-0000-000000000101',
    'adiasports',
    'RLS Owner Dumbbell adia',
    'RLS-OWNER-ADIA',
    'pcs',
    'Weights',
    5,
    1,
    10000,
    15000,
    (select id from auth.users where email = 'rajabsalum889@gmail.com')
  ),
  (
    '40000000-0000-0000-0000-000000000102',
    'fitness-empire',
    'RLS Owner Dumbbell fit',
    'RLS-OWNER-FIT',
    'pcs',
    'Weights',
    7,
    1,
    11000,
    17000,
    (select id from auth.users where email = 'rajabsalum889@gmail.com')
  );

insert into public.sales (
  branch_id,
  product_id,
  quantity,
  unit_price,
  amount_paid,
  customer_name,
  payment_status,
  payment_method,
  created_by
)
values
  (
    'adiasports',
    '40000000-0000-0000-0000-000000000101',
    1,
    15000,
    15000,
    'RLS Owner own cashier sale',
    'paid',
    'cash',
    (select id from auth.users where email = 'rajabsalum889@gmail.com')
  ),
  (
    'adiasports',
    '40000000-0000-0000-0000-000000000101',
    1,
    15000,
    15000,
    'RLS Owner other cashier sale',
    'paid',
    'cash',
    null
  ),
  (
    'fitness-empire',
    '40000000-0000-0000-0000-000000000102',
    1,
    17000,
    17000,
    'RLS Owner other branch sale',
    'paid',
    'cash',
    null
  );

insert into public.expenses (branch_id, title, category, amount, created_by)
values
  ('adiasports', 'RLS Owner expense adia', 'rent', 1000, (select id from auth.users where email = 'rajabsalum889@gmail.com')),
  ('fitness-empire', 'RLS Owner expense fit', 'rent', 2000, (select id from auth.users where email = 'rajabsalum889@gmail.com'));

insert into public.purchases (
  branch_id,
  supplier_name,
  invoice_number,
  product_id,
  quantity,
  cost_price,
  amount_paid,
  payment_status,
  created_by
)
values
  ('adiasports', 'RLS Owner Supplier adia', 'RLS-OWNER-INV-A', '40000000-0000-0000-0000-000000000101', 1, 10000, 10000, 'paid', (select id from auth.users where email = 'rajabsalum889@gmail.com')),
  ('fitness-empire', 'RLS Owner Supplier fit', 'RLS-OWNER-INV-F', '40000000-0000-0000-0000-000000000102', 1, 11000, 11000, 'paid', (select id from auth.users where email = 'rajabsalum889@gmail.com'));

insert into public.debts (
  branch_id,
  customer_name,
  description,
  amount,
  amount_paid,
  status,
  created_by
)
values
  ('adiasports', 'RLS Owner Debtor adia', 'test debt', 5000, 0, 'open', (select id from auth.users where email = 'rajabsalum889@gmail.com')),
  ('fitness-empire', 'RLS Owner Debtor fit', 'test debt', 6000, 0, 'open', (select id from auth.users where email = 'rajabsalum889@gmail.com'));

insert into public.quotations (
  branch_id,
  customer_name,
  quote_number,
  total_amount,
  status,
  created_by
)
values
  ('adiasports', 'RLS Owner Quote adia', 'RLS-OWNER-Q-A', 15000, 'draft', (select id from auth.users where email = 'rajabsalum889@gmail.com')),
  ('fitness-empire', 'RLS Owner Quote fit', 'RLS-OWNER-Q-F', 17000, 'draft', (select id from auth.users where email = 'rajabsalum889@gmail.com'));

commit;
