-- The public gallery is a discovery snapshot, not authorization to mine or spend.
-- Include unresolved client submissions and filter blockers at read time so a
-- slower availability scan cannot advertise an already observed claim.
create or replace function public.zecblocks_mining_snapshot()
returns jsonb language sql stable security invoker set search_path=pg_catalog,public
as $$
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
  where a.status='clear'
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
);
$$;
