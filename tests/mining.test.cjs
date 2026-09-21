const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.join(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
function proxy(fetchImpl){
 const c={module:{exports:{}},process:{env:{}},fetch:fetchImpl,AbortController,setTimeout,clearTimeout};
 vm.runInNewContext(fs.readFileSync(path.join(root,'api/zb.js'),'utf8'),c);return c.module.exports;
}
function response(){return {code:200,headers:{},setHeader(k,v){this.headers[k]=v},status(n){this.code=n;return this},json(data){this.data=data;return this}}}
test('public credential matches frontend and is forwarded to protected reads',async()=>{
 const expected=html.match(/supabaseAnon:'([^']+)'/)[1];let calls=0;
 const handler=proxy(async(url,opts)=>{calls++;assert.equal(opts.headers.apikey,expected);assert.equal(JSON.parse(Buffer.from(expected.split('.')[1],'base64url')).iss,'supabase');assert.equal(opts.headers.authorization,'Bearer '+expected);return {ok:true,status:200,text:async()=>'{"claims_seen":3505}'}});
 const r=response();await handler({query:{op:'rpc',name:'zecblocks_mining_snapshot'},method:'POST',body:{}},r);
 assert.equal(r.data.data.claims_seen,3505);assert.equal(calls,1);assert.match(r.headers['Cache-Control'],/no-store/);
});
test('proxy rejects unsupported operations, methods, and malformed JSON',async()=>{
 const handler=proxy(()=>assert.fail('must not forward'));
 for(const req of [{query:{op:'rpc',name:'arbitrary_sql'},method:'POST'},{query:{op:'live-stats'},method:'DELETE'},{query:{op:'mining-lease'},method:'POST',body:'{'}]){
  const r=response();await handler(req,r);assert.ok([400,405].includes(r.code));
 }
});
test('temporary verification failure preserves reservation details',async()=>{
 const handler=proxy(async()=>({ok:true,status:200,text:async()=>JSON.stringify({ok:false,error:'VERIFICATION_TEMPORARY_UNAVAILABLE',preserve_lease:true})}));
 const r=response();await handler({query:{op:'mining-lease'},method:'POST',body:{action:'validate'}},r);assert.equal(r.data.data.preserve_lease,true);
});
test('inline scripts parse',()=>{for(const m of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(m[1])});

const {chromium}=require('playwright'),pub='02'+'11'.repeat(32),txid='ab'.repeat(32);
const snapshot={claims_seen:3505,generated_at:100,verified_ids:[1,2],candidate_ids:[1,2],clear_ids:[71,72,73,74,75,76,77,78,79,80,81,82,83],verified_indexed:2660,clear_indexed:2283,pending_indexed:57,unknown_indexed:0};
const stats={tick:'ZECS',mint_open:true,deploy_status:'confirmed',minted_supply:156660,confirmed_events:746,pending_events:4};
async function fixture(){
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:1360,height:1000},colorScheme:'dark'});
 const errors=[],calls=[];let failure=false,registerFailure=false,slow=false;
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{
  const req=route.request(),u=new URL(req.url());
  if(u.hostname==='localhost'){
   if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:html});
   if(u.pathname==='/api/zcash')return route.fulfill({json:{ok:true,data:u.searchParams.get('kind')==='block'?{hash:'22'.repeat(32)}:{blockHeight:3490000}}});
   if(u.pathname==='/api/zb'){
    const op=u.searchParams.get('op'),body=req.postDataJSON()||{};calls.push({op,body});
    if(slow&&op==='mining-lease')await new Promise(r=>setTimeout(r,200));
    if(failure)return route.fulfill({status:503,json:{ok:false,error:'temporarily unavailable',retryable:true}});
    let data={ok:true};
    if(op==='live-stats')data={ok:true,claims_seen:3505,canonical_claims:2660,canonical_clear:2283,canonical_verifying:57,canonical_unknown:0,generated_at:100};
    if(op==='rpc')data=u.searchParams.get('name')==='zecblocks_mining_snapshot'?snapshot:u.searchParams.get('name')==='zecblocks_zb20_stats'?stats:{eligible:true,eligible_nfts:1,balance:210,pending_mints:0};
    if(op==='mining-lease')data={ok:true,token_id:body.tokenId||71,lease_token:'aa'.repeat(24),expires_at:Math.floor(Date.now()/1000)+600,verified_at:Math.floor(Date.now()/1000),relays_ok:4};
    if(op==='check-claims')data={ok:true,complete:true,relays_ok:4,clear_ids:body.tokenIds,claimed_ids:[],events:[],status_by_token:Object.fromEntries((body.tokenIds||[]).map(id=>[id,'clear']))};
    if(op==='zb20-mint'){
     if(body.action==='lookup')data={ok:true,rows:[]};
     if(body.action==='preflight')data={ok:true,eligible:true,mint_open:true};
     if(body.action==='register'){
      if(registerFailure)return route.fulfill({status:503,json:{ok:false,error:'registration unavailable'}});
      data={ok:true,status:'pending',stats,account:{eligible:true,eligible_nfts:1,balance:210,pending_mints:1}};
     }
    }
    return route.fulfill({json:{ok:true,data}});
   }
  }
  return route.abort();
 });
 await page.addInitScript(({pub,txid})=>{
  window.walletTest={sends:0,signs:0,history:[],handlers:{},mode:'ok'};
  const w=window.walletTest;
  window.noirwallet={isNoirWallet:true,zcash:{
   connect:async()=>({transparent:'t1'+'x'.repeat(30),shielded:'u1test'}),getAccounts:async()=>[],getPublicKey:async()=>({pubkey:pub}),getBalance:async()=>({shielded:'1'}),getTransactionHistory:async()=>w.history,
   signMessage:async()=>{w.signs++;return {pubkey:pub,signature:'1f'+'33'.repeat(64)}},
   sendTransaction:async()=>{w.sends++;if(w.mode==='rejected')throw new Error('User rejected');if(w.mode==='unknown')throw new Error('Connection lost');return {txid}},
   on:(name,fn)=>w.handlers[name]=fn
  }};
 },{pub,txid});
 await page.goto('http://localhost:4321/',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.getElementById('claimCount').textContent==='3,505');
 return {page,browser,errors,calls,fail(v){failure=v},slow(v){slow=v},registerFail(v){registerFailure=v},async connect(){
  await page.getByRole('button',{name:'Connect Noir Wallet',exact:true}).click();
  await page.waitForFunction(()=>S.ownerCommitment&&S.zecsAccount?.eligible);
 }};
}
test('startup survives missing relay CDN; canonical counters, saved theme and mobile layout',async()=>{
 const f=await fixture();try{
  const p=f.page;await p.waitForFunction(()=>document.getElementById('zecsMintEvents').textContent==='746');
  assert.equal(await p.locator('#claimCount').textContent(),'3,505');
  await p.getByRole('button',{name:'Switch to light mode'}).click();await p.reload({waitUntil:'domcontentloaded'});
  assert.equal(await p.locator('html').getAttribute('data-theme'),'light');
  await p.setViewportSize({width:390,height:844});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  fs.mkdirSync(path.join(root,'test-artifacts'),{recursive:true});
  await p.screenshot({path:path.join(root,'test-artifacts/light-mobile.png'),fullPage:true});
  await p.setViewportSize({width:1360,height:1000});await p.getByRole('button',{name:'Switch to dark mode'}).click();
  await p.screenshot({path:path.join(root,'test-artifacts/dark-desktop.png'),fullPage:true});assert.deepEqual(f.errors,[]);
 }finally{await f.browser.close()}
});
test('stale responses, local events and failed reads cannot overwrite canonical total',async()=>{
 const f=await fixture();try{
  await f.page.evaluate(()=>{applyServerLiveStats({claims_seen:3506,generated_at:200});applyServerMiningSnapshot({claims_seen:10,generated_at:100});rebuildState()});
  assert.equal(await f.page.locator('#claimCount').textContent(),'3,506');
  f.fail(true);await f.page.evaluate(()=>loadServerLiveStats({force:true}));
  assert.equal(await f.page.locator('#claimCount').textContent(),'3,506');
 }finally{await f.browser.close()}
});
test('finder serializes repeated clicks; CPU proof leads to one NFT broadcast',async()=>{
 const f=await fixture();try{
  await f.connect();f.slow(true);
  await f.page.evaluate(()=>{document.getElementById('findUnclaimedBtn').click();document.getElementById('findUnclaimedBtn').click()});
  await f.page.waitForFunction(()=>S.target?.token===71&&!S.targetBusy);
  assert.equal(f.calls.filter(c=>c.op==='mining-lease'&&c.body.action==='reserve').length,1);
  await f.page.locator('#engineSelect').selectOption('cpu');
  await f.page.evaluate(()=>CFG.powBits=8);
  await f.page.locator('#startMineBtn').click();await f.page.waitForFunction(()=>!!S.proof);
  assert.equal(await f.page.evaluate(()=>leadingZeroBits(hexToBytes(S.proof.hash))>=8),true);
  await f.page.evaluate(()=>{document.getElementById('submitClaimBtn').click();document.getElementById('submitClaimBtn').click()});
  await f.page.waitForFunction(()=>window.walletTest.sends===1&&!S.walletAction);
  assert.equal(await f.page.evaluate(()=>window.walletTest.sends),1);
  assert.equal(await f.page.locator('#claimCount').textContent(),'3,505');
  assert.equal(await f.page.locator('#submitClaimBtn').isDisabled(),true);
  assert.match(await f.page.locator('#claimReceipt').textContent(),/Claim #71/);assert.deepEqual(f.errors,[]);
 }finally{await f.browser.close()}
});
test('account switch stops CPU workers and invalidates target',async()=>{
 const f=await fixture();try{
  await f.connect();await f.page.locator('#findUnclaimedBtn').click();await f.page.waitForFunction(()=>S.target&&!S.targetBusy);
  await f.page.evaluate(()=>CFG.powBits=256);
  await f.page.locator('#engineSelect').selectOption('cpu');await f.page.locator('#startMineBtn').click();await f.page.waitForFunction(()=>S.mining);
  assert.equal(await f.page.locator('#tokenInput').isDisabled(),true);
  await f.page.evaluate(()=>window.walletTest.handlers.accountsChanged());await f.page.waitForFunction(()=>!S.mining&&!S.target);
  assert.equal(await f.page.evaluate(()=>S.workers.length),0);assert.equal(await f.page.locator('#submitClaimBtn').isDisabled(),true);
 }finally{await f.browser.close()}
});
test('ZECS registration recovery reuses signature without sending a second mint',async()=>{
 const f=await fixture();try{
  await f.connect();f.registerFail(true);await f.page.locator('#zecsMintBtn').click();
  await f.page.waitForFunction(()=>window.walletTest.sends===1&&!S.walletAction);
  assert.equal(await f.page.evaluate(()=>!!loadZecsPendingTxid()&&!!loadZecsRegistration()),true);
  const signs=await f.page.evaluate(()=>window.walletTest.signs);
  f.registerFail(false);await f.page.evaluate(()=>resumeZecsRegistration());
  assert.equal(await f.page.evaluate(()=>window.walletTest.sends),1);assert.equal(await f.page.evaluate(()=>window.walletTest.signs),signs);
  assert.equal(await f.page.evaluate(()=>loadZecsPendingTxid()),'');
 }finally{await f.browser.close()}
});
test('ambiguous ZECS broadcast remains locked when wallet history is temporarily empty',async()=>{
 const f=await fixture();try{
  await f.connect();await f.page.evaluate(()=>window.walletTest.mode='unknown');
  await f.page.locator('#zecsMintBtn').click();await f.page.waitForFunction(()=>!S.walletAction&&!!loadZecsBroadcastLock());
  await f.page.locator('#zecsRecoverBtn').click();await f.page.waitForFunction(()=>!S.walletAction);
  assert.equal(await f.page.evaluate(()=>!!loadZecsBroadcastLock()),true);assert.equal(await f.page.evaluate(()=>window.walletTest.sends),1);
 }finally{await f.browser.close()}
});
