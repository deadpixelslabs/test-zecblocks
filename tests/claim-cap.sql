-- Run after claim-cap-fixture.sql and the actual migration in an isolated DB.
select test_assert((zecblocks_claim_capacity()->>'allocated_claims')::int=2,'legacy and pending claims keep slots');
select test_assert((select owner_commitment=repeat('a',64) from zecblocks_tokens where token_id=5000),'higher legacy ID keeps its owner');
select test_assert(zecblocks_mining_snapshot()->'verified_ids' @> '[5000]'::jsonb,'snapshot preserves higher legacy ID');
select test_assert(not has_function_privilege('anon','zecblocks_claim_admit(integer,text,timestamptz)','execute'),'anon cannot admit');
select test_assert(not has_function_privilege('authenticated','zecblocks_renew_reservation(text,integer,text,integer)','execute'),'user cannot renew directly');
select test_assert(not has_table_privilege('anon','zecblocks_claim_slots','insert'),'anon cannot insert slots');
select test_assert((select relrowsecurity from pg_class where oid='zecblocks_claim_slots'::regclass),'slot table RLS');

begin;
select test_assert(zecblocks_claim_admit(4445,'confirmed'),'new high ID is allowed below cap');
select test_assert(zecblocks_claim_admit(4445,'confirmed'),'duplicate admission is idempotent');
select test_assert((zecblocks_claim_capacity()->>'allocated_claims')::int=3,'duplicates do not consume two slots');
rollback;

begin;
do $$ declare lease jsonb; begin
  lease:=zecblocks_reserve_specific_clear_token(repeat('b',64),1);
  perform test_assert((lease->>'ok')::boolean,'fresh reservation');
  perform test_assert((zecblocks_claim_capacity()->>'allocated_claims')::int=3,'reservation holds capacity');
  perform test_assert(not (zecblocks_release_reservation(repeat('c',64),1,lease->>'lease_token')->>'released')::boolean,'another wallet cannot release');
  perform test_assert((zecblocks_renew_reservation(repeat('b',64),1,lease->>'lease_token')->>'slot_committed')::boolean=false,'ordinary lease not committed');
  insert into zecblocks_events(token_id,event_type,protocol_audited,valid_signature,verification_status,payload) values(1,'CLAIM_INTENT',true,true,'verified',jsonb_build_object('ownerCommitment',repeat('b',64),'expires',extract(epoch from now())::bigint+600));
  update zecblocks_claim_availability set status='submitting' where token_id=1;
  perform test_assert((zecblocks_renew_reservation(repeat('b',64),1,lease->>'lease_token')->>'slot_committed')::boolean,'service-verified intent holds a durable slot');
  perform test_assert((zecblocks_release_reservation(repeat('b',64),1,lease->>'lease_token')->>'released')::boolean,'release own lease');
  perform test_assert((select state='submitting' from zecblocks_claim_slots where token_id=1),'release never clears ambiguous broadcast capacity');
end $$;
rollback;

begin;
select test_assert(zecblocks_claim_admit(1,'reserved',now()+interval '1 minute'),'temporary slot');
update zecblocks_claim_slots set expires_at=now()-interval '1 second' where token_id=1;
select test_assert((zecblocks_claim_capacity()->>'allocated_claims')::int=2,'expired temporary reservation stops using capacity');
select test_assert(zecblocks_claim_admit(2,'confirmed'),'another token can use expired slot');
select test_assert(not exists(select 1 from zecblocks_claim_slots where token_id=1),'expired reservation removed');
rollback;

begin;
-- Two legacy slots + 4441 confirmed test admissions = 4443; one slot remains.
insert into zecblocks_claim_slots(token_id,slot_no,state) select id,id+2,'confirmed' from generate_series(1,4441) id;
select test_assert((zecblocks_claim_capacity()->>'slots_available')::int=1,'one remaining slot');
select test_assert(zecblocks_claim_admit(4442,'confirmed'),'4444th unique claim admitted');
select test_assert(not zecblocks_claim_admit(4443,'confirmed'),'4445th unique claim refused');
select test_assert(zecblocks_claim_admit(5000,'confirmed'),'existing high ID recovers at cap');
update zecblocks_tokens set owner_commitment=repeat('d',64) where token_id=5000;
select test_assert((select owner_commitment=repeat('d',64) from zecblocks_tokens where token_id=5000),'transfer of existing ID at cap');
select test_assert(zecblocks_mining_snapshot()->'clear_ids'='[]'::jsonb,'no new gallery selections at allocation cap');
select test_assert(zecblocks_mining_candidates()='{}'::integer[],'no new finder candidates at allocation cap');
select test_assert(zecblocks_reserve_specific_clear_token(repeat('b',64),4443)->>'error'='CLAIM_SLOTS_PENDING','no new reservation while existing admissions settle');
do $$ begin
  begin
    insert into zecblocks_tokens values(4443,'full',repeat('e',64));
    raise exception 'token guard failed';
  exception when raise_exception then if sqlerrm<>'ZB1_CLAIM_CAP_REACHED' then raise; end if; end;
  begin
    insert into zecblocks_events(token_id,event_type,protocol_audited,chain_confirmed,verification_status) values(4443,'CLAIM',true,true,'verified');
    raise exception 'event guard failed';
  exception when raise_exception then if sqlerrm<>'ZB1_CLAIM_CAP_REACHED' then raise; end if; end;
  begin
    insert into zecblocks_ownership_events values(4443,'claim','full');
    raise exception 'ownership guard failed';
  exception when raise_exception then if sqlerrm<>'ZB1_CLAIM_CAP_REACHED' then raise; end if; end;
  begin
    update zecblocks_claim_availability set status='claimed' where token_id=4443;
    raise exception 'availability guard failed';
  exception when raise_exception then if sqlerrm<>'ZB1_CLAIM_CAP_REACHED' then raise; end if; end;
end $$;
update zecblocks_claim_availability set status='claimed' where token_id in (select token_id from zecblocks_claim_slots);
select test_assert((zecblocks_claim_capacity()->>'claim_open')::boolean=false,'confirmed cap closes claiming');
select test_assert(zecblocks_claim_stats()->>'claims_canonical'='4444','canonical count reaches exactly 4444');
select test_assert(zecblocks_reserve_specific_clear_token(repeat('b',64),4443)->>'error'='CLAIM_CAP_REACHED','explicit closed response');
rollback;
