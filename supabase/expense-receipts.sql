-- Expense receipt attachments.
-- Run this once in Supabase SQL Editor before relying on receipt uploads.

alter table public.expenses
  add column if not exists receipt_file_name text,
  add column if not exists receipt_mime_type text,
  add column if not exists receipt_data_url text,
  add column if not exists receipt_storage_path text,
  add column if not exists receipt_attached_at timestamptz;

create index if not exists expenses_receipt_attached_at_idx
  on public.expenses (receipt_attached_at desc)
  where receipt_attached_at is not null;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'expense-receipts',
  'expense-receipts',
  false,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update
set
  public = false,
  file_size_limit = 2097152,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

drop policy if exists "expense_receipts_select_authenticated" on storage.objects;
create policy "expense_receipts_select_authenticated"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'expense-receipts');

drop policy if exists "expense_receipts_insert_authenticated" on storage.objects;
create policy "expense_receipts_insert_authenticated"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'expense-receipts' and owner = auth.uid());

drop policy if exists "expense_receipts_update_owner" on storage.objects;
create policy "expense_receipts_update_owner"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'expense-receipts' and owner = auth.uid())
  with check (bucket_id = 'expense-receipts' and owner = auth.uid());

drop policy if exists "expense_receipts_delete_owner" on storage.objects;
create policy "expense_receipts_delete_owner"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'expense-receipts' and (owner = auth.uid() or public.is_admin()));
