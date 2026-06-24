-- Sales payment methods: cash, mobile money, bank, or credit.
alter table public.sales
  add column if not exists payment_method text not null default 'cash'
  check (payment_method in ('cash', 'mpesa', 'bank', 'credit'));

update public.sales
set payment_method = 'credit'
where payment_status = 'credit'
  and payment_method = 'cash';

create index if not exists sales_payment_method_idx on public.sales (payment_method);
