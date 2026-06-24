-- Development/demo-only RLS policies.
-- Use this while testing locally if the app is not forcing login yet.
-- For production, replace these with authenticated/business-scoped policies.

drop policy if exists "products_select_public_dev" on public.products;
create policy "products_select_public_dev"
  on public.products for select
  to anon, authenticated
  using (true);

drop policy if exists "products_insert_public_dev" on public.products;
create policy "products_insert_public_dev"
  on public.products for insert
  to anon, authenticated
  with check (true);

drop policy if exists "products_update_public_dev" on public.products;
create policy "products_update_public_dev"
  on public.products for update
  to anon, authenticated
  using (true)
  with check (true);

notify pgrst, 'reload schema';
