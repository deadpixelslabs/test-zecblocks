-- Mirror the existing finder exclusions in the public availability model.
-- Historical ownership is neither revoked nor silently revalidated here.
create or replace function public.zecblocks_claim_history_guards(p_token_ids integer[])
returns table(token_id integer,claim_txid text)
language sql stable security invoker set search_path=pg_catalog,public
as $$
  with ids as (select distinct x id from unnest(p_token_ids) x where x between 1 and 5000 order by x limit 50)
  select ids.id,coalesce(t.claim_txid,s.txid,o.txid)
  from ids
  left join public.zecblocks_tokens t on t.token_id=ids.id
  left join public.zecblocks_claims_seen s on s.token_id=ids.id
  left join lateral (
    select oe.txid from public.zecblocks_ownership_events oe
    where oe.token_id=ids.id and oe.event_type='claim'
    order by (oe.verified_level='full') desc,oe.block_height asc nulls last,
      oe.tx_index asc nulls last,lower(oe.txid),oe.event_key limit 1
  ) o on true
  where s.token_id is not null or exists(
    select 1 from public.zecblocks_ownership_events oe where oe.token_id=ids.id and oe.event_type='claim'
  );
$$;
revoke all on function public.zecblocks_claim_history_guards(integer[]) from public,anon,authenticated;
grant execute on function public.zecblocks_claim_history_guards(integer[]) to service_role;

create or replace function public.zecblocks_guard_claim_availability()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public
as $$
declare winner record; history record; has_winner boolean; has_history boolean;
begin
  select e.event_key,e.txid into winner from public.zecblocks_events e
  where e.token_id=new.token_id and e.event_type='CLAIM'
    and e.protocol_audited is true and e.chain_confirmed is true and e.verification_status='verified'
  order by e.block_height asc nulls last,e.tx_index asc nulls last,lower(e.txid),e.event_key limit 1;
  has_winner := found;
  select * into history from public.zecblocks_claim_history_guards(array[new.token_id]);
  has_history := found;
  if has_history and (not has_winner or (history.claim_txid is not null and history.claim_txid<>winner.txid)) then
    new.status := 'claimed_pending';
    new.claim_event_key := null;
    new.claim_txid := history.claim_txid;
  elsif has_winner then
    new.status := 'claimed';
    new.claim_event_key := winner.event_key;
    new.claim_txid := winner.txid;
  end if;
  return new;
end;
$$;

-- Reconcile existing classifications using the same guard, preserving ownership.
update public.zecblocks_claim_availability a set updated_at=now()
where a.status in ('clear','claimed') and (
  exists(select 1 from public.zecblocks_claims_seen s where s.token_id=a.token_id)
  or exists(select 1 from public.zecblocks_ownership_events o where o.token_id=a.token_id and o.event_type='claim')
);
