-- Live hardening for branch stock truth, transaction-safe sales, and stock permissions.
-- Run this in Supabase SQL editor before using real daily sales.

alter table public.products
  add column if not exists branch_id text references public.branches (id) default 'adiasports';

alter table public.stock_movements
  add column if not exists branch_id text references public.branches (id) default 'adiasports';

alter table public.sales
  add column if not exists branch_id text references public.branches (id) default 'adiasports',
  add column if not exists client_sale_id text,
  add column if not exists sale_number text;

update public.products set branch_id = 'adiasports' where branch_id is null;
update public.stock_movements set branch_id = 'adiasports' where branch_id is null;
update public.sales set branch_id = 'adiasports' where branch_id is null;

alter table public.products alter column branch_id set not null;
alter table public.stock_movements alter column branch_id set not null;
alter table public.sales alter column branch_id set not null;

create unique index if not exists sales_client_sale_id_key
  on public.sales (client_sale_id)
  where client_sale_id is not null;

create index if not exists products_branch_id_idx on public.products (branch_id);
create index if not exists stock_movements_branch_id_idx on public.stock_movements (branch_id);
create index if not exists sales_branch_id_idx on public.sales (branch_id);

create or replace function public.protect_product_quantity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('app.allow_stock_write', true) = 'on' then
    return new;
  end if;

  if new.quantity <> old.quantity then
    raise exception 'Product quantity can only change through stock movements or record_sale_batch.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_protect_product_quantity on public.products;
create trigger trg_protect_product_quantity
before update on public.products
for each row execute function public.protect_product_quantity();

