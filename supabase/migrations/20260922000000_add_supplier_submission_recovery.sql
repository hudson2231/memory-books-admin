alter table public.supplier_fulfillments
  add column if not exists submission_state text not null default 'not_sent',
  add column if not exists submission_claimed_at timestamptz,
  add column if not exists submission_attempted_at timestamptz,
  add column if not exists submission_confirmed_at timestamptz,
  add column if not exists submission_error_code text,
  add column if not exists submission_error_message text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'supplier_fulfillments_submission_state_check'
  ) then
    alter table public.supplier_fulfillments
      add constraint supplier_fulfillments_submission_state_check
      check (submission_state in ('not_sent', 'submitting', 'submission_unknown', 'supplier_confirmed'));
  end if;
end $$;

update public.supplier_fulfillments
set submission_state = case
  when supplier_order_id is not null then 'supplier_confirmed'
  when supplier_status in ('submitting_test_order', 'submitting') then 'submission_unknown'
  when supplier_status in ('submitted', 'submitted_test_order', 'submission_unknown') then 'submission_unknown'
  else 'not_sent'
end
where submission_state = 'not_sent';

update public.supplier_fulfillments
set submission_confirmed_at = coalesce(submission_confirmed_at, submitted_at, updated_at, created_at)
where submission_state = 'supplier_confirmed'
  and submission_confirmed_at is null;

insert into public.supplier_fulfillments (
  order_id,
  supplier,
  supplier_order_id,
  supplier_status,
  submission_state,
  submission_confirmed_at,
  submitted_at,
  test_order
)
select
  id,
  'gelato',
  gelato_order_id,
  coalesce(gelato_status, 'submitted'),
  'supplier_confirmed',
  coalesce(sent_to_gelato_at, created_at),
  sent_to_gelato_at,
  false
from public.orders
where gelato_order_id is not null
on conflict (order_id, supplier) do update
set
  supplier_order_id = coalesce(public.supplier_fulfillments.supplier_order_id, excluded.supplier_order_id),
  supplier_status = coalesce(public.supplier_fulfillments.supplier_status, excluded.supplier_status),
  submission_state = case
    when coalesce(public.supplier_fulfillments.supplier_order_id, excluded.supplier_order_id) is not null then 'supplier_confirmed'
    else public.supplier_fulfillments.submission_state
  end,
  submission_confirmed_at = coalesce(
    public.supplier_fulfillments.submission_confirmed_at,
    excluded.submission_confirmed_at
  );
