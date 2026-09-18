-- A Shopify checkout can create many personalized book jobs. Each job is one
-- Shopify line item; quantity represents identical copies of that customization.
alter table public.orders
  add column if not exists shopify_customization_id text;

-- Fail safely before adding uniqueness: existing duplicate page records need manual
-- review rather than silently selecting one customer's content.
do $$
begin
  if exists (
    select 1 from public.order_images
    group by order_id, page_number
    having count(*) > 1
  ) then
    raise exception 'Cannot add order_images page uniqueness: duplicate order_id/page_number rows exist.';
  end if;

  if exists (
    select 1 from public.orders
    where shopify_order_id is not null and shopify_line_item_id is not null
    group by shopify_order_id, shopify_line_item_id
    having count(*) > 1
  ) then
    raise exception 'Cannot add Shopify line-item uniqueness: duplicate checkout/line-item jobs exist.';
  end if;
end $$;

-- Earlier installations may have a one-checkout-per-orders-row uniqueness rule.
-- Remove only a single-column unique constraint/index on shopify_order_id.
do $$
declare
  v_attnum smallint;
  item record;
begin
  select attnum into v_attnum
  from pg_attribute
  where attrelid = 'public.orders'::regclass
    and attname = 'shopify_order_id'
    and not attisdropped;

  for item in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.orders'::regclass
      and c.contype = 'u'
      and c.conkey::smallint[] = array[v_attnum]
  loop
    execute format('alter table public.orders drop constraint %I', item.conname);
  end loop;

  for item in
    select i.indexrelid::regclass as index_name
    from pg_index i
    where i.indrelid = 'public.orders'::regclass
      and i.indisunique
      and not i.indisprimary
      and i.indkey::smallint[] = array[v_attnum]
  loop
    execute format('drop index if exists %s', item.index_name);
  end loop;
end $$;

create unique index if not exists orders_shopify_order_line_item_unique_idx
  on public.orders (shopify_order_id, shopify_line_item_id)
  where shopify_order_id is not null and shopify_line_item_id is not null;

create index if not exists orders_shopify_order_customization_idx
  on public.orders (shopify_order_id, shopify_customization_id)
  where shopify_customization_id is not null;

create unique index if not exists order_images_order_page_unique_idx
  on public.order_images (order_id, page_number);
