const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {stripTypeScriptTypes}=require('node:module');
const owner='ab'.repeat(32),lease='cd'.repeat(24);
const source=fs.readFileSync(path.join(__dirname,'../supabase/functions/zecblocks-mining-lease/index.ts'),'utf8');
function endpoint({intent=false,invalidProof=false,existing=false,closed=false}={}){
 let handler;const calls=[],proofs=[];
 const chain=new Proxy({}, {get:(_,name)=>name==='maybeSingle'?async()=>({data:existing?{token_id:5000,lease_token:lease}:null}):()=>chain});
 const context={Response,Date,setTimeout,console,Deno:{env:{get:()=>''},serve:fn=>handler=fn},
  verifyCapacityProof:async(p,o)=>{proofs.push([p.tokenId,o]);if(invalidProof)throw Error('Invalid claim proof')},
  fetch:async()=>({ok:true,json:async()=>({ok:true,complete:true,relays_ok:4,status_by_token:{5000:intent?'submitting':'clear'},clear_ids:intent?[]:[5000],events:intent?[{type:'CLAIM_INTENT',tokenId:5000,ownerCommitment:owner,expires:Math.floor(Date.now()/1000)+600}]:[]})}),
  createClient:()=>({from:()=>chain,rpc:async(name)=>{calls.push(name);return {data:name==='zecblocks_claim_capacity'?{new_claims_open:!closed,claim_open:!closed}:name==='zecblocks_renew_reservation'?{ok:true,slot_committed:intent}:{ok:true}}}})};
 vm.runInNewContext(stripTypeScriptTypes(source.replace(/^import .*;\n/gm,'')),context);
 return {calls,proofs,request:async body=>{const r=await handler(new Request('https://fixture.test/lease',{method:'POST',body:JSON.stringify({ownerCommitment:owner,tokenId:5000,leaseToken:lease,...body})}));return r.json()}};
}
test('new admission is closed while release remains available',async()=>{
 const e=endpoint({closed:true});assert.equal((await e.request({action:'reserve'})).error,'CLAIM_CAP_REACHED');
 assert.equal((await e.request({action:'release'})).ok,true);
 assert.ok(!e.calls.includes('zecblocks_next_global_finder_start'));
});
test('final payment gate requires a verified intent before renewing',async()=>{
 const e=endpoint();assert.equal((await e.request({action:'validate',commit:true})).error,'CLAIM_INTENT_NOT_VERIFIED');
 assert.ok(!e.calls.includes('zecblocks_renew_reservation'));
});
test('invalid work cannot acquire durable capacity through validate or lease reuse',async()=>{
 for(const action of ['validate','reserve']){
  const e=endpoint({intent:true,invalidProof:true,existing:true});
  assert.match((await e.request({action,commit:true})).error,/Invalid claim proof/);
  assert.equal(e.proofs.length,1);assert.ok(!e.calls.includes('zecblocks_renew_reservation'));
 }
});
test('existing valid proof can commit its last reserved slot after admissions close',async()=>{
 for(const action of ['validate','reserve']){
  const e=endpoint({intent:true,existing:true,closed:true});
  const r=await e.request({action,commit:true});assert.equal(r.ok,true);assert.equal(r.slot_committed,true);
  assert.deepEqual(e.proofs,[[5000,owner]]);
 }
});
test('capacity proof rejects mismatched canonical source and insufficient work',async()=>{
 const proofSource=fs.readFileSync(path.join(__dirname,'../supabase/functions/zecblocks-mining-lease/capacity-proof.ts'),'utf8');
 const context={Uint8Array,TextEncoder,DataView,AbortSignal,crypto:require('node:crypto').webcrypto,fetch:async()=>({ok:true,json:async()=>({hash:'11'.repeat(32)})})};
 vm.createContext(context);vm.runInContext(stripTypeScriptTypes(proofSource.replace('export async','async')),context);
 const p={tokenId:5000,nonce:'1',sourceHeight:3483573,sourceHash:'22'.repeat(32),ownerCommitment:owner,proofHash:'00'.repeat(32)};
 await assert.rejects(context.verifyCapacityProof(p,owner),/source block mismatch/);
 await assert.rejects(context.verifyCapacityProof({...p,sourceHash:'11'.repeat(32)},owner),/Invalid claim proof/);
});
