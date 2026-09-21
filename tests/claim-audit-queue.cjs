// Generate a read-only SQL regression from the actual migration body.
// Run: node tests/claim-audit-queue.cjs
// Execute the emitted SELECT in PostgreSQL; every returned assertion must be true.
const fs = require('node:fs');
const path = require('node:path');
const migration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20260921214901_fair_claim_audit_queue.sql'), 'utf8');
const body = migration.split('AS $function$')[1].split('$function$')[0].trim()
  .replace(/;$/, '').replaceAll('public.zecblocks_events', 'fixture').replaceAll('p_limit', '30');
const fixture = "fixture as (\nselect 'deferred-'||n as event_key, 'CLAIM'::text as event_type, false as protocol_audited,\n'deferred-tx-'||n as txid, '{\"v\":1,\"signature\":\"fixture\"}'::jsonb as payload,\n'2026-09-21 21:00:00+00'::timestamptz + n*interval '1 second' as updated_at,\nn as token_id,'deferred'::text as verification_status, null::text as verified_level,null::boolean as chain_confirmed\nfrom generate_series(1,35) n\nunion all\nselect 'waiting-'||n,'CLAIM',false,'waiting-tx-'||n,'{\"v\":1,\"signature\":\"fixture\",\"pubkey\":\"fixture\",\"nonce\":\"1\"}'::jsonb,'2026-09-19 20:00:00+00'::timestamptz+n*interval '1 second',100+n,'pending',null,null from generate_series(1,3) n\nunion all\nselect 'weak-duplicate','CLAIM',false,'waiting-tx-1','{\"v\":1}'::jsonb,'2026-09-21 22:00:00+00',101,'pending',null,null\nunion all\nselect 'finalized','CLAIM',true,'finalized-tx','{}'::jsonb,'2026-09-18 00:00:00+00',200,'verified','full',true\nunion all\nselect 'finalized-duplicate','CLAIM',false,'finalized-tx','{}'::jsonb,'2026-09-18 01:00:00+00',200,'pending',null,null\n)";
process.stdout.write(`with ${fixture}, batch as (${body})
select
  (select count(*) from batch where event_key like 'waiting-%') = 3 as old_claims_get_a_turn,
  (select count(distinct txid) from batch) = 30 as bounded_deduplicated_batch,
  not exists(select 1 from batch where event_key='weak-duplicate') as complete_payload_preferred,
  not exists(select 1 from batch where txid='finalized-tx') as finalized_claims_protected;
`);
