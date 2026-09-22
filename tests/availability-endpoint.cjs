const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const source=fs.readFileSync(require('node:path').join(__dirname,'../supabase/functions/zecblocks-live-stats/index.ts'),'utf8');
function endpoint(result){
 let handler;const calls=[];
 const context={URL,Response,console,Deno:{env:{get:()=>''},serve:fn=>handler=fn},createClient:()=>({rpc:async name=>{calls.push(name);return result},from:()=>assert.fail('availability must not load unrelated marketplace rows')})};
 vm.runInNewContext(stripTypeScriptTypes(source.replace(/^import .*;\n/gm,'')),context);
 return {calls,request:()=>handler(new Request('https://service.test/live-stats?view=availability'))};
}
test('availability endpoint returns the fixed snapshot without client-side event access',async()=>{
 const data={claims_seen:15,candidate_ids:[1,2],verified_ids:[1],clear_ids:[3],generated_at:200};
 const e=endpoint({data,error:null}),r=await e.request();
 assert.equal(r.status,200);assert.match(r.headers.get('cache-control'),/no-store/);
 assert.deepEqual(await r.json(),{ok:true,...data});assert.deepEqual(e.calls,['zecblocks_mining_snapshot']);
});
test('incomplete or failed availability reads remain explicit failures',async()=>{
 for(const result of [{data:null,error:{message:'database unavailable'}},{data:{claims_seen:15},error:null}]){
  const r=await endpoint(result).request();assert.equal(r.status,500);assert.equal((await r.json()).ok,false);
 }
});
