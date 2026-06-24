-- Temporary live RLS API test setup.
-- Creates test auth users and test branch data. Run cleanup after API checks.

begin;

create extension if not exists pgcrypto with schema extensions;

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
values
  (
    '30000000-0000-0000-0000-000000000201',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'rajabsalum889+rlsmanageradia@gmail.com',
    extensions.crypt('RlsTest@2026', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"RLS Live Manager adiasports"}'::jsonb,
    now(),
    now()
  ),
  (
    '30000000-0000-0000-0000-000000000202',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'rajabsalum889+rlscashieradia@gmail.com',
    extensions.crypt('RlsTest@2026', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"RLS Live Cashier adiasports"}'::jsonb,
    now(),
    now()
  ),
  (
    '30000000-0000-0000-0000-000000000203',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'rajabsalum889+rlsmanagerfit@gmail.com',
    extensions.crypt('RlsTest@2026', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"RLS Live Manager Fitness"}'::jsonb,
    now(),
    now()
  );

insert into auth.identities (
  provider_id,
  user_id,
  identity_data,
  provider,
  last_sign_in_at,
  created_at,
  updated_at
)
values
  (
    '30000000-0000-0000-0000-000000000201',
    '30000000-0000-0000-0000-000000000201',
    '{"sub":"30000000-0000-0000-0000-000000000201","email":"rajabsalum889+rlsmanageradia@gmail.com","full_name":"RLS Live Manager adiasports","email_verified":true,"phone_verified":false}'::jsonb,
    'email',
    now(),
    now(),
    now()
  ),
  (
    '30000000-0000-0000-0000-000000000202',
    '30000000-0000-0000-0000-000000000202',
    '{"sub":"30000000-0000-0000-0000-000000000202","email":"rajabsalum889+rlscashieradia@gmail.com","full_name":"RLS Live Cashier adiasports","email_verified":true,"phone_verified":false}'::jsonb,
    'email',
    now(),
    now(),
    now()
  ),
  (
    '30000000-0000-0000-0000-000000000203',
    '30000000-0000-0000-0000-000000000203',
    '{"sub":"30000000-0000-0000-0000-000000000203","email":"rajabsalum889+rlsmanagerfit@gmail.com","full_name":"RLS Live Manager Fitness","email_verified":true,"phone_verified":false}'::jsonb,
    'email',
    now(),
    now(),
    now()
  );

update public.profiles
set role = 'manager', branch_id = 'adiasports'
where id = '30000000-0000-0000-0000-000000000201';

update public.profiles
set role = 'cashier', branch_id = 'adiasports'
where id = '30000000-0000-0000-0000-000000000202';

update public.profiles
set role = 'manager', branch_id = 'fitness-empire'
where id = '30000000-0000-0000-0000-000000000203';

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
    '30000000-0000-0000-0000-000000000101',
    'adiasports',
    'RLS Live Dumbbell adia',
    'RLS-LIVE-ADIA',
    'pcs',
    'Weights',
    5,
    1,
    10000,
    15000,
    '30000000-0000-0000-0000-000000000201'
  ),
  (
    '30000000-0000-0000-0000-000000000102',
    'fitness-empire',
    'RLS Live Dumbbell fit',
    'RLS-LIVE-FIT',
    'pcs',
    'Weights',
    7,
    1,
    11000,
    17000,
    '30000000-0000-0000-0000-000000000203'
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
  ('adiasports', '30000000-0000-0000-0000-000000000101', 1, 15000, 15000, 'RLS Live Cashier own sale', 'paid', 'cash', '30000000-0000-0000-0000-000000000202'),
  ('adiasports', '30000000-0000-0000-0000-000000000101', 1, 15000, 15000, 'RLS Live Manager branch sale', 'paid', 'cash', '30000000-0000-0000-0000-000000000201'),
  ('fitness-empire', '30000000-0000-0000-0000-000000000102', 1, 17000, 17000, 'RLS Live Other branch sale', 'paid', 'cash', '30000000-0000-0000-0000-000000000203');

insert into public.expenses (branch_id, title, category, amount, created_by)
values
  ('adiasports', 'RLS Live expense adia', 'rent', 1000, '30000000-0000-0000-0000-000000000201'),
  ('fitness-empire', 'RLS Live expense fit', 'rent', 2000, '30000000-0000-0000-0000-000000000203');

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
  ('adiasports', 'RLS Live Supplier adia', 'RLS-LIVE-INV-A', '30000000-0000-0000-0000-000000000101', 1, 10000, 10000, 'paid', '30000000-0000-0000-0000-000000000201'),
  ('fitness-empire', 'RLS Live Supplier fit', 'RLS-LIVE-INV-F', '30000000-0000-0000-0000-000000000102', 1, 11000, 11000, 'paid', '30000000-0000-0000-0000-000000000203');

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
  ('adiasports', 'RLS Live Debtor adia', 'test debt', 5000, 0, 'open', '30000000-0000-0000-0000-000000000201'),
  ('fitness-empire', 'RLS Live Debtor fit', 'test debt', 6000, 0, 'open', '30000000-0000-0000-0000-000000000203');

insert into public.quotations (
  branch_id,
  customer_name,
  quote_number,
  total_amount,
  status,
  created_by
)
values
  ('adiasports', 'RLS Live Quote adia', 'RLS-LIVE-Q-A', 15000, 'draft', '30000000-0000-0000-0000-000000000201'),
  ('fitness-empire', 'RLS Live Quote fit', 'RLS-LIVE-Q-F', 17000, 'draft', '30000000-0000-0000-0000-000000000203');

commit;
