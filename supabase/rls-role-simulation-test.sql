-- End-to-end RLS role simulation.
-- This creates temporary test users/data inside one transaction and rolls it all back.
-- Expected result: every row below should be PASS.

begin;

create temp table rls_role_test_results (
  check_name text not null,
  status text not null,
  details jsonb not null default '{}'::jsonb
) on commit drop;

grant all on table rls_role_test_results to authenticated;

do $$
declare
  v_manager uuid := '10000000-0000-0000-0000-000000000101';
  v_cashier uuid := '10000000-0000-0000-0000-000000000102';
  v_other_manager uuid := '10000000-0000-0000-0000-000000000103';
  v_product_adia uuid := '20000000-0000-0000-0000-000000000101';
  v_product_fit uuid := '20000000-0000-0000-0000-000000000102';
begin
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
      v_manager,
      '00000000-0000-0000-0000-000000000000',
      'authenticated',
      'authenticated',
      'rls-manager-adiasports@example.test',
      '',
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"RLS Manager adiasports"}'::jsonb,
      now(),
      now()
    ),
    (
      v_cashier,
      '00000000-0000-0000-0000-000000000000',
      'authenticated',
      'authenticated',
      'rls-cashier-adiasports@example.test',
      '',
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"RLS Cashier adiasports"}'::jsonb,
      now(),
      now()
    ),
    (
      v_other_manager,
      '00000000-0000-0000-0000-000000000000',
      'authenticated',
      'authenticated',
      'rls-manager-fitness@example.test',
      '',
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"RLS Manager Fitness"}'::jsonb,
      now(),
      now()
    );

  update public.profiles
  set role = 'manager', branch_id = 'adiasports'
  where id = v_manager;

  update public.profiles
  set role = 'cashier', branch_id = 'adiasports'
  where id = v_cashier;

  update public.profiles
  set role = 'manager', branch_id = 'fitness-empire'
  where id = v_other_manager;

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
    (v_product_adia, 'adiasports', 'RLS Test Dumbbell adia', 'RLS-ADIA', 'pcs', 'Weights', 5, 1, 10000, 15000, v_manager),
    (v_product_fit, 'fitness-empire', 'RLS Test Dumbbell fitness', 'RLS-FIT', 'pcs', 'Weights', 7, 1, 11000, 17000, v_other_manager);

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
    ('adiasports', v_product_adia, 1, 15000, 15000, 'Cashier own sale', 'paid', 'cash', v_cashier),
    ('adiasports', v_product_adia, 1, 15000, 15000, 'Manager branch sale', 'paid', 'cash', v_manager),
    ('fitness-empire', v_product_fit, 1, 17000, 17000, 'Other branch sale', 'paid', 'cash', v_other_manager);

  insert into public.expenses (branch_id, title, category, amount, created_by)
  values
    ('adiasports', 'RLS Test rent adia', 'rent', 1000, v_manager),
    ('fitness-empire', 'RLS Test rent fitness', 'rent', 2000, v_other_manager);

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
    ('adiasports', 'RLS Supplier adia', 'RLS-INV-A', v_product_adia, 1, 10000, 10000, 'paid', v_manager),
    ('fitness-empire', 'RLS Supplier fit', 'RLS-INV-F', v_product_fit, 1, 11000, 11000, 'paid', v_other_manager);

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
    ('adiasports', 'RLS Debtor adia', 'test debt', 5000, 0, 'open', v_manager),
    ('fitness-empire', 'RLS Debtor fit', 'test debt', 6000, 0, 'open', v_other_manager);

  insert into public.quotations (
    branch_id,
    customer_name,
    quote_number,
    total_amount,
    status,
    created_by
  )
  values
    ('adiasports', 'RLS Quote adia', 'RLS-Q-A', 15000, 'draft', v_manager),
    ('fitness-empire', 'RLS Quote fit', 'RLS-Q-F', 17000, 'draft', v_other_manager);
end $$;

-- Cashier in adiasports: can see own branch products and own sales only.
set local role authenticated;
set local "request.jwt.claim.sub" = '10000000-0000-0000-0000-000000000102';
set local "request.jwt.claims" = '{"sub":"10000000-0000-0000-0000-000000000102","role":"authenticated"}';

