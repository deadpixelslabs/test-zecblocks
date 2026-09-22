-- Read-only assertions over the actual service-side public projection.
-- Every conflict/missing count must be zero; no ownership or event writes.
with snapshot as materialized (select public.zecblocks_mining_snapshot() d),
clear_ids as (select value::integer id from snapshot,jsonb_array_elements_text(d->'clear_ids')),
blocked_ids as (select value::integer id from snapshot,jsonb_array_elements_text(d->'candidate_ids'))
select
 (select count(*) from clear_ids c join blocked_ids b using(id)) as clear_candidate_overlap,
 (select count(*) from clear_ids c where exists(select 1 from public.zecblocks_events e
   where e.token_id=c.id and e.event_type='CLAIM' and e.verification_status in ('pending','deferred','verified'))) as clear_with_claim_events,
 (select count(*) from clear_ids c where exists(select 1 from public.zecblocks_claims_seen s where s.token_id=c.id)
   or exists(select 1 from public.zecblocks_ownership_events o where o.token_id=c.id and o.event_type='claim')) as clear_with_ownership_history,
 (select count(distinct e.token_id) from public.zecblocks_events e
   where e.event_type='CLAIM' and e.source='client-backfill' and e.verification_status in ('pending','deferred')
     and not exists(select 1 from blocked_ids b where b.id=e.token_id)) as missing_client_pending,
 (select count(*) from clear_ids c where exists(select 1 from public.zecblocks_events e
   where e.token_id=c.id and e.event_type='CLAIM_INTENT' and e.protocol_audited is true
     and e.valid_signature is true and e.verification_status='verified'
     and case when coalesce(e.payload->>'expires','') ~ '^[0-9]{1,15}$'
       then (e.payload->>'expires')::bigint else 0 end > extract(epoch from now()))) as clear_with_active_intent;
