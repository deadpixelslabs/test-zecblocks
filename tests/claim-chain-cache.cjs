const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const source=fs.readFileSync(require('node:path').join(__dirname,'../supabase/functions/zecblocks-claim-audit/index.ts'),'utf8');
function verifier(fetch){
 let now=1;
 const context={fetch,AbortController,setTimeout,clearTimeout,Date:{now:()=>now}};
 vm.createContext(context);
 const implementation=source.slice(source.indexOf('async function chain('),source.indexOf('async function txIndexFor('));
 vm.runInContext(stripTypeScriptTypes('const txCache=new Map(),blockCache=new Map(),BASES=["https://provider.test/api"];class DeferredError extends Error{};'+implementation),context);
 return {chain:context.chain,advance(ms){now+=ms}};
}
test('pending transactions are fetched again when confirmation arrives',async()=>{
 let calls=0;const v=verifier(async()=>({ok:true,json:async()=>++calls===1?{status:'pending',blockHeight:null}:{status:'confirmed',blockHeight:100}}));
 assert.equal((await v.chain('tx','abc')).status,'pending');
 assert.equal((await v.chain('tx','abc')).status,'confirmed');
 assert.equal(calls,2);
});
test('confirmed cache expires so a changed chain response is observed',async()=>{
 let calls=0;const v=verifier(async()=>({ok:true,json:async()=>({status:'confirmed',blockHeight:++calls})}));
 assert.equal((await v.chain('tx','abc')).blockHeight,1);
 assert.equal((await v.chain('tx','abc')).blockHeight,1);
 v.advance(10001);
 assert.equal((await v.chain('tx','abc')).blockHeight,2);
});
test('404 is deferred without poisoning a later successful chain read',async()=>{
 let calls=0;const v=verifier(async()=>++calls===1?{ok:false,status:404}:{ok:true,json:async()=>({blockHeight:100})});
 await assert.rejects(v.chain('tx','abc'),/tx abc not yet visible/);
 assert.equal((await v.chain('tx','abc')).blockHeight,100);
});
