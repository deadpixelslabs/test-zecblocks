-- Classify against every persisted event, not the first PostgREST page.
-- At most three relevant rows per NFT are returned (150 for 50 NFTs).
create or replace function public.zecblocks_claim_state_rows(p_token_ids integer[])
returns setof public.zecblocks_events
language sql stable security invoker
set search_path = pg_catalog, public
as $$
  with ids as (
    select distinct x as token_id from unnest(p_token_ids) x
    where x between 1 and 5000 order by x limit 50
  )
  select r.* from ids cross join lateral (
    (select e.* from public.zecblocks_events e
     where e.token_id=ids.token_id and e.event_type='CLAIM'
       and e.protocol_audited is true and e.chain_confirmed is true
       and e.verification_status='verified'
     order by e.block_height asc nulls last, e.tx_index asc nulls last,
       lower(e.txid), e.event_key limit 1)
    union all
    (select e.* from public.zecblocks_events e
     where e.token_id=ids.token_id and e.event_type='CLAIM'
       and e.protocol_audited is not true
       and e.verification_status in ('pending','deferred','verified')
     order by e.event_key limit 1)
    union all
    (select e.* from public.zecblocks_events e
     where e.token_id=ids.token_id and e.event_type='CLAIM_INTENT'
       and e.protocol_audited is true and e.valid_signature is true
       and e.verification_status='verified'
       and case when coalesce(e.payload->>'expires','') ~ '^[0-9]{1,15}$'
           then (e.payload->>'expires')::bigint else 0 end > extract(epoch from now())
     order by e.event_timestamp desc, e.event_key limit 1)
  ) r;
$$;
revoke all on function public.zecblocks_claim_state_rows(integer[]) from public, anon, authenticated;
grant execute on function public.zecblocks_claim_state_rows(integer[]) to service_role;

-- An audit may finish between a scanner's read and its availability write.
-- Recheck persisted evidence at write time; never turn a verified NFT CLEAR
-- merely because the caller used an incomplete or older snapshot.
create or replace function public.zecblocks_guard_claim_availability()
returns trigger language plpgsql security invoker
set search_path = pg_catalog, public
as $$
declare winner record;
begin
  select e.event_key,e.txid into winner
  from public.zecblocks_events e
  where e.token_id=new.token_id and e.event_type='CLAIM'
    and e.protocol_audited is true and e.chain_confirmed is true
    and e.verification_status='verified'
  order by e.block_height asc nulls last,e.tx_index asc nulls last,
    lower(e.txid),e.event_key limit 1;
  if found then
    new.status := 'claimed';
    new.claim_event_key := winner.event_key;
    new.claim_txid := winner.txid;
  end if;
  return new;
end;
$$;
revoke all on function public.zecblocks_guard_claim_availability() from public, anon, authenticated;
create trigger zecblocks_guard_claim_availability
before insert or update on public.zecblocks_claim_availability
for each row execute function public.zecblocks_guard_claim_availability();

-- Repair only classifications contradicted by already verified evidence.
-- No new claims, signatures, ownership records or historical counts are created.
update public.zecblocks_claim_availability a
set updated_at=now()
where a.status<>'claimed' and exists (
  select 1 from public.zecblocks_events e where e.token_id=a.token_id
    and e.event_type='CLAIM' and e.protocol_audited is true
    and e.chain_confirmed is true and e.verification_status='verified'
);
