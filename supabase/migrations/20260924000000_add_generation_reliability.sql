alter table public.order_images
  add column if not exists generation_claim_id uuid,
  add column if not exists generation_claimed_at timestamptz,
  add column if not exists generation_attempted_at timestamptz,
  add column if not exists generation_error_code text,
  add column if not exists generation_attempt_count integer not null default 0;

-- Preserve every usable historical result.  Rows stranded in `generating` have
-- no durable worker ownership and become safely retryable failures.
update public.order_images
set status = 'generated'
where nullif(trim(coalesce(generated_url, '')), '') is not null
  and (status is null or status in ('uploaded', 'failed', 'generating', 'not_generated'));

update public.order_images
set
  status = 'failed',
  error_message = coalesce(error_message, 'Generation claim predates durable claim tracking; retry this page.'),
  generation_error_code = coalesce(generation_error_code, 'legacy_generating_claim')
where nullif(trim(coalesce(generated_url, '')), '') is null
  and status = 'generating';

update public.order_images
set status = 'uploaded'
where nullif(trim(coalesce(generated_url, '')), '') is null
  and (status is null or status = 'generated');

create table if not exists public.generation_provider_slots (
  provider text not null check (provider in ('gemini', 'fal')),
  slot_number smallint not null check (slot_number > 0),
  lease_id uuid,
  claimed_at timestamptz,
  lease_expires_at timestamptz,
  primary key (provider, slot_number)
);

alter table public.generation_provider_slots enable row level security;

-- Gemini and Fal use separate provider accounts.  Keep both intentionally
-- below the old per-order fan-out: two Gemini calls and three Fal calls total. A lease is six minutes, longer than the five-minute route limit.
insert into public.generation_provider_slots (provider, slot_number)
values
  ('gemini', 1), ('gemini', 2),
  ('fal', 1), ('fal', 2), ('fal', 3)
on conflict do nothing;

create or replace function public.claim_order_image_generation(
  p_image_id uuid,
  p_claim_id uuid,
  p_allow_regenerate boolean,
  p_stale_before timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  image_row public.order_images%rowtype;
  had_output boolean;
begin
  select * into image_row
  from public.order_images
  where id = p_image_id
  for update;

  if not found then
    return jsonb_build_object('claimed', false, 'reason', 'not_retryable');
  end if;

  had_output := nullif(trim(coalesce(image_row.generated_url, '')), '') is not null;

  if image_row.status = 'generating' then
    if image_row.generation_claimed_at is null or image_row.generation_claimed_at < p_stale_before then
      update public.order_images
      set
        status = case when had_output then 'generated' else 'failed' end,
        generation_claim_id = null,
        generation_claimed_at = null,
        generation_attempted_at = null,
        generation_error_code = 'stale_generation_claim',
        error_message = 'Generation claim expired before a durable result was saved. Retry this page.'
      where id = image_row.id
        and status = 'generating'
        and generation_claim_id is not distinct from image_row.generation_claim_id
        and generation_claimed_at is not distinct from image_row.generation_claimed_at;
      return jsonb_build_object('claimed', false, 'reason', 'stale_claim_resolved', 'previous_status', image_row.status, 'had_generated_output', had_output);
    end if;
    return jsonb_build_object('claimed', false, 'reason', 'in_progress', 'previous_status', image_row.status, 'had_generated_output', had_output);
  end if;

  if had_output and not p_allow_regenerate then
    return jsonb_build_object('claimed', false, 'reason', 'generated', 'previous_status', image_row.status, 'had_generated_output', true);
  end if;

  if not p_allow_regenerate and image_row.status not in ('uploaded', 'failed', 'not_generated') then
    return jsonb_build_object('claimed', false, 'reason', 'not_retryable', 'previous_status', image_row.status, 'had_generated_output', had_output);
  end if;

  update public.order_images
  set
    status = 'generating',
    generation_claim_id = p_claim_id,
    generation_claimed_at = now(),
    generation_attempted_at = null,
    generation_attempt_count = coalesce(generation_attempt_count, 0) + 1,
    generation_error_code = null,
    error_message = null
  where id = image_row.id;

  return jsonb_build_object('claimed', true, 'reason', 'claimed', 'previous_status', image_row.status, 'had_generated_output', had_output);
end;
$$;

create or replace function public.claim_generation_provider_slot(
  p_provider text,
  p_lease_id uuid,
  p_lease_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed_slot smallint;
begin
  with candidate as (
    select slot_number
    from public.generation_provider_slots
    where provider = p_provider
      and (lease_id is null or lease_expires_at is null or lease_expires_at < now())
    order by slot_number
    for update skip locked
    limit 1
  )
  update public.generation_provider_slots slots
  set lease_id = p_lease_id,
      claimed_at = now(),
      lease_expires_at = p_lease_expires_at
  from candidate
  where slots.provider = p_provider
    and slots.slot_number = candidate.slot_number
  returning slots.slot_number into claimed_slot;

  if claimed_slot is null then
    return jsonb_build_object('claimed', false);
  end if;
  return jsonb_build_object('claimed', true, 'slot_number', claimed_slot);
end;
$$;

revoke all on function public.claim_order_image_generation(uuid, uuid, boolean, timestamptz) from public, anon, authenticated;
revoke all on function public.claim_generation_provider_slot(text, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.claim_order_image_generation(uuid, uuid, boolean, timestamptz) to service_role;
grant execute on function public.claim_generation_provider_slot(text, uuid, timestamptz) to service_role;
