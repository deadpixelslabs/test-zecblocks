-- Read-only full-collection invariant check after migration. Results must be zero.
with batches as (
  select array_agg(id order by id) ids from generate_series(1,5000) id group by (id-1)/50
), classified as (
  select r.* from batches cross join lateral public.zecblocks_claim_state_rows(ids) r
), expected as (
  select distinct token_id from public.zecblocks_events
  where event_type='CLAIM' and protocol_audited and chain_confirmed and verification_status='verified'
)
select count(*) as missing_verified_tokens from expected e
where not exists(select 1 from classified c where c.token_id=e.token_id
  and c.event_type='CLAIM' and c.protocol_audited and c.chain_confirmed and c.verification_status='verified');

-- Roll back the stale scanner write: this verifies the guard, not a new claim.
begin;
do $$
declare id integer; actual text;
begin
  select a.token_id into id from public.zecblocks_claim_availability a
  where a.status='claimed' and exists(select 1 from public.zecblocks_events e
    where e.token_id=a.token_id and e.event_type='CLAIM' and e.protocol_audited
    and e.chain_confirmed and e.verification_status='verified') limit 1;
  if id is null then raise exception 'No verified fixture available'; end if;
  update public.zecblocks_claim_availability set status='clear',claim_txid=null,claim_event_key=null
  where token_id=id returning status into actual;
  if actual<>'claimed' then raise exception 'Verified NFT was downgraded'; end if;
end;
$$;
rollback;
