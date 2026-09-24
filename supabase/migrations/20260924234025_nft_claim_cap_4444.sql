lock table public.zecblocks_events,public.zecblocks_claim_availability,public.zecblocks_ownership_events,public.zecblocks_tokens,public.zecblocks_mining_reservations in share row exclusive mode;
-- Claim count is independent of legacy token IDs (1..5000).
create table public.zecblocks_claim_slots (
  token_id integer primary key check (token_id between 1 and 5000),
  slot_no integer not null unique check (slot_no between 1 and 4444),
  state text not null check (state in ('legacy','reserved','submitting','confirmed')),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.zecblocks_claim_slots enable row level security;
revoke all on public.zecblocks_claim_slots from public, anon, authenticated;
grant select on public.zecblocks_claim_slots to service_role;

-- Every admission path takes this lock before allocating a unique bounded slot.
-- The slot_no constraint also makes >4444 distinct admitted IDs impossible.
create function public.zecblocks_claim_admit(p_token_id integer,p_state text,p_expires_at timestamptz default null)
returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
declare old_slot public.zecblocks_claim_slots%rowtype; free_slot integer;
begin
  if p_token_id is null or p_token_id not between 1 and 5000
     or p_state is null or p_state not in ('legacy','reserved','submitting','confirmed') then raise exception 'Invalid claim slot'; end if;
  if p_state='reserved' and (p_expires_at is null or p_expires_at<=now()) then return false; end if;
  perform pg_advisory_xact_lock(4444,5000);
  -- A wallet may already have broadcast after submitting. Those slots never expire.
  delete from public.zecblocks_claim_slots where state='reserved' and expires_at<=now();
  select * into old_slot from public.zecblocks_claim_slots where token_id=p_token_id;
  if found then
    update public.zecblocks_claim_slots set
      state=case when old_slot.state='confirmed' or p_state='confirmed' then 'confirmed'
        when old_slot.state='legacy' then 'legacy'
        when old_slot.state='submitting' or p_state='submitting' then 'submitting' else p_state end,
      expires_at=case when old_slot.state='reserved' and p_state='reserved' then greatest(old_slot.expires_at,p_expires_at) else null end,
      updated_at=now() where token_id=p_token_id;
    return true;
  end if;
  select n into free_slot from generate_series(1,4444) n
    where not exists(select 1 from public.zecblocks_claim_slots s where s.slot_no=n) order by n limit 1;
  if free_slot is null then return false; end if;
  insert into public.zecblocks_claim_slots(token_id,slot_no,state,expires_at)
    values(p_token_id,free_slot,p_state,case when p_state='reserved' then p_expires_at else null end);
  return true;
end $$;
revoke all on function public.zecblocks_claim_admit(integer,text,timestamptz) from public,anon,authenticated;
grant execute on function public.zecblocks_claim_admit(integer,text,timestamptz) to service_role;

create function public.zecblocks_claim_capacity()
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
  with used as (select count(*)::integer n from public.zecblocks_claim_slots where state<>'reserved' or expires_at>now()),
  confirmed as (select count(*)::integer n from public.zecblocks_claim_availability where status='claimed')
  select jsonb_build_object('claim_limit',4444,'legacy_id_max',5000,
    'allocated_claims',used.n,'slots_available',greatest(0,4444-used.n),
    'claims_remaining',greatest(0,4444-confirmed.n),'claim_open',confirmed.n<4444,
    'new_claims_open',used.n<4444) from used,confirmed;
$$;
revoke all on function public.zecblocks_claim_capacity() from public;
grant execute on function public.zecblocks_claim_capacity() to anon,authenticated,service_role;

-- Initial ownership and unresolved claim history retain admission. No token is
-- deleted, renumbered, transferred, minted to the team or marked confirmed here.
with protected as (
  select token_id from public.zecblocks_tokens
  union select token_id from public.zecblocks_claim_availability where status in ('claimed','claimed_pending')
  union select token_id from public.zecblocks_ownership_events where event_type='claim' and verified_level in ('full','chain','signature')
  union select token_id from public.zecblocks_events where event_type='CLAIM' and protocol_audited is true and chain_confirmed is true and verification_status='verified'
), numbered as (select token_id,row_number() over(order by token_id)::integer n from protected where token_id between 1 and 5000)
insert into public.zecblocks_claim_slots(token_id,slot_no,state)
select token_id,n,case when exists(select 1 from public.zecblocks_claim_availability a where a.token_id=numbered.token_id and a.status='claimed') then 'confirmed' else 'legacy' end from numbered;

create function public.zecblocks_claim_cap_event_guard()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare admission text;
begin
  if TG_TABLE_NAME='zecblocks_events' then
    if new.event_type='CLAIM' and new.protocol_audited is true and new.chain_confirmed is true and new.verification_status='verified' then admission:='confirmed'; end if;
  elsif TG_TABLE_NAME='zecblocks_ownership_events' then
    if new.event_type='claim' and new.verified_level in ('signature','chain','full') then admission:=case when new.verified_level='full' then 'confirmed' else 'submitting' end; end if;
  elsif TG_TABLE_NAME='zecblocks_tokens' then
    admission:=case when new.owner_verified_level='full' then 'confirmed' else 'submitting' end;
  elsif TG_TABLE_NAME='zecblocks_claim_availability' then
    if new.status='claimed' then admission:='confirmed'; end if;
  end if;
  if admission is not null and not public.zecblocks_claim_admit(new.token_id,admission) then
    raise exception using errcode='P0001',message='ZB1_CLAIM_CAP_REACHED',detail='The current phase admits at most 4,444 unique NFT claims. Existing admitted IDs remain recoverable.';
  end if;
  return new;
end $$;
revoke all on function public.zecblocks_claim_cap_event_guard() from public,anon,authenticated;
create trigger zz_zecblocks_claim_cap before insert or update on public.zecblocks_events for each row execute function public.zecblocks_claim_cap_event_guard();
create trigger zz_zecblocks_claim_cap before insert or update on public.zecblocks_ownership_events for each row execute function public.zecblocks_claim_cap_event_guard();
create trigger zz_zecblocks_claim_cap before insert or update on public.zecblocks_tokens for each row execute function public.zecblocks_claim_cap_event_guard();
create trigger zz_zecblocks_claim_cap before insert or update on public.zecblocks_claim_availability for each row execute function public.zecblocks_claim_cap_event_guard();

-- Preserve active leases during rollout. Abort the migration if already over cap.
do $$ declare r record; begin
  for r in select token_id,expires_at from public.zecblocks_mining_reservations where status='active' and expires_at>now() loop
    if not public.zecblocks_claim_admit(r.token_id,'reserved',r.expires_at) then raise exception 'Existing claims and leases exceed 4444'; end if;
  end loop;
end $$;


CREATE OR REPLACE FUNCTION public.zecblocks_reserve_specific_clear_token(p_owner_commitment text, p_token_id integer, p_ttl_seconds integer DEFAULT 600)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$;
declare
  v_owner text := lower(replace(coalesce(p_owner_commitment,''),'0x',''));
  v_ttl integer := greatest(120,least(1200,coalesce(p_ttl_seconds,600)));
  v_row public.zecblocks_claim_availability%rowtype;
  v_existing public.zecblocks_mining_reservations%rowtype;
  v_lease text;
begin
  if v_owner !~ '^[0-9a-f]{64}$' then raise exception 'invalid owner commitment'; end if;
  if p_token_id<1 or p_token_id>5000 then raise exception 'invalid token id'; end if;

  perform pg_advisory_xact_lock(4444,5000);
  delete from public.zecblocks_mining_reservations
  where status<>'active' or expires_at<=now();

  select * into v_row
  from public.zecblocks_claim_availability
  where token_id=p_token_id
  for update;

  if not found or v_row.status<>'clear' or v_row.relay_quorum<4
     or v_row.last_checked_at is null or v_row.last_checked_at<=now()-interval '2 minutes' then
    return jsonb_build_object('ok',false,'error','TOKEN_NOT_FRESH_CLEAR','status',coalesce(v_row.status,'unknown'));
  end if;

  if exists(
    select 1 from public.zecblocks_events e
    where e.event_type='CLAIM_INTENT'
      and e.token_id=p_token_id
      and e.protocol_audited=true
      and e.valid_signature=true
      and e.verification_status='verified'
      and case
        when coalesce(e.payload->>'expires','') ~ '^[0-9]+$'
        then (e.payload->>'expires')::bigint
        else 0
      end > extract(epoch from now())::bigint
  ) then
    return jsonb_build_object('ok',false,'error','TOKEN_SUBMITTING');
  end if;

  select * into v_existing
  from public.zecblocks_mining_reservations
  where token_id=p_token_id and status='active' and expires_at>now()
  for update;

  if found then
    if v_existing.owner_commitment=v_owner then
      if not public.zecblocks_claim_admit(p_token_id,'reserved',now()+make_interval(secs=>v_ttl)) then return jsonb_build_object('ok',false,'error',case when (public.zecblocks_claim_capacity()->>'claim_open')::boolean then 'CLAIM_SLOTS_PENDING' else 'CLAIM_CAP_REACHED' end)||public.zecblocks_claim_capacity(); end if;
      update public.zecblocks_mining_reservations
      set renewed_at=now(),expires_at=now()+make_interval(secs=>v_ttl)
      where token_id=p_token_id;
      return jsonb_build_object(
        'ok',true,'token_id',p_token_id,'lease_token',v_existing.lease_token,
        'expires_at',extract(epoch from (now()+make_interval(secs=>v_ttl)))::bigint,'reused',true
      );
    end if;
    return jsonb_build_object('ok',false,'error','TOKEN_RESERVED');
  end if;

  if exists(
    select 1 from public.zecblocks_events e
    where e.event_type='CLAIM'
      and e.token_id=p_token_id
      and e.verification_status in ('verified','pending','deferred')
      and coalesce(e.source,'')<>'client-backfill'
  ) then
    return jsonb_build_object('ok',false,'error','TOKEN_HAS_CLAIM_ACTIVITY');
  end if;

  if not public.zecblocks_claim_admit(p_token_id,'reserved',now()+make_interval(secs=>v_ttl)) then return jsonb_build_object('ok',false,'error',case when (public.zecblocks_claim_capacity()->>'claim_open')::boolean then 'CLAIM_SLOTS_PENDING' else 'CLAIM_CAP_REACHED' end)||public.zecblocks_claim_capacity(); end if;
  v_lease:=encode(gen_random_bytes(24),'hex');
  insert into public.zecblocks_mining_reservations(
    token_id,owner_commitment,lease_token,created_at,renewed_at,expires_at,status
  )
  values(
    p_token_id,v_owner,v_lease,now(),now(),now()+make_interval(secs=>v_ttl),'active'
  );

  return jsonb_build_object(
    'ok',true,'token_id',p_token_id,'lease_token',v_lease,
    'expires_at',extract(epoch from (now()+make_interval(secs=>v_ttl)))::bigint,'reused',false
  );
end;
$function$;



CREATE OR REPLACE FUNCTION public.zecblocks_renew_reservation(p_owner_commitment text, p_token_id integer, p_lease_token text, p_ttl_seconds integer DEFAULT 600)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$;
declare
  v_owner text := lower(replace(coalesce(p_owner_commitment,''),'0x',''));
  v_ttl integer := greatest(120,least(1200,coalesce(p_ttl_seconds,600)));
  v_row public.zecblocks_claim_availability%rowtype;
  v_own_submitting boolean := false;
begin
  if v_owner !~ '^[0-9a-f]{64}$' then raise exception 'invalid owner commitment'; end if;

  perform pg_advisory_xact_lock(4444,5000);
  select * into v_row
  from public.zecblocks_claim_availability
  where token_id=p_token_id;

  if found then
    select exists(
      select 1 from public.zecblocks_events e
      where e.event_type='CLAIM_INTENT'
        and e.token_id=p_token_id
        and e.protocol_audited=true
        and e.valid_signature=true
        and e.verification_status='verified'
        and lower(replace(coalesce(e.payload->>'ownerCommitment',''),'0x',''))=v_owner
        and case
          when coalesce(e.payload->>'expires','') ~ '^[0-9]+$'
          then (e.payload->>'expires')::bigint
          else 0
        end > extract(epoch from now())::bigint
    ) into v_own_submitting;
  end if;

  if not found
     or v_row.relay_quorum<4
     or v_row.last_checked_at is null
     or v_row.last_checked_at<=now()-interval '2 minutes'
     or not (
       v_row.status='clear'
       or (v_row.status='submitting' and v_own_submitting)
     ) then
    update public.zecblocks_mining_reservations
    set status='released',renewed_at=now(),expires_at=now()
    where token_id=p_token_id and owner_commitment=v_owner and lease_token=p_lease_token;
    return jsonb_build_object('ok',false,'error','TOKEN_NOT_FRESH_CLEAR','status',coalesce(v_row.status,'unknown'));
  end if;

  if not exists(select 1 from public.zecblocks_mining_reservations where token_id=p_token_id and owner_commitment=v_owner and lease_token=p_lease_token and status='active' and expires_at>now()) then return jsonb_build_object('ok',false,'error','LEASE_NOT_ACTIVE'); end if;
  if not public.zecblocks_claim_admit(p_token_id,case when v_own_submitting then 'submitting' else 'reserved' end,now()+make_interval(secs=>v_ttl)) then return jsonb_build_object('ok',false,'error',case when (public.zecblocks_claim_capacity()->>'claim_open')::boolean then 'CLAIM_SLOTS_PENDING' else 'CLAIM_CAP_REACHED' end)||public.zecblocks_claim_capacity(); end if;
  update public.zecblocks_mining_reservations
  set renewed_at=now(),expires_at=now()+make_interval(secs=>v_ttl)
  where token_id=p_token_id
    and owner_commitment=v_owner
    and lease_token=p_lease_token
    and status='active'
    and expires_at>now();

  if not found then return jsonb_build_object('ok',false,'error','LEASE_NOT_ACTIVE'); end if;
  return jsonb_build_object('ok',true,'slot_committed',exists(select 1 from public.zecblocks_claim_slots where token_id=p_token_id and state<>'reserved'),'expires_at',extract(epoch from (now()+make_interval(secs=>v_ttl)))::bigint);
end;
$function$;



CREATE OR REPLACE FUNCTION public.zecblocks_release_reservation(p_owner_commitment text, p_token_id integer, p_lease_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$;
declare
  v_owner text := lower(replace(coalesce(p_owner_commitment,''),'0x',''));
begin
  perform pg_advisory_xact_lock(4444,5000);
  update public.zecblocks_mining_reservations
  set status='released',renewed_at=now(),expires_at=now()
  where token_id=p_token_id and owner_commitment=v_owner and lease_token=p_lease_token and status='active';
  if found then
    delete from public.zecblocks_claim_slots where token_id=p_token_id and state='reserved';
    return jsonb_build_object('ok',true,'released',true);
  end if;
  return jsonb_build_object('ok',true,'released',false);
end;
$function$;



CREATE OR REPLACE FUNCTION public.zecblocks_claim_stats()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$;
  select jsonb_build_object(
    'claims_seen',public.zecblocks_claims_seen_live(),
    'claims_observed',(select count(*)::bigint from public.zecblocks_claim_observed),
    'claims_canonical',(select count(*)::bigint from public.zecblocks_claim_availability where status='claimed'),
    'claims_verifying',(select count(*)::bigint from public.zecblocks_claim_availability where status='claimed_pending'),
    'claims_clear',(select count(*)::bigint from public.zecblocks_claim_availability where status='clear'),
    'claims_unknown',(select count(*)::bigint from public.zecblocks_claim_availability where status='unknown'),
    'claims_protocol_total',public.zecblocks_claim_total(),
    'generated_at',extract(epoch from now())::bigint
  ) || public.zecblocks_claim_capacity();
$function$;



CREATE OR REPLACE FUNCTION public.zecblocks_mining_snapshot()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$;
with safe_candidates as (
  select token_id from public.zecblocks_events
  where event_type='CLAIM' and token_id between 1 and 5000
    and verification_status in ('verified','pending','deferred')
  union
  select token_id from public.zecblocks_claims_seen
  union
  select token_id from public.zecblocks_ownership_events where event_type='claim'
  union
  select token_id from public.zecblocks_claim_availability where status in ('claimed','claimed_pending')
),
active_intents as (
  select distinct token_id from public.zecblocks_events
  where event_type='CLAIM_INTENT' and protocol_audited is true
    and valid_signature is true and verification_status='verified'
    and case when coalesce(payload->>'expires','') ~ '^[0-9]{1,15}$'
      then (payload->>'expires')::bigint else 0 end > extract(epoch from now())
),
verified as (
  select token_id from public.zecblocks_claim_availability where status='claimed'
),
clears as (
  select a.token_id from public.zecblocks_claim_availability a
  where a.status='clear' and (select (public.zecblocks_claim_capacity()->>'new_claims_open')::boolean)
    and not exists(select 1 from safe_candidates c where c.token_id=a.token_id)
    and not exists(select 1 from active_intents i where i.token_id=a.token_id)
),
st as (
  select cursor from public.zecblocks_indexer_state where indexer='availability_relay_scan'
)
select jsonb_build_object(
  'claims_seen',public.zecblocks_claims_seen_live(),
  'claims_protocol_total',public.zecblocks_claim_total(),
  'candidate_ids',coalesce((select jsonb_agg(token_id order by token_id) from safe_candidates),'[]'::jsonb),
  'verified_ids',coalesce((select jsonb_agg(token_id order by token_id) from verified),'[]'::jsonb),
  'clear_ids',coalesce((select jsonb_agg(token_id order by token_id) from clears),'[]'::jsonb),
  'candidate_indexed',(select count(*)::bigint from safe_candidates),
  'verified_indexed',(select count(*)::bigint from verified),
  'clear_indexed',(select count(*)::bigint from clears),
  'unknown_indexed',(select count(*)::bigint from public.zecblocks_claim_availability where status='unknown'),
  'pending_indexed',(select count(*)::bigint from public.zecblocks_claim_availability where status='claimed_pending'),
  'mapping_complete',((select count(*) from verified)+(select count(*) from clears)=5000),
  'scan_cursor',coalesce((select (cursor->>'start_token')::int from st),1),
  'scan_relay',coalesce((select cursor->>'relay' from st),'starting'),
  'scan_pass',coalesce((select (cursor->>'relay_index')::int from st),0),
  'scan_complete',coalesce((select (cursor->>'complete')::boolean from st),false),
  'generated_at',extract(epoch from now())::bigint
) || public.zecblocks_claim_capacity();
$function$;



CREATE OR REPLACE FUNCTION public.zecblocks_mining_candidates(p_start_token integer DEFAULT 1, p_limit integer DEFAULT 24)
 RETURNS integer[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$;
  select coalesce(array_agg(token_id order by ord), array[]::integer[])
  from (
    select
      a.token_id,
      mod(a.token_id - greatest(1,least(5000,coalesce(p_start_token,1))) + 5000,5000) as ord
    from public.zecblocks_claim_availability a
    where a.status='clear' and (select (public.zecblocks_claim_capacity()->>'new_claims_open')::boolean)
      and a.relay_quorum>=3
      and not exists (
        select 1 from public.zecblocks_mining_reservations r
        where r.token_id=a.token_id and r.status='active' and r.expires_at>now()
      )
      and not exists (
        select 1 from public.zecblocks_claims_seen cs
        where cs.token_id=a.token_id
      )
      and not exists (
        select 1 from public.zecblocks_ownership_events oe
        where oe.token_id=a.token_id and oe.event_type='claim'
      )
      and not exists (
        select 1 from public.zecblocks_events e
        where e.event_type='CLAIM'
          and e.token_id=a.token_id
          and (
            e.protocol_audited=false
            or (e.protocol_audited=true and e.chain_confirmed=true and e.verification_status='verified')
          )
      )
      and not exists (
        select 1 from public.zecblocks_events e
        where e.event_type='CLAIM_INTENT'
          and e.token_id=a.token_id
          and e.protocol_audited=true
          and e.valid_signature=true
          and e.verification_status='verified'
          and case
            when coalesce(e.payload->>'expires','') ~ '^[0-9]+$'
            then (e.payload->>'expires')::bigint
            else 0
          end > extract(epoch from now())::bigint
      )
    order by ord
    limit greatest(1,least(50,coalesce(p_limit,24)))
  ) q;
$function$;


-- Reservation mutation remains available only to the service backend.
revoke all on function public.zecblocks_reserve_specific_clear_token(text,integer,integer), public.zecblocks_renew_reservation(text,integer,text,integer), public.zecblocks_release_reservation(text,integer,text) from public,anon,authenticated;
grant execute on function public.zecblocks_reserve_specific_clear_token(text,integer,integer), public.zecblocks_renew_reservation(text,integer,text,integer), public.zecblocks_release_reservation(text,integer,text) to service_role;