insert into rls_role_test_results
select
  'cashier_sees_only_own_branch_products',
  case
    when count(*) filter (where id = '20000000-0000-0000-0000-000000000101') = 1
     and count(*) filter (where id = '20000000-0000-0000-0000-000000000102') = 0
    then 'PASS' else 'FAIL'
  end,
  jsonb_build_object('visible_test_products', count(*))
from public.products
where id in (
  '20000000-0000-0000-0000-000000000101',
  '20000000-0000-0000-0000-000000000102'
);

insert into rls_role_test_results
select
  'cashier_sees_only_own_sales',
  case
    when count(*) = 1
     and bool_and(created_by = '10000000-0000-0000-0000-000000000102')
    then 'PASS' else 'FAIL'
  end,
  jsonb_build_object('visible_test_sales', count(*))
from public.sales
where product_id in (
  '20000000-0000-0000-0000-000000000101',
  '20000000-0000-0000-0000-000000000102'
);

insert into rls_role_test_results
select
  'cashier_cannot_see_profit_finance_tables',
  case
    when
      (select count(*) from public.expenses where title ilike 'RLS Test%') = 0
      and (select count(*) from public.purchases where supplier_name ilike 'RLS Supplier%') = 0
      and (select count(*) from public.debts where customer_name ilike 'RLS Debtor%') = 0
      and (select count(*) from public.quotations where customer_name ilike 'RLS Quote%') = 0
    then 'PASS' else 'FAIL'
  end,
  jsonb_build_object(
    'expenses', (select count(*) from public.expenses where title ilike 'RLS Test%'),
    'purchases', (select count(*) from public.purchases where supplier_name ilike 'RLS Supplier%'),
    'debts', (select count(*) from public.debts where customer_name ilike 'RLS Debtor%'),
    'quotations', (select count(*) from public.quotations where customer_name ilike 'RLS Quote%')
  );

reset role;

-- Manager in adiasports: can see/manage own branch finance, but not Fitness Empire.
set local role authenticated;
set local "request.jwt.claim.sub" = '10000000-0000-0000-0000-000000000101';
set local "request.jwt.claims" = '{"sub":"10000000-0000-0000-0000-000000000101","role":"authenticated"}';

insert into rls_role_test_results
select
  'manager_sees_only_own_branch_products',
  case
    when count(*) filter (where id = '20000000-0000-0000-0000-000000000101') = 1
     and count(*) filter (where id = '20000000-0000-0000-0000-000000000102') = 0
    then 'PASS' else 'FAIL'
  end,
  jsonb_build_object('visible_test_products', count(*))
from public.products
where id in (
  '20000000-0000-0000-0000-000000000101',
  '20000000-0000-0000-0000-000000000102'
);

insert into rls_role_test_results
select
  'manager_sees_own_branch_sales_only',
  case
    when count(*) = 2
     and count(*) filter (where branch_id = 'fitness-empire') = 0
    then 'PASS' else 'FAIL'
  end,
  jsonb_build_object('visible_test_sales', count(*))
from public.sales
where product_id in (
  '20000000-0000-0000-0000-000000000101',
  '20000000-0000-0000-0000-000000000102'
);

insert into rls_role_test_results
select
  'manager_finance_is_branch_scoped',
  case
    when
      (select count(*) from public.expenses where title ilike 'RLS Test%') = 1
      and (select count(*) from public.expenses where branch_id = 'fitness-empire' and title ilike 'RLS Test%') = 0
      and (select count(*) from public.purchases where supplier_name ilike 'RLS Supplier%') = 1
      and (select count(*) from public.debts where customer_name ilike 'RLS Debtor%') = 1
      and (select count(*) from public.quotations where customer_name ilike 'RLS Quote%') = 1
    then 'PASS' else 'FAIL'
  end,
  jsonb_build_object(
    'expenses', (select count(*) from public.expenses where title ilike 'RLS Test%'),
    'purchases', (select count(*) from public.purchases where supplier_name ilike 'RLS Supplier%'),
    'debts', (select count(*) from public.debts where customer_name ilike 'RLS Debtor%'),
    'quotations', (select count(*) from public.quotations where customer_name ilike 'RLS Quote%')
  );

reset role;

select * from rls_role_test_results order by check_name;

rollback;
