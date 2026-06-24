-- Idempotency for offline sales sync.
-- Each app-created sale line gets a stable client_sale_id so retries cannot duplicate rows.

alter table public.sales
  add column if not exists client_sale_id text;

create unique index if not exists sales_client_sale_id_key
  on public.sales (client_sale_id);