create or replace function public.adjust_product_quantity(p_product_id uuid, p_delta numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new numeric;
  v_exists boolean;
begin
  perform set_config('app.allow_stock_write', 'on', true);

  update public.products
  set quantity = quantity + p_delta
  where id = p_product_id
    and quantity + p_delta >= 0
  returning quantity into v_new;

  if v_new is not null then
    return;
  end if;

  select exists(select 1 from public.products where id = p_product_id) into v_exists;
  if not v_exists then
    raise exception 'Product haijapatikana kwenye stock: %', p_product_id;
  end if;

  raise exception 'Stock haitoshi kwa bidhaa %. Huna bidhaa za kutosha stoo.', p_product_id;
end;
$$;

create or replace function public.record_sale_batch(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer := 0;
  v_skipped integer := 0;
  v_line jsonb;
  v_available numeric;
  v_needed numeric;
  v_product_id uuid;
  v_sale_ids uuid[];
begin
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'sale batch must be a json array';
  end if;

  create temporary table if not exists tmp_sale_batch (
    client_sale_id text,
    branch_id text not null,
    product_id uuid not null,
    quantity numeric not null,
    unit_price numeric not null,
    amount_paid numeric not null,
    customer_name text,
    payment_status text not null,
    payment_method text,
    note text,
    created_by uuid
  ) on commit drop;

  truncate table tmp_sale_batch;

  for v_line in select * from jsonb_array_elements(p_rows)
  loop
    insert into tmp_sale_batch (
      client_sale_id,
      branch_id,
      product_id,
      quantity,
      unit_price,
      amount_paid,
      customer_name,
      payment_status,
      payment_method,
      note,
      created_by
    )
    values (
      nullif(v_line->>'client_sale_id', ''),
      coalesce(nullif(v_line->>'branch_id', ''), public.user_branch_id()),
      (v_line->>'product_id')::uuid,
      (v_line->>'quantity')::numeric,
      (v_line->>'unit_price')::numeric,
      coalesce((v_line->>'amount_paid')::numeric, 0),
      nullif(v_line->>'customer_name', ''),
      coalesce(nullif(v_line->>'payment_status', ''), 'paid'),
      nullif(v_line->>'payment_method', ''),
      nullif(v_line->>'note', ''),
      coalesce(nullif(v_line->>'created_by', '')::uuid, auth.uid())
    );
  end loop;

  if exists (select 1 from tmp_sale_batch where quantity <= 0 or unit_price < 0 or amount_paid < 0) then
    raise exception 'Invalid sale row: quantity, price, or payment amount is not valid';
  end if;

  if exists (select 1 from tmp_sale_batch where not public.can_access_branch(branch_id)) then
    raise exception 'Huna ruhusa ya kuuza kwenye branch hii.';
  end if;

  if exists (
    select 1
    from tmp_sale_batch b
    join public.products p on p.id = b.product_id
    where p.branch_id <> b.branch_id
  ) then
    raise exception 'Bidhaa na branch hazilingani. Refresh stock kisha jaribu tena.';
  end if;

  delete from tmp_sale_batch
  where client_sale_id is not null
    and exists (
      select 1
      from public.sales
      where public.sales.client_sale_id = tmp_sale_batch.client_sale_id
    );
  get diagnostics v_skipped = row_count;

  perform 1
  from public.products
  where id in (select distinct product_id from tmp_sale_batch)
  for update;

  for v_product_id, v_needed in
    select product_id, sum(quantity)
    from tmp_sale_batch
    group by product_id
  loop
    select quantity into v_available
    from public.products
    where id = v_product_id;

    if v_available is null then
      raise exception 'Product haijapatikana kwenye stock: %', v_product_id;
    end if;

    if v_available < v_needed then
      raise exception 'Stock haitoshi: bidhaa % ina %, umeomba %', v_product_id, v_available, v_needed;
    end if;
  end loop;

  with inserted as (
    insert into public.sales (
      client_sale_id,
      branch_id,
      product_id,
      quantity,
      unit_price,
      amount_paid,
      customer_name,
      payment_status,
      payment_method,
      note,
      created_by
    )
    select
      client_sale_id,
      branch_id,
      product_id,
      quantity,
      unit_price,
      amount_paid,
      customer_name,
      payment_status,
      payment_method,
      note,
      created_by
    from tmp_sale_batch
    returning id, created_at, client_sale_id
  )
  select array_agg(id order by created_at, client_sale_id)
  into v_sale_ids
  from inserted;

  v_inserted := coalesce(array_length(v_sale_ids, 1), 0);

  return jsonb_build_object(
    'inserted', v_inserted,
    'skipped', v_skipped,
    'sale_ids', coalesce(to_jsonb(v_sale_ids), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.record_sale_batch(jsonb) to authenticated;

drop policy if exists "products_insert" on public.products;
create policy "products_insert"
  on public.products for insert
  to authenticated
  with check (public.is_owner() and public.can_access_branch(branch_id));

drop policy if exists "products_update" on public.products;
create policy "products_update"
  on public.products for update
  to authenticated
  using (public.is_owner() and public.can_access_branch(branch_id))
  with check (public.is_owner() and public.can_access_branch(branch_id));

drop policy if exists "products_delete_admin" on public.products;
create policy "products_delete_admin"
  on public.products for delete
  to authenticated
  using (public.is_owner() and public.can_access_branch(branch_id));

drop policy if exists "stock_movements_insert" on public.stock_movements;
create policy "stock_movements_insert"
  on public.stock_movements for insert
  to authenticated
  with check (public.is_owner() and public.can_access_branch(branch_id));

drop policy if exists "stock_movements_delete_admin" on public.stock_movements;
create policy "stock_movements_delete_admin"
  on public.stock_movements for delete
  to authenticated
  using (public.is_owner() and public.can_access_branch(branch_id));

create table if not exists public.stock_transfers (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete restrict,
  from_branch_id text not null references public.branches (id),
  to_branch_id text not null references public.branches (id),
  quantity numeric not null check (quantity > 0),
  note text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  check (from_branch_id <> to_branch_id)
);

alter table public.stock_transfers enable row level security;

create index if not exists stock_transfers_created_at_idx on public.stock_transfers (created_at desc);
create index if not exists stock_transfers_from_branch_idx on public.stock_transfers (from_branch_id);
create index if not exists stock_transfers_to_branch_idx on public.stock_transfers (to_branch_id);

drop policy if exists "stock_transfers_select" on public.stock_transfers;
drop policy if exists "stock_transfers_select_branch_manager" on public.stock_transfers;
create policy "stock_transfers_select_branch_manager"
  on public.stock_transfers for select
  to authenticated
  using (public.can_access_branch(from_branch_id) or public.can_access_branch(to_branch_id));

drop policy if exists "stock_transfers_insert_manager" on public.stock_transfers;
create policy "stock_transfers_insert_manager"
  on public.stock_transfers for insert
  to authenticated
  with check (public.can_manage_branch(from_branch_id));

create or replace function public.record_stock_transfer(
  p_product_id uuid,
  p_from_branch_id text,
  p_to_branch_id text,
  p_quantity numeric,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source public.products%rowtype;
  v_destination_product_id uuid;
  v_transfer_id uuid;
  v_note text;
begin
  if p_from_branch_id = p_to_branch_id then
    raise exception 'Branch ya kutoka na kwenda haziwezi kufanana.';
  end if;

  if p_quantity <= 0 then
    raise exception 'Quantity ya transfer lazima iwe zaidi ya 0.';
  end if;

  if not public.can_manage_branch(p_from_branch_id) then
    raise exception 'Huna ruhusa ya kuhamisha stock kutoka branch hii.';
  end if;

  select *
  into v_source
  from public.products
  where id = p_product_id
    and branch_id = p_from_branch_id
  for update;

  if v_source.id is null then
    raise exception 'Bidhaa haipo kwenye branch hii.';
  end if;

  if v_source.quantity < p_quantity then
    raise exception 'Stock haitoshi. Ipo %, umeomba %.', v_source.quantity, p_quantity;
  end if;

  select id
  into v_destination_product_id
  from public.products
  where branch_id = p_to_branch_id
    and (
      (v_source.sku is not null and sku = v_source.sku)
      or (v_source.sku is null and lower(name) = lower(v_source.name))
    )
  limit 1;

  if v_destination_product_id is null then
    insert into public.products (
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
    values (
      p_to_branch_id,
      v_source.name,
      v_source.sku,
      v_source.unit,
      v_source.category,
      0,
      v_source.reorder_level,
      v_source.cost_price,
      v_source.unit_price,
      auth.uid()
    )
    returning id into v_destination_product_id;
  end if;

  insert into public.stock_transfers (
    product_id,
    from_branch_id,
    to_branch_id,
    quantity,
    note,
    created_by
  )
  values (
    p_product_id,
    p_from_branch_id,
    p_to_branch_id,
    p_quantity,
    p_note,
    auth.uid()
  )
  returning id into v_transfer_id;

  v_note := coalesce(p_note, 'Branch transfer');

  insert into public.stock_movements (
    branch_id,
    product_id,
    type,
    quantity,
    note,
    created_by
  )
  values
    (p_from_branch_id, p_product_id, 'OUT', p_quantity, v_note || ' kwenda ' || p_to_branch_id, auth.uid()),
    (p_to_branch_id, v_destination_product_id, 'IN', p_quantity, v_note || ' kutoka ' || p_from_branch_id, auth.uid());

  return jsonb_build_object(
    'transfer_id', v_transfer_id,
    'from_product_id', p_product_id,
    'to_product_id', v_destination_product_id,
    'quantity', p_quantity
  );
end;
$$;

grant execute on function public.record_stock_transfer(uuid, text, text, numeric, text) to authenticated;

drop policy if exists "purchases_insert" on public.purchases;
create policy "purchases_insert"
  on public.purchases for insert
  to authenticated
  with check (public.is_owner() and public.can_access_branch(branch_id));

drop policy if exists "purchases_update" on public.purchases;
create policy "purchases_update"
  on public.purchases for update
  to authenticated
  using (public.is_owner() and public.can_access_branch(branch_id))
  with check (public.is_owner() and public.can_access_branch(branch_id));

drop policy if exists "sales_insert" on public.sales;
create policy "sales_insert"
  on public.sales for insert
  to authenticated
  with check (public.can_access_branch(branch_id) and created_by = auth.uid());

drop policy if exists "sales_update" on public.sales;

drop policy if exists "sales_delete_admin" on public.sales;
create policy "sales_delete_admin"
  on public.sales for delete
  to authenticated
  using (public.can_manage_branch(branch_id));

create table if not exists public.store_log_book (
  id uuid primary key default gen_random_uuid(),
  branch_id text not null references public.branches(id),
  movement_type text not null default 'store_to_shop',
  status text not null default 'pending',
  person_name text not null,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  quantity numeric not null check (quantity > 0),
  unit text,
  note text,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  approval_note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.store_log_book
  add column if not exists movement_type text not null default 'store_to_shop',
  add column if not exists status text not null default 'pending',
  add column if not exists approved_by uuid references auth.users(id),
  add column if not exists approved_at timestamptz,
  add column if not exists approval_note text;

alter table public.store_log_book
  drop constraint if exists store_log_book_movement_type_check,
  add constraint store_log_book_movement_type_check
    check (movement_type in ('store_to_shop', 'store_to_customer', 'store_to_branch', 'return_to_store'));

alter table public.store_log_book
  drop constraint if exists store_log_book_status_check,
  add constraint store_log_book_status_check
    check (status in ('pending', 'approved', 'rejected'));

create index if not exists store_log_book_branch_created_idx
  on public.store_log_book(branch_id, created_at desc);

create index if not exists store_log_book_product_idx
  on public.store_log_book(product_id);

alter table public.store_log_book enable row level security;

drop policy if exists "store_log_book_select_branch_users" on public.store_log_book;
create policy "store_log_book_select_branch_users"
  on public.store_log_book for select
  to authenticated
  using (public.can_access_branch(branch_id));

drop policy if exists "store_log_book_insert_branch_users" on public.store_log_book;
create policy "store_log_book_insert_branch_users"
  on public.store_log_book for insert
  to authenticated
  with check (
    public.can_access_branch(branch_id)
    and created_by = auth.uid()
  );

drop policy if exists "store_log_book_update_manager_owner" on public.store_log_book;
create policy "store_log_book_update_manager_owner"
  on public.store_log_book for update
  to authenticated
  using (public.can_manage_branch(branch_id))
  with check (
    public.can_manage_branch(branch_id)
    and approved_by = auth.uid()
    and status in ('approved', 'rejected')
  );

drop policy if exists "store_log_book_delete_owner" on public.store_log_book;
create policy "store_log_book_delete_owner"
  on public.store_log_book for delete
  to authenticated
  using (public.is_owner() and public.can_access_branch(branch_id));

do $$
begin
  if exists (
    select 1
    from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname = 'write_audit_log'
  ) then
    drop trigger if exists trg_audit_store_log_book on public.store_log_book;
    create trigger trg_audit_store_log_book
    after insert or update or delete on public.store_log_book
    for each row execute function public.write_audit_log();
  end if;
end $$;
