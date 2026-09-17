create table if not exists public.supplier_product_configurations (
  id uuid primary key default gen_random_uuid(),
  supplier text not null check (supplier in ('mixam', 'gelato')),
  configuration_key text not null,
  product_id integer,
  sub_product_id integer,
  quote_type text,
  item_specification_json jsonb not null,
  universal_key text,
  offer_id text,
  page_count integer not null,
  spine_mm numeric,
  currency text,
  price numeric,
  country_of_origin text,
  turnaround_days integer,
  print_on_demand_available boolean,
  raw_offer_json jsonb,
  validated_at timestamptz not null default now(),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (supplier, configuration_key)
);

create table if not exists public.supplier_fulfillments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  supplier text not null check (supplier in ('mixam', 'gelato')),
  configuration_id uuid references public.supplier_product_configurations(id),
  cover_pdf_url text,
  body_pdf_url text,
  supplier_order_id text,
  supplier_status text,
  artwork_validation_status text,
  quote_print_price numeric,
  quote_shipping_price numeric,
  quote_total numeric,
  quote_currency text,
  tracking_url text,
  error text,
  test_order boolean not null default true,
  submitted_at timestamptz,
  last_supplier_event_at timestamptz,
  raw_supplier_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, supplier)
);

create index if not exists supplier_fulfillments_supplier_order_id_idx
  on public.supplier_fulfillments (supplier, supplier_order_id);
