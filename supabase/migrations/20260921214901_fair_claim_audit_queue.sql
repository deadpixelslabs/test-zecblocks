CREATE OR REPLACE FUNCTION public.zecblocks_claim_audit_batch(p_limit integer DEFAULT 20)
 RETURNS SETOF zecblocks_events
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with ranked as (
    select distinct on (coalesce(txid,event_key))
      e.*
    from public.zecblocks_events e
    where e.event_type='CLAIM'
      and e.protocol_audited=false
      -- Relay duplicates must never re-audit an already finalized transaction.
      and not exists (
        select 1 from public.zecblocks_events finalized
        where finalized.event_type='CLAIM'
          and finalized.token_id=e.token_id and finalized.txid=e.txid
          and finalized.verification_status='verified'
          and finalized.verified_level='full'
          and finalized.protocol_audited=true and finalized.chain_confirmed=true
      )
    order by
      coalesce(txid,event_key),
      (
        case when coalesce(e.payload->>'v','1')='3' then 100 else 0 end +
        case when e.payload ? 'memo' then 30 else 0 end +
        case when e.payload ? 'signature' then 25 else 0 end +
        case when e.payload ? 'pubkey' then 20 else 0 end +
        case when e.payload ? 'ownerCommitment' then 15 else 0 end +
        case when e.payload ? 'proofHash' then 10 else 0 end +
        case when e.payload ? 'sourceHash' then 10 else 0 end +
        case when e.payload ? 'nonce' then 5 else 0 end
      ) desc,
      e.updated_at desc
  )
  select *
  from ranked
  -- Failed audits update updated_at. Retry the least recently touched claim first
  -- so a permanently unavailable transaction cannot monopolize every batch.
  order by updated_at asc, event_key asc
  limit greatest(1,least(40,coalesce(p_limit,20)));
$function$
