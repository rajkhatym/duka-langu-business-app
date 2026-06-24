-- Run this in Supabase SQL Editor for an existing database.
-- Admin can manage everything; staff can select products and insert sales only.

drop policy if exists "products_insert" on public.products;
create policy "products_insert"
  on public.products for insert
  to authenticated
  with check (public.is_admin());

drop policy if exists "products_update" on public.products;
create policy "products_update"
  on public.products for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "products_delete_admin" on public.products;
create policy "products_delete_admin"
  on public.products for delete
  to authenticated
  using (public.is_admin());

drop policy if exists "stock_movements_insert" on public.stock_movements;
create policy "stock_movements_insert"
  on public.stock_movements for insert
  to authenticated
  with check (public.is_admin());

drop policy if exists "stock_movements_delete_admin" on public.stock_movements;
create policy "stock_movements_delete_admin"
  on public.stock_movements for delete
  to authenticated
  using (public.is_admin());

drop policy if exists "sales_select" on public.sales;
create policy "sales_select"
  on public.sales for select
  to authenticated
  using (public.is_admin() or created_by = auth.uid());

drop policy if exists "sales_insert" on public.sales;
create policy "sales_insert"
  on public.sales for insert
  to authenticated
  with check (true);

drop policy if exists "sales_delete_admin" on public.sales;
create policy "sales_delete_admin"
  on public.sales for delete
  to authenticated
  using (public.is_admin());

drop policy if exists "expenses_select" on public.expenses;
create policy "expenses_select"
  on public.expenses for select
  to authenticated
  using (public.is_admin());

drop policy if exists "expenses_insert" on public.expenses;
create policy "expenses_insert"
  on public.expenses for insert
  to authenticated
  with check (public.is_admin());

drop policy if exists "expenses_delete_admin" on public.expenses;
create policy "expenses_delete_admin"
  on public.expenses for delete
  to authenticated
  using (public.is_admin());

drop policy if exists "debts_select" on public.debts;
create policy "debts_select"
  on public.debts for select
  to authenticated
  using (public.is_admin());

drop policy if exists "debts_insert" on public.debts;
create policy "debts_insert"
  on public.debts for insert
  to authenticated
  with check (public.is_admin());

drop policy if exists "debts_update" on public.debts;
create policy "debts_update"
  on public.debts for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "debts_delete_admin" on public.debts;
create policy "debts_delete_admin"
  on public.debts for delete
  to authenticated
  using (public.is_admin());
