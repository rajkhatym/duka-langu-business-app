-- Transaction-safe sale recording.
-- Inserts sale rows and deducts stock inside one Postgres transaction.
-- It locks product rows, validates total requested quantity per product, and
-- skips rows already recorded with the same client_sale_id for offline idempotency.

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
begin
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'sale batch must be a json array';
  end if;

  create temporary table if not exists tmp_sale_batch (
    client_sale_id text,
    branch_id text,
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
      nullif(v_line->>'branch_id', ''),
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

  delete from tmp_sale_batch
  where client_sale_id is not null
    and exists (
      select 1
      from public.sales
      where public.sales.client_sale_id = tmp_sale_batch.client_sale_id
    );
  get diagnostics v_skipped = row_count;

  -- Lock every product row touched by this batch until the transaction commits.
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
  from tmp_sale_batch;

  get diagnostics v_inserted = row_count;

  return jsonb_build_object(
    'inserted', v_inserted,
    'skipped', v_skipped
  );
end;
$$;

grant execute on function public.record_sale_batch(jsonb) to authenticated;
