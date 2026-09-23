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
test('gallery RPC uses the server projection while unrelated RPCs keep their original route',async()=>{
 const seen=[];
 const handler=proxy(async(url,opts)=>{seen.push({url,method:opts.method});return {ok:true,status:200,text:async()=>'{}'}});
 for(const name of ['zecblocks_mining_snapshot','zecblocks_zb20_stats']){
  const r=response();await handler({query:{op:'rpc',name},method:'POST',body:{}},r);assert.equal(r.code,200);
 }
 assert.match(seen[0].url,/\/functions\/v1\/zecblocks-live-stats\?view=availability$/);assert.equal(seen[0].method,'GET');
 assert.match(seen[1].url,/\/rest\/v1\/rpc\/zecblocks_zb20_stats$/);assert.equal(seen[1].method,'POST');
});
test('gallery upstream errors are not wrapped as a successful empty snapshot',async()=>{
 const handler=proxy(async()=>({ok:true,status:200,text:async()=>' {"ok":false,"error":"Availability snapshot incomplete"}'}));
 const r=response();await handler({query:{op:'rpc',name:'zecblocks_mining_snapshot'},method:'POST',body:{}},r);
 assert.equal(r.code,503);assert.equal(r.data.ok,false);
});
test('inline scripts parse',()=>{for(const m of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(m[1])});

const {chromium}=require('playwright'),pub='02'+'11'.repeat(32),txid='ab'.repeat(32);
const snapshot={claims_seen:3505,generated_at:100,verified_ids:[1,2],candidate_ids:[1,2],clear_ids:[71,72,73,74,75,76,77,78,79,80,81,82,83],verified_indexed:2660,clear_indexed:2283,pending_indexed:57,unknown_indexed:0};
const stats={tick:'ZECS',mint_open:true,deploy_status:'confirmed',minted_supply:156660,confirmed_events:746,pending_events:4};
async function openZecs(page){await page.getByRole('tab',{name:'$ZECS',exact:true}).click();}
async function fixture(){
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:1360,height:1000},colorScheme:'dark'});
 const page=await context.newPage();
 const errors=[],calls=[];let failure=false,registerFailure=false,slow=false,claimed=false,reservedToken=71;const registered=new Map(),claimedTokens=new Set();
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
    if(op==='mining-lease')data=claimedTokens.has(body.tokenId)?{ok:false,error:'TOKEN_NO_LONGER_CLEAR',status:'claimed'}:{ok:true,token_id:body.tokenId||reservedToken,lease_token:'aa'.repeat(24),expires_at:Math.floor(Date.now()/1000)+600,verified_at:Math.floor(Date.now()/1000),relays_ok:4};
    if(op==='check-claims'){
     const ids=body.tokenIds||[],confirmed=id=>claimed||claimedTokens.has(id);
     data={ok:true,complete:true,relays_ok:4,clear_ids:ids.filter(id=>!confirmed(id)),claimed_ids:ids.filter(confirmed),canonical_claims:Object.fromEntries(ids.filter(confirmed).map(id=>[id,{txid}])),events:[],status_by_token:Object.fromEntries(ids.map(id=>[id,confirmed(id)?'claimed':'clear']))};
    }
    if(op==='zb20-mint'){
     if(body.action==='lookup')data={ok:true,rows:body.txids.slice(0,50).map(id=>registered.get(id)).filter(Boolean)};
     if(body.action==='preflight')data={ok:true,eligible:true,mint_open:true};
     if(body.action==='register'){
      if(registerFailure)return route.fulfill({status:503,json:{ok:false,error:'registration unavailable'}});
      const owner=await page.evaluate(()=>S.ownerCommitment);
      registered.set(body.txid,{txid:body.txid,owner_commitment:owner,status:'pending'});
      data={ok:true,txid:body.txid,owner_commitment:owner,status:'pending',stats,account:{eligible:true,eligible_nfts:1,balance:210,pending_mints:1}};
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
   connect:async()=>({transparent:'t1'+'x'.repeat(30),shielded:'u1test'}),getAccounts:async()=>[],getPublicKey:async()=>({pubkey:pub}),getBalance:async()=>({shielded:'1'}),getTransactionHistory:async()=>{w.historyReads=(w.historyReads||0)+1;if(w.historyHang)return new Promise(()=>{});return w.history},
   signMessage:async()=>{w.signs++;return {pubkey:pub,signature:'1f'+'33'.repeat(64)}},
   sendTransaction:async()=>{w.sends++;if(w.mode==='rejected')throw new Error('User rejected');if(w.mode==='unknown')throw new Error('Connection lost');return {txid}},
   on:(name,fn)=>w.handlers[name]=fn
  }};
 },{pub,txid});
 await page.goto('http://localhost:4321/',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.getElementById('claimCount').textContent==='3,505');
 return {page,browser,errors,calls,fail(v){failure=v},slow(v){slow=v},registerFail(v){registerFailure=v},reserveToken(v){reservedToken=v},registered,claimedTokens,claimConfirmed(v){claimed=v},async connect(){
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
  await p.screenshot({path:path.join(root,'test-artifacts/dark-desktop.png'),fullPage:true});
  await openZecs(p);await p.screenshot({path:path.join(root,'test-artifacts/zecs-dark-desktop.png'),fullPage:true});
  await p.setViewportSize({width:390,height:844});await p.getByRole('button',{name:'Switch to light mode'}).click();
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await p.screenshot({path:path.join(root,'test-artifacts/zecs-light-mobile.png'),fullPage:true});assert.deepEqual(f.errors,[]);
  assert.equal(f.calls.filter(c=>c.op==='availability-scan').length,0,'public visits must not start the full server scan');
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
test('confirmed claims advance independently of historical IDs and ignore stale or failed reads',async()=>{
 const f=await fixture();try{
  assert.equal(await f.page.locator('#confirmedClaimCount').textContent(),'2,660');
  assert.equal(await f.page.locator('#claimCount').textContent(),'3,505');
  assert.equal(await f.page.locator('#claimProgressTrack').getAttribute('aria-valuenow'),'2660');
  assert.match(await f.page.locator('#claimProgressPercent').textContent(),/53\.20% claimed and confirmed/);
  await f.page.evaluate(()=>{applyServerLiveStats({claims_seen:3505,canonical_claims:2661,canonical_clear:2282,canonical_verifying:57,canonical_unknown:0,generated_at:200});rebuildState()});
  assert.equal(await f.page.locator('#confirmedClaimCount').textContent(),'2,661');
  assert.equal(await f.page.locator('#claimCount').textContent(),'3,505');
  assert.equal(await f.page.locator('#claimProgressTrack').getAttribute('aria-valuenow'),'2661');
  assert.match(await f.page.locator('#claimProgressPercent').textContent(),/53\.22% claimed and confirmed/);
  await f.page.evaluate(()=>applyServerMiningSnapshot({claims_seen:3505,verified_indexed:2660,generated_at:100}));
  f.fail(true);await f.page.evaluate(()=>loadServerLiveStats({force:true}));
  assert.equal(await f.page.locator('#confirmedClaimCount').textContent(),'2,661');
  assert.equal(await f.page.locator('#claimCount').textContent(),'3,505');
  assert.deepEqual(f.errors,[]);
 }finally{await f.browser.close()}
});
test('public snapshot defaults cannot reset live scan progress; a real new pass can',async()=>{
 const f=await fixture();try{
  assert.equal(await f.page.locator('#claimIndexProgress').textContent(),'Checking scan progress…');
  await f.page.evaluate(()=>{
   const live={claims_seen:3505,canonical_claims:2660,canonical_clear:2283,canonical_verifying:57,canonical_unknown:0,scan_cursor:4901,scan_complete:false,generated_at:200};
   applyServerLiveStats(live);
   applyServerMiningSnapshot({claims_seen:3505,verified_indexed:2660,clear_indexed:2283,pending_indexed:57,unknown_indexed:0,scan_cursor:1,scan_complete:false,generated_at:201});
  });
  assert.match(await f.page.locator('#claimIndexProgress').textContent(),/98%/);
  await f.page.evaluate(()=>applyServerLiveStats({claims_seen:3505,canonical_claims:2660,canonical_clear:2283,canonical_verifying:57,canonical_unknown:0,scan_cursor:1,scan_complete:false,generated_at:202}));
  assert.match(await f.page.locator('#claimIndexProgress').textContent(),/scan: 0%/);
  assert.deepEqual(f.errors,[]);
 }finally{await f.browser.close()}
});
test('finder serializes repeated clicks; CPU proof leads to one NFT broadcast',async()=>{
 const f=await fixture();try{
  await f.connect();f.slow(true);
  await f.page.evaluate(()=>{document.getElementById('findUnclaimedBtn').click();document.getElementById('findUnclaimedBtn').click()});
  await f.page.waitForFunction(()=>S.target?.token===71&&!S.targetBusy);
  assert.equal(f.calls.filter(c=>c.op==='mining-lease'&&c.body.action==='reserve').length,1);
  await f.page.locator('#miningDetails > summary').click();await f.page.locator('#engineSelect').selectOption('cpu');
  await f.page.evaluate(()=>CFG.powBits=8);
  await f.page.locator('#startMineBtn').click();await f.page.waitForFunction(()=>!!S.proof);
  assert.equal(await f.page.evaluate(()=>leadingZeroBits(hexToBytes(S.proof.hash))>=8),true);
  await f.page.evaluate(()=>{S.serverBackfillBusy=true;S.lastServerBackfill=Date.now()});
  await f.page.evaluate(()=>{document.getElementById('submitClaimBtn').click();document.getElementById('submitClaimBtn').click()});
  await f.page.waitForFunction(()=>window.walletTest.sends===1&&!S.walletAction);
  assert.equal(await f.page.evaluate(()=>window.walletTest.sends),1);
  await f.page.waitForFunction(()=>!CLAIM_RECOVERY_JOBS.size);
  assert.ok(f.calls.some(c=>c.op==='backfill-client-claims'&&c.body.claims?.some(e=>e.txid===txid)),'new claim must enter the canonical index immediately');
  assert.ok(f.calls.some(c=>c.op==='claim-audit'&&c.body.tokenId===71),'new claim must receive a token-scoped audit');
  assert.equal(await f.page.locator('#claimCount').textContent(),'3,505');
  assert.equal(await f.page.locator('#submitClaimBtn').isDisabled(),true);
  assert.match(await f.page.locator('#claimReceipt').textContent(),/Claim #71/);assert.deepEqual(f.errors,[]);
 }finally{await f.browser.close()}
});
test('account switch stops CPU workers and invalidates target',async()=>{
 const f=await fixture();try{
  await f.connect();await f.page.locator('#findUnclaimedBtn').click();await f.page.waitForFunction(()=>S.target&&!S.targetBusy);
  await f.page.evaluate(()=>CFG.powBits=256);
  await f.page.locator('#miningDetails > summary').click();await f.page.locator('#engineSelect').selectOption('cpu');await f.page.locator('#startMineBtn').click();await f.page.waitForFunction(()=>S.mining);
  assert.equal(await f.page.locator('#tokenInput').isDisabled(),true);
  await f.page.evaluate(()=>window.walletTest.handlers.accountsChanged());await f.page.waitForFunction(()=>!S.mining&&!S.target);
  assert.equal(await f.page.evaluate(()=>S.workers.length),0);assert.equal(await f.page.locator('#submitClaimBtn').isDisabled(),true);
 }finally{await f.browser.close()}
});
test('ZECS registration recovery reuses signature without sending a second mint',async()=>{
 const f=await fixture();try{
  await f.connect();f.registerFail(true);await openZecs(f.page);await f.page.locator('#zecsMintBtn').click();
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
  await openZecs(f.page);await f.page.locator('#zecsMintBtn').click();await f.page.waitForFunction(()=>!S.walletAction&&!!loadZecsBroadcastLock());
  await openZecs(f.page);await f.page.locator('#zecsRecoverBtn').click();await f.page.waitForFunction(()=>!S.walletAction);
  assert.equal(await f.page.evaluate(()=>!!loadZecsBroadcastLock()),true);assert.equal(await f.page.evaluate(()=>window.walletTest.sends),1);
 }finally{await f.browser.close()}
});

test('claim gate requires quorum and accepts only this wallet matching intent',async()=>{
 const f=await fixture();try{
  await f.connect();
  const result=await f.page.evaluate(()=>{
   const gate={complete:true,relays_ok:4,status_by_token:{71:'submitting'}};
   S.proof={nonce:'12'};
   S.intents.set(71,{ownerCommitment:'ff'.repeat(32),nonce:'12',expires:Date.now()/1000+100});
   const foreign=claimGateClear(gate,71);
   S.intents.set(71,{ownerCommitment:S.ownerCommitment,nonce:'12',expires:Date.now()/1000+100});
   const own=claimGateClear(gate,71),lowQuorum=claimGateClear({...gate,complete:false,relays_ok:3},71);
   return {foreign,own,lowQuorum};
  });
  assert.deepEqual(result,{foreign:false,own:true,lowQuorum:false});
 }finally{await f.browser.close()}
});
test('wallet rejection clears a ZECS no-broadcast lock and permits a later deliberate retry',async()=>{
 const f=await fixture();try{
  await f.connect();await f.page.evaluate(()=>window.walletTest.mode='rejected');
  await openZecs(f.page);await f.page.locator('#zecsMintBtn').click();await f.page.waitForFunction(()=>window.walletTest.sends===1&&!S.walletAction);
  assert.equal(await f.page.evaluate(()=>loadZecsBroadcastLock()),null);
  assert.equal(await f.page.locator('#zecsMintBtn').isDisabled(),false);
 }finally{await f.browser.close()}
});


// Regression fixtures reproduce production lookup's 50-TXID limit and durable legacy locks.
test('52 and 125 historical ZECS mints are checked in complete batches, without a false recovery lock',async()=>{
 const f=await fixture();try{
  await f.connect();const owner=await f.page.evaluate(()=>S.ownerCommitment);
  for(const count of [52,125]){
   const ids=Array.from({length:count},(_,i)=>(i+1).toString(16).padStart(64,'0'));
   for(const id of ids)f.registered.set(id,{txid:id,status:'confirmed',owner_commitment:owner});
   await f.page.evaluate(ids=>{walletTest.history=ids.map((txid,i)=>({txid,memo:ZECS_MINT_MESSAGE,timestamp:i}));},ids);
   const missing=await f.page.evaluate(async()=> (await zecsUnregisteredHistoryMints()).missing);
   assert.deepEqual(missing,[]);
  }
  assert.ok(f.calls.filter(c=>c.op==='zb20-mint'&&c.body.action==='lookup').every(c=>c.body.txids.length<=50));
  await openZecs(f.page);await f.page.locator('#zecsMintBtn').click();await f.page.waitForFunction(()=>walletTest.sends===1&&!S.walletAction);
  assert.equal(await f.page.evaluate(()=>loadZecsBroadcastLock()),null);assert.deepEqual(f.errors,[]);
 }finally{await f.browser.close()}
});
test('legacy discovery lock for an already confirmed mint self-heals without history, signature or payment',async()=>{
 const f=await fixture();try{
  await f.connect();const owner=await f.page.evaluate(()=>S.ownerCommitment);
  f.registered.set(txid,{txid,status:'confirmed',owner_commitment:owner});
  await f.page.evaluate(txid=>{saveZecsBroadcastLock({status:'recovery_required',found:[txid]});walletTest.historyHang=true},txid);
  await f.page.evaluate(()=>resumeZecsRegistration());
  assert.equal(await f.page.evaluate(()=>loadZecsBroadcastLock()),null);
  assert.equal(await f.page.locator('#zecsMintBtn').isDisabled(),false);
  assert.deepEqual(await f.page.evaluate(()=>({sends:walletTest.sends,signs:walletTest.signs})),{sends:0,signs:0});
 }finally{await f.browser.close()}
});
test('manual recovery releases a confirmed discovery lock without asking for another signature',async()=>{
 const f=await fixture();try{
  await f.connect();const owner=await f.page.evaluate(()=>S.ownerCommitment);
  f.registered.set(txid,{txid,status:'confirmed',owner_commitment:owner});
  await f.page.evaluate(txid=>saveZecsBroadcastLock({status:'recovery_required',found:[txid]}),txid);
  await openZecs(f.page);await f.page.locator('#zecsRecoverBtn').click();await f.page.waitForFunction(()=>!S.walletAction);
  assert.equal(await f.page.evaluate(()=>loadZecsBroadcastLock()),null);
  assert.equal(await f.page.evaluate(()=>walletTest.signs+walletTest.sends),0);
 }finally{await f.browser.close()}
});
test('Continue Pending Mint resolves a saved TXID even when Noir history never responds',async()=>{
 const f=await fixture();try{
  await f.connect();const owner=await f.page.evaluate(()=>S.ownerCommitment);
  f.registered.set(txid,{txid,status:'confirmed',owner_commitment:owner});
  await f.page.evaluate(txid=>{saveZecsPendingTxid(txid);saveZecsBroadcastLock({status:'txid_known',txid});walletTest.historyHang=true},txid);
  await openZecs(f.page);await f.page.locator('#zecsRecoverBtn').click();
  await f.page.waitForFunction(()=>!S.walletAction&&!S.zecsBusy&&!loadZecsBroadcastLock());
  assert.equal(await f.page.locator('#zecsMintBtn').isVisible(),true);
  assert.match(await f.page.locator('#zecsRecoveryList').textContent(),/Confirmed on Zcash/);
  assert.equal(await f.page.evaluate(()=>walletTest.signs+walletTest.sends),0);
  await f.page.screenshot({path:path.join(root,'test-artifacts/zecs-recovery-confirmed.png'),fullPage:true});
  assert.deepEqual(f.errors,[]);
 }finally{await f.browser.close()}
});
test('Continue Pending Mint reuses the saved signature through unavailable history and double clicks',async()=>{
 const f=await fixture();try{
  await f.connect();f.registerFail(true);await openZecs(f.page);await f.page.locator('#zecsMintBtn').click();
  await f.page.waitForFunction(()=>walletTest.sends===1&&!S.walletAction&&!!loadZecsRegistration());
  const signs=await f.page.evaluate(()=>walletTest.signs);f.registerFail(false);
  await f.page.evaluate(()=>{walletTest.historyHang=true;document.getElementById('zecsRecoverBtn').click();document.getElementById('zecsRecoverBtn').click()});
  await f.page.waitForFunction(()=>!S.walletAction&&!S.zecsBusy&&!loadZecsBroadcastLock());
  assert.equal(await f.page.evaluate(()=>walletTest.sends),1);assert.equal(await f.page.evaluate(()=>walletTest.signs),signs);
  assert.equal(await f.page.locator('#zecsMintBtn').isEnabled(),true);
  assert.deepEqual(f.errors,[]);
 }finally{await f.browser.close()}
});
test('saved registration alone displays recovery and does not allow another payment',async()=>{
 const f=await fixture();try{
  await f.connect();await f.page.evaluate(txid=>{
   durableSet(zecsRegistrationKey(),JSON.stringify({txid,owner:S.ownerCommitment,body:{txid,pubkey:S.pubkey,anchorSignature:'1f'+'33'.repeat(64),message:ZECS_MINT_MESSAGE}}));
   walletTest.historyHang=true;updateZecsUI();
  },txid);
  await openZecs(f.page);assert.equal(await f.page.locator('#zecsMintBtn').isVisible(),false);
  assert.match(await f.page.locator('#zecsRecoverBtn').textContent(),/Continue Pending Mint/);
  await f.page.locator('#zecsRecoverBtn').click();await f.page.waitForFunction(()=>!S.walletAction&&!loadZecsRegistration());
  assert.equal(await f.page.evaluate(()=>walletTest.sends+walletTest.signs),0);
 }finally{await f.browser.close()}
});
test('recovery errors remain visible through polling and have a retryable button',async()=>{
 const f=await fixture();try{
  await f.connect();f.registerFail(true);await openZecs(f.page);await f.page.locator('#zecsMintBtn').click();
  await f.page.waitForFunction(()=>walletTest.sends===1&&!S.walletAction);
  await f.page.locator('#zecsRecoverBtn').click();await f.page.waitForFunction(()=>!S.walletAction);
  await f.page.evaluate(()=>loadZecsState());await f.page.waitForFunction(()=>!S.zecsRegistrationBusy);
  assert.match(await f.page.locator('#zecsStatus').textContent(),/registration unavailable/);
  assert.equal(await f.page.locator('#zecsRecoverBtn').isEnabled(),true);
  assert.equal(await f.page.evaluate(()=>!!loadZecsRegistration()&&!!loadZecsBroadcastLock()),true);
  await f.page.setViewportSize({width:390,height:844});
  assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await f.page.screenshot({path:path.join(root,'test-artifacts/zecs-recovery-mobile.png'),fullPage:true});
 }finally{await f.browser.close()}
});
test('registered lookup for another owner cannot clear the current wallet lock',async()=>{
 const f=await fixture();try{
  await f.connect();f.registered.set(txid,{txid,status:'confirmed',owner_commitment:'ff'.repeat(32)});
  await f.page.evaluate(txid=>saveZecsBroadcastLock({status:'recovery_required',found:[txid]}),txid);
  await f.page.evaluate(()=>resumeZecsRegistration());
  assert.equal(await f.page.evaluate(()=>!!loadZecsBroadcastLock()),true);
 }finally{await f.browser.close()}
});
test('legacy NFT lock protects its own ID while a different block can mine and claim once',async()=>{
 const f=await fixture();try{
  await f.connect();
  await f.page.evaluate(()=>localStorage.setItem(freeClaimRecoveryKey(),JSON.stringify({tokenId:3874,status:'wallet_approval',memo:'old-pending'})));
  await f.page.locator('#findUnclaimedBtn').click();await f.page.waitForFunction(()=>S.target&&!S.targetBusy);
  assert.ok(f.calls.some(c=>c.op==='mining-lease'&&c.body.excludeTokens?.includes(3874)));
  assert.equal(await f.page.locator('#startMineBtn').isDisabled(),false);
  await f.page.locator('#miningDetails > summary').click();await f.page.locator('#engineSelect').selectOption('cpu');await f.page.evaluate(()=>CFG.powBits=8);
  await f.page.locator('#startMineBtn').click();await f.page.waitForFunction(()=>S.proof);
  await f.page.locator('#submitClaimBtn').click();await f.page.waitForFunction(()=>walletTest.sends===1&&!S.walletAction);
  assert.deepEqual(await f.page.evaluate(()=>claimRecoveries().map(x=>x.tokenId).sort((a,b)=>a-b)),[71,3874]);
  assert.equal(await f.page.evaluate(()=>loadFreeClaimRecovery(3874).memo),'old-pending');
  assert.equal(await f.page.locator('#submitClaimBtn').isDisabled(),true);
  await f.page.evaluate(()=>{S.target={token:3874};updateMiningControls()});
  assert.equal(await f.page.locator('#startMineBtn').isDisabled(),true);assert.deepEqual(f.errors,[]);
 }finally{await f.browser.close()}
});
test('already confirmed NFT recovery clears the journal without redundant registration or wallet calls',async()=>{
 const f=await fixture();try{
  await f.connect();f.claimConfirmed(true);
  await f.page.evaluate(txid=>{
   S.target={token:71};saveFreeClaimRecovery({tokenId:71,status:'pending',txid,event:{tokenId:71,type:'CLAIM',protocol:'ZB1',txid,nonce:'1'}});
   S.serverBackfillBusy=true;
   // Click in the same turn as journal creation, before background recovery can
   // legitimately finish it and remove the button from the next browser frame.
   const button=document.getElementById('recoverClaimBtn');
   if(button.hidden||button.disabled)throw new Error('Recovery action is unavailable');
   button.click();
  },txid);
  await f.page.waitForFunction(()=>!loadFreeClaimRecovery(71));
  assert.equal(f.calls.some(c=>c.op==='backfill-client-claims'&&c.body.claims?.some(e=>e.txid===txid)),false);
  assert.equal(await f.page.evaluate(()=>loadFreeClaimRecovery(71)),null);
  // Settled IDs are never mined again even after the local journal is resolved.
  assert.equal(await f.page.locator('#recoverClaimBtn').isHidden(),true);
  assert.equal(await f.page.locator('#startMineBtn').isDisabled(),true);
  assert.equal(await f.page.evaluate(()=>walletTest.sends),0);
  assert.match(await f.page.locator('[data-recovery-token="71"]').textContent(),/Confirmed on Zcash/);
 }finally{await f.browser.close()}
});
test('targeted NFT history recovery skips unrelated claims before chain lookups',async()=>{
 const f=await fixture();try{
  await f.connect();
  const count=await f.page.evaluate(async()=>{
   walletTest.history=Array.from({length:52},(_,i)=>({txid:(i+1).toString(16).padStart(64,'0'),memo:'ZB1|C|1|T='+(i+1)+'|N=1|K='+S.pubkey+'|S='+'1f'+'33'.repeat(64)}));
   let calls=0;const old=explorerFetch;explorerFetch=async()=>{calls++;throw new Error('unrelated chain read')};
   try{await recoverClaimFromNoirHistory(3874);return calls}finally{explorerFetch=old}
  });assert.equal(count,0);
 }finally{await f.browser.close()}
});
test('hung wallet history releases the action and preserves pending recovery',async()=>{
 const f=await fixture();try{
  await f.connect();
  await f.page.evaluate(()=>{
   walletTest.historyHang=true;saveZecsBroadcastLock({status:'broadcast_unknown'});
   const old=setTimeout;window.setTimeout=(fn,ms,...args)=>old(fn,ms===WALLET_READ_TIMEOUT?40:ms,...args);
  });
  await openZecs(f.page);await f.page.locator('#zecsRecoverBtn').click();await f.page.waitForFunction(()=>!S.walletAction&&!S.zecsBusy);
  assert.match(await f.page.locator('#zecsStatus').textContent(),/timed out/);
  assert.equal(await f.page.evaluate(()=>!!loadZecsBroadcastLock()),true);
  assert.equal(await f.page.locator('#zecsRecoverBtn').isDisabled(),false);
 }finally{await f.browser.close()}
});
test('late wallet broadcast after timeout is saved for its original wallet',async()=>{
 const f=await fixture();try{
  await f.connect();
  const result=await f.page.evaluate(async txid=>{
   const owner=S.ownerCommitment;
   saveZecsBroadcastLock({status:'wallet_approval'});
   let finish;provider().sendTransaction=()=>new Promise(resolve=>finish=resolve);
   const old=setTimeout;window.setTimeout=(fn,ms,...args)=>old(fn,ms===WALLET_APPROVAL_TIMEOUT?20:ms,...args);
   const pending=rpc('zcash_sendTransaction',[{memo:ZECS_MINT_MESSAGE}]);
   let timedOut=false;try{await pending}catch{timedOut=true}
   S.ownerCommitment='ff'.repeat(32);S.walletEpoch++;
   finish({txid});await new Promise(resolve=>old(resolve,10));
   return {timedOut,original:localStorage.getItem('zb20_zecs_pending_mint_txid_'+owner),current:loadZecsPendingTxid()};
  },txid);
  assert.deepEqual(result,{timedOut:true,original:txid,current:''});
 }finally{await f.browser.close()}
});
test('recovering one mint preserves other queued TXIDs across a registration failure',async()=>{
 const f=await fixture();try{
  await f.connect();
  const ids=['cd'.repeat(32),'ef'.repeat(32)];
  await f.page.evaluate(ids=>saveZecsBroadcastLock({status:'recovery_required',found:ids}),ids);
  f.registerFail(true);await openZecs(f.page);await f.page.locator('#zecsRecoverBtn').click();await f.page.waitForFunction(()=>!S.walletAction);
  assert.deepEqual(new Set(await f.page.evaluate(()=>loadZecsBroadcastLock().found)),new Set(ids));
  f.registerFail(false);await openZecs(f.page);await f.page.locator('#zecsRecoverBtn').click();await f.page.waitForFunction(()=>!S.walletAction);
  assert.equal(await f.page.evaluate(()=>loadZecsBroadcastLock()),null);
  assert.equal(await f.page.evaluate(()=>walletTest.sends),0);
 }finally{await f.browser.close()}
});
test('transport cancellation is ambiguous and cannot clear a broadcast lock',async()=>{
 const f=await fixture();try{
  await f.connect();
  assert.equal(await f.page.evaluate(()=>walletRejected(new Error('Request cancelled by transport'))),false);
  assert.equal(await f.page.evaluate(()=>walletRejected({code:4001})),true);
 }finally{await f.browser.close()}
});

test('slow NFT indexer recovery does not hold the wallet action gate',async()=>{
 const f=await fixture();try{
  await f.connect();
  await f.page.evaluate(txid=>{
   saveFreeClaimRecovery({tokenId:3874,status:'pending',txid,event:{tokenId:3874,txid}});
   const original=backendJson;backendJson=(op,args)=>op==='backfill-client-claims'?new Promise(()=>{}):original(op,args);
  },txid);
  await f.page.locator('#recoverClaimBtn').click();
  assert.equal(await f.page.evaluate(()=>S.walletAction),false);
  assert.equal(await f.page.locator('#findUnclaimedBtn').isDisabled(),false);
  assert.equal(await f.page.locator('#recoverClaimBtn').isDisabled(),true);
  assert.equal(await f.page.evaluate(()=>!!loadFreeClaimRecovery(3874)),true);
 }finally{await f.browser.close()}
});

test('one recovery click checks all claims; missing TXID does not hide a settled claim',async()=>{
 const f=await fixture();try{
  await f.connect();f.claimedTokens.add(774);
  await f.page.evaluate(txid=>{
   saveFreeClaimRecovery({tokenId:3874,status:'wallet_approval',memo:'saved-proof'});
   saveFreeClaimRecovery({tokenId:774,status:'pending',txid});
   document.getElementById('recoverClaimBtn').click();document.getElementById('recoverClaimBtn').click();
  },txid);
  await f.page.waitForFunction(()=>!CLAIM_RECOVERY_BATCHES.size&&!loadFreeClaimRecovery(774));
  assert.deepEqual(await f.page.evaluate(()=>claimRecoveries().map(r=>r.tokenId)),[3874]);
  assert.match(await f.page.locator('[data-recovery-token="774"]').textContent(),/Confirmed on Zcash/);
  assert.match(await f.page.locator('[data-recovery-token="774"]').textContent(),/Your claim succeeded.*included in Confirmed claims/);
  assert.match(await f.page.locator('[data-recovery-token="3874"]').textContent(),/Check Noir Wallet/);
  assert.equal(f.calls.filter(c=>c.op==='check-claims'&&c.body.tokenIds.includes(774)).length,1);
  assert.equal(f.calls.filter(c=>c.op==='check-claims'&&c.body.tokenIds.includes(3874)).length,1);
  assert.equal(await f.page.locator('#recoverClaimBtn').isDisabled(),false);
  assert.equal(await f.page.evaluate(()=>walletTest.sends+walletTest.signs),0);
  await f.page.screenshot({path:path.join(root,'test-artifacts/recovery-results-desktop.png'),fullPage:true});
  await f.page.setViewportSize({width:390,height:844});
  assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await f.page.screenshot({path:path.join(root,'test-artifacts/recovery-results-mobile.png'),fullPage:true});
  assert.deepEqual(f.errors,[]);
 }finally{await f.browser.close()}
});
test('canonical settlement resolves a no-TXID journal even when wallet history is unavailable',async()=>{
 const f=await fixture();try{
  await f.connect();f.claimedTokens.add(774);
  await f.page.evaluate(()=>{
   walletTest.historyHang=true;walletTest.historyReads=0;saveFreeClaimRecovery({tokenId:774,status:'wallet_approval'});
   const button=document.getElementById('recoverClaimBtn');
   if(button.hidden||button.disabled)throw new Error('Recovery action is unavailable');
   button.click();
  });
  await f.page.waitForFunction(()=>!CLAIM_RECOVERY_BATCHES.size);
  assert.equal(await f.page.locator('#confirmedPortfolioLink').isVisible(),false);
  assert.doesNotMatch(await f.page.locator('#actionTitle').textContent(),/claimed successfully/);
  assert.equal(await f.page.evaluate(()=>loadFreeClaimRecovery(774)),null);
  assert.equal(await f.page.evaluate(()=>walletTest.historyReads),0);
  assert.equal(await f.page.evaluate(()=>walletTest.sends+walletTest.signs),0);
 }finally{await f.browser.close()}
});
test('missing NFT registration backfills its exact saved event then checks settlement',async()=>{
 const f=await fixture();try{
  await f.connect();
  await f.page.evaluate(txid=>{
   saveFreeClaimRecovery({tokenId:774,status:'pending',txid,event:{tokenId:774,type:'CLAIM',txid}});
   const original=backendJson;let audited=false;
   backendJson=async(op,args)=>{
    const result=await original(op,args);
    if(op==='claim-audit')audited=true;
    if(op==='check-claims'&&audited)return {...result,status_by_token:{774:'claimed'},claimed_ids:[774],clear_ids:[]};
    return result;
   };
   const button=document.getElementById('recoverClaimBtn');
   if(button.hidden||button.disabled)throw new Error('Recovery action is unavailable');
   button.click();
  },txid);
  await f.page.waitForFunction(()=>!CLAIM_RECOVERY_BATCHES.size);
  assert.ok(f.calls.some(c=>c.op==='backfill-client-claims'&&c.body.claims.length===1&&c.body.claims[0].txid===txid));
  assert.equal(await f.page.evaluate(()=>loadFreeClaimRecovery(774)),null);
  assert.equal(await f.page.evaluate(()=>walletTest.sends+walletTest.signs),0);
 }finally{await f.browser.close()}
});
test('wallet history timeout is reported accurately and does not prevent other claims settling',async()=>{
 const f=await fixture();try{
  await f.connect();f.claimedTokens.add(774);
  await f.page.evaluate(txid=>{
   saveFreeClaimRecovery({tokenId:3874,status:'wallet_approval'});saveFreeClaimRecovery({tokenId:774,status:'pending',txid});
   walletTest.historyHang=true;
   const old=setTimeout;window.setTimeout=(fn,ms,...args)=>old(fn,ms===WALLET_READ_TIMEOUT?80:ms,...args);
  },txid);
  await f.page.locator('#recoverClaimBtn').click();await f.page.waitForFunction(()=>!CLAIM_RECOVERY_BATCHES.size);
  assert.match(await f.page.locator('[data-recovery-token="3874"]').textContent(),/Noir read timed out/);
  assert.doesNotMatch(await f.page.locator('[data-recovery-token="3874"]').textContent(),/No matching TXID/);
  assert.equal(await f.page.evaluate(()=>loadFreeClaimRecovery(774)),null);
  assert.equal(await f.page.evaluate(()=>!!loadFreeClaimRecovery(3874)),true);
  assert.equal(await f.page.locator('#recoverClaimBtn').isDisabled(),false);
 }finally{await f.browser.close()}
});
test('bounded NFT recovery exposes progress, preserves the journal and ignores late completion',async()=>{
 const f=await fixture();try{
  await f.connect();
  await f.page.evaluate(txid=>{
   saveFreeClaimRecovery({tokenId:774,status:'pending',txid,event:{tokenId:774,txid}});
   const original=backendJson;
   backendJson=(op,args)=>op==='backfill-client-claims'?new Promise(resolve=>window.finishClaimBackfill=resolve):original(op,args);
   const old=setTimeout;window.setTimeout=(fn,ms,...args)=>old(fn,ms===CLAIM_RECOVERY_TIMEOUT?800:ms,...args);
  },txid);
  await f.page.locator('#recoverClaimBtn').click();
  await f.page.waitForFunction(()=>!!window.finishClaimBackfill);
  assert.match(await f.page.locator('#recoverClaimBtn').textContent(),/Checking claims/);
  assert.match(await f.page.locator('[data-recovery-token="774"]').textContent(),/Registering saved claim/);
  assert.equal(await f.page.locator('#findUnclaimedBtn').isDisabled(),false);
  await f.page.waitForFunction(()=>!CLAIM_RECOVERY_BATCHES.size);
  assert.match(await f.page.locator('[data-recovery-token="774"]').textContent(),/timed out/);
  assert.equal(await f.page.locator('#recoverClaimBtn').isDisabled(),false);
  await f.page.evaluate(()=>window.finishClaimBackfill({ok:true}));
  assert.equal(f.calls.some(c=>c.op==='claim-audit'),false);
  assert.equal(await f.page.evaluate(()=>!!loadFreeClaimRecovery(774)),true);
  assert.equal(await f.page.evaluate(()=>walletTest.sends+walletTest.signs),0);
 }finally{await f.browser.close()}
});
test('account changes during recovery cannot clear journals or show another wallet results',async()=>{
 const f=await fixture();try{
  await f.connect();
  const owner=await f.page.evaluate(txid=>{
   saveFreeClaimRecovery({tokenId:774,status:'pending',txid});
   const original=backendJson;backendJson=(op,args)=>op==='check-claims'?new Promise(resolve=>window.finishClaimCheck=resolve):original(op,args);
   recoverPendingClaims();return S.ownerCommitment;
  },txid);
  await f.page.waitForFunction(()=>!!window.finishClaimCheck);
  await f.page.evaluate(async()=>{
   clearNoirSession();S.ownerCommitment='ff'.repeat(32);updateMiningControls();
   window.finishClaimCheck({ok:true,status_by_token:{774:'claimed'},claimed_ids:[774],events:[]});
  });
  await f.page.waitForFunction(()=>!CLAIM_RECOVERY_BATCHES.size);
  assert.equal(await f.page.evaluate(owner=>!!loadFreeClaimRecovery(774,owner),owner),true);
  assert.equal(await f.page.locator('#claimRecoveryList').isHidden(),true);
  assert.equal(await f.page.locator('#claimRecoveryStatus').isHidden(),true);
  assert.equal(await f.page.evaluate(()=>walletTest.sends+walletTest.signs),0);
 }finally{await f.browser.close()}
});
test('NFT audit errors retain the exact transaction and show the verifier reason',async()=>{
 const f=await fixture();try{
  await f.connect();
  await f.page.evaluate(txid=>{
   saveFreeClaimRecovery({tokenId:774,status:'pending',txid});
   const original=backendJson;
   backendJson=(op,args)=>op==='claim-audit'?Promise.resolve({ok:true,results:[{token:774,txid,ok:false,deferred:false,error:'signature mismatch'}]}):original(op,args);
  },txid);
  await f.page.locator('#recoverClaimBtn').click();await f.page.waitForFunction(()=>!CLAIM_RECOVERY_BATCHES.size);
  assert.match(await f.page.locator('[data-recovery-token="774"]').textContent(),/Claim needs attention.*signature mismatch/);
  assert.equal(await f.page.evaluate(()=>loadFreeClaimRecovery(774).txid),txid);
  assert.equal(await f.page.evaluate(()=>walletTest.sends+walletTest.signs),0);
 }finally{await f.browser.close()}
});

test('a chain-provider 404 is pending and recovery never sends another payment',async()=>{
 const f=await fixture();try{
  await f.connect();
  await f.page.evaluate(txid=>{
   saveFreeClaimRecovery({tokenId:774,status:'pending',txid});
   const original=backendJson;
   backendJson=(op,args)=>op==='claim-audit'?Promise.resolve({ok:true,results:[{token:774,txid,ok:false,deferred:true,error:'chain provider unavailable: chain HTTP 404'}]}):original(op,args);
  },txid);
  await f.page.locator('#recoverClaimBtn').click();await f.page.waitForFunction(()=>!CLAIM_RECOVERY_BATCHES.size);
  assert.match(await f.page.locator('[data-recovery-token="774"]').textContent(),/does not mean the claim failed.*do not pay again/);
  assert.equal(await f.page.evaluate(()=>loadFreeClaimRecovery(774).txid),txid);
  f.claimedTokens.add(774);
  await f.page.locator('#recoverClaimBtn').click();await f.page.waitForFunction(()=>!CLAIM_RECOVERY_BATCHES.size);
  assert.equal(await f.page.evaluate(()=>loadFreeClaimRecovery(774)),null);
  assert.match(await f.page.locator('[data-recovery-token="774"]').textContent(),/Confirmed on Zcash/);
  assert.equal(await f.page.evaluate(()=>walletTest.sends+walletTest.signs),0);
 }finally{await f.browser.close()}
});

test('a different canonical TXID is shown as duplicate without claiming ownership',async()=>{
 const f=await fixture();try{
  await f.connect();f.claimedTokens.add(774);
  await f.page.evaluate(()=>{
   saveFreeClaimRecovery({tokenId:774,status:'pending',txid:'cd'.repeat(32)});
   const button=document.getElementById('recoverClaimBtn');
   if(button.hidden||button.disabled)throw new Error('Recovery action is unavailable');
   button.click();
  });
  await f.page.waitForFunction(()=>!CLAIM_RECOVERY_BATCHES.size);
  const text=await f.page.locator('[data-recovery-token="774"]').textContent();
  assert.match(text,/Duplicate claim/);assert.doesNotMatch(text,/Your transaction is the canonical/);
  assert.equal(await f.page.locator('#confirmedPortfolioLink').isVisible(),false);
  assert.doesNotMatch(await f.page.locator('#actionTitle').textContent(),/claimed successfully/);
  assert.equal(await f.page.evaluate(()=>walletTest.sends+walletTest.signs),0);
 }finally{await f.browser.close()}
});

test('confirmed claim has a clear success screen despite another pending claim and unchanged historical count',async()=>{
 const f=await fixture();try{
  await f.connect();f.claimedTokens.add(71);
  await f.page.evaluate(txid=>{
   saveFreeClaimRecovery({tokenId:3681,status:'unknown'});
   saveFreeClaimRecovery({tokenId:71,status:'pending',txid,event:{sourceHeight:3488502,sourceHash:'22'.repeat(32)}});
   return reconcileFreeClaimRecovery(71);
  },txid);
  assert.equal(await f.page.locator('#actionTitle').textContent(),'NFT #71 claimed successfully.');
  assert.equal(await f.page.locator('#confirmedPortfolioLink').isVisible(),true);
  assert.equal(await f.page.locator('#confirmedPortfolioLink').getAttribute('href'),'https://www.zecblocks.xyz/#portfolio');
  assert.match(await f.page.locator('[data-recovery-token="71"]').textContent(),/Your claim succeeded/);
  assert.match(await f.page.locator('#claimReceipt').textContent(),/Claim #71 confirmed/);
  assert.equal(await f.page.locator('#artState').textContent(),'Confirmed');
  assert.equal(await f.page.locator('[data-step].complete').count(),4);
  assert.equal(await f.page.locator('#claimCount').textContent(),'3,505');
  assert.equal(await f.page.locator('#confirmedClaimCount').textContent(),'2,660','do not invent counter increments while the aggregate catches up');
  assert.equal(await f.page.evaluate(()=>!!loadFreeClaimRecovery(3681)),true);
  assert.equal(await f.page.locator('[data-candidate="71"]').count(),0);
  assert.equal(await f.page.evaluate(()=>walletTest.sends+walletTest.signs),0);
  const owner=await f.page.evaluate(()=>S.ownerCommitment);
  await f.page.evaluate(()=>{S.ownerCommitment='44'.repeat(32);renderMiningExperience()});
  assert.equal(await f.page.locator('#confirmedPortfolioLink').isVisible(),false);
  assert.doesNotMatch(await f.page.locator('#actionTitle').textContent(),/claimed successfully/);
  await f.page.evaluate(owner=>{S.ownerCommitment=owner;renderMiningExperience()},owner);
  f.reserveToken(72);
  assert.equal(await f.page.locator('#findUnclaimedBtn').textContent(),'Find Next NFT');
  await f.page.locator('#findUnclaimedBtn').click();
  await f.page.waitForFunction(()=>S.target?.token===72&&!S.targetBusy);
  assert.equal(await f.page.locator('#actionTitle').textContent(),'Ready when you are.');
  assert.equal(await f.page.locator('#confirmedPortfolioLink').isVisible(),false);
  assert.equal(await f.page.evaluate(()=>walletTest.sends+walletTest.signs),0);
  assert.deepEqual(f.errors,[]);
 }finally{await f.browser.close()}
});

test('conflicting historical ownership retains recovery and never claims success or pays again',async()=>{
 const f=await fixture();try{
  await f.connect();
  await f.page.evaluate(txid=>{
   saveFreeClaimRecovery({tokenId:774,status:'pending',txid});
   const original=backendJson;
   backendJson=(op,args)=>op==='check-claims'?Promise.resolve({ok:true,status_by_token:{774:'claimed_pending'},ownership_review_ids:[774],events:[]}):original(op,args);
  },txid);
  await f.page.locator('#recoverClaimBtn').click();await f.page.waitForFunction(()=>!CLAIM_RECOVERY_BATCHES.size);
  assert.equal(await f.page.evaluate(()=>loadFreeClaimRecovery(774).txid),txid);
  const text=await f.page.locator('[data-recovery-token="774"]').textContent();
  assert.match(text,/Ownership verification needed/);assert.doesNotMatch(text,/Confirmed on Zcash/);
  assert.equal(await f.page.evaluate(()=>walletTest.sends+walletTest.signs),0);
 }finally{await f.browser.close()}
});

test('direct registration timeout releases wallet controls and retains the exact claim',async()=>{
 const f=await fixture();try{
  await f.connect();
  await f.page.evaluate(txid=>{
   saveFreeClaimRecovery({tokenId:71,status:'pending',txid,event:{tokenId:71,txid}});
   const original=backendJson;backendJson=(op,args)=>op==='backfill-client-claims'?new Promise(()=>{}):original(op,args);
   const timer=setTimeout;window.setTimeout=(fn,ms,...args)=>timer(fn,ms===CLAIM_RECOVERY_TIMEOUT?100:ms,...args);
   reconcileFreeClaimRecovery(71,{registerFirst:true});
  },txid);
  await f.page.waitForFunction(()=>!CLAIM_RECOVERY_JOBS.size);
  assert.equal(await f.page.evaluate(()=>S.walletAction),false);
  assert.equal(await f.page.evaluate(()=>loadFreeClaimRecovery(71).txid),txid);
  assert.match(await f.page.locator('[data-recovery-token="71"]').textContent(),/timed out/);
  assert.equal(await f.page.evaluate(()=>walletTest.sends),0);
 }finally{await f.browser.close()}
});

test('gallery previews use source blocks; search, pagination and selection keep the wallet flow intact',async()=>{
 const f=await fixture();try{
  const p=f.page;
  await p.waitForFunction(()=>document.querySelectorAll('.candidate-art svg:not(:empty)').length===6);
  assert.equal(f.calls.filter(c=>c.op==='mining-lease').length,0,'browsing artwork never reserves or sends');
  assert.equal(await p.locator('[data-candidate]').count(),6);
  assert.equal(await p.locator('#connectMineBtn').isVisible(),true);
  await p.getByRole('button',{name:'Next candidates',exact:true}).click();
  assert.equal(await p.locator('[data-candidate]').first().getAttribute('data-candidate'),'77');
  await p.getByLabel('Search available NFT numbers').fill('83');
  assert.equal(await p.locator('[data-candidate]').count(),1);
  await p.getByLabel('Search available NFT numbers').fill('9999');
  assert.match(await p.locator('#availableTokens').textContent(),/No available NFT matches/);
  await p.getByLabel('Search available NFT numbers').fill('71');
  await f.connect();
  await p.getByRole('button',{name:'Select ZEC BLOCK #71',exact:true}).click();
  await p.waitForFunction(()=>S.target?.token===71&&!S.targetBusy);
  assert.equal(await p.locator('#startMineBtn').isVisible(),true);
  assert.equal(await p.locator('#submitClaimBtn').isVisible(),false);
  assert.equal(await p.locator('#artTitle').textContent(),'ZEC BLOCK #71');
  assert.equal(await p.locator('[data-candidate="71"]').getAttribute('aria-pressed'),'true');
  await p.waitForFunction(()=>document.querySelector('[data-candidate="71"] svg').childElementCount>0);
  assert.equal(await p.locator('[data-candidate="71"] svg').innerHTML(),await p.locator('#heroArt').innerHTML());
  assert.equal(await p.evaluate(()=>walletTest.sends),0);assert.deepEqual(f.errors,[]);
 }finally{await f.browser.close()}
});

test('NFT and ZECS tabs preserve active mining; deep links and keyboard navigation work',async()=>{
 const f=await fixture();try{
  const p=f.page;await f.connect();await p.locator('#findUnclaimedBtn').click();
  await p.waitForFunction(()=>S.target&&!S.targetBusy);
  await p.locator('#miningDetails > summary').click();await p.locator('#engineSelect').selectOption('cpu');
  await p.evaluate(()=>CFG.powBits=256);await p.locator('#startMineBtn').click();await p.waitForFunction(()=>S.mining);
  await openZecs(p);
  assert.equal(await p.locator('#mining').isHidden(),true);
  assert.equal(await p.locator('#zecs').isVisible(),true);
  assert.equal(await p.locator('#zecsMintBtn').isDisabled(),true);
  assert.equal(await p.evaluate(()=>S.mining&&S.workers.length>0),true);
  await p.getByRole('tab',{name:'$ZECS',exact:true}).press('ArrowLeft');
  assert.equal(await p.getByRole('tab',{name:'Mine NFTs',exact:true}).getAttribute('aria-selected'),'true');
  assert.equal(await p.locator('#stopMineBtn').isVisible(),true);
  await p.locator('#stopMineBtn').click();assert.equal(await p.evaluate(()=>S.mining),false);
  await openZecs(p);await p.reload({waitUntil:'domcontentloaded'});
  await p.waitForFunction(()=>document.getElementById('zecsTab').getAttribute('aria-selected')==='true');
  assert.equal(await p.locator('#zecs').isVisible(),true);
  assert.deepEqual(f.errors,[]);
 }finally{await f.browser.close()}
});

test('newer counters cannot suppress collection updates; older snapshots cannot restore claimed cards',async()=>{
 const f=await fixture();try{
  const p=f.page;await f.connect();
  await p.evaluate(snapshot=>{
   applyServerLiveStats({claims_seen:3507,canonical_claims:2662,canonical_clear:2281,generated_at:300});
   applyServerMiningSnapshot({...snapshot,generated_at:200,candidate_ids:[1,2,71],verified_ids:[1,2,71],clear_ids:[72,73]});
  },snapshot);
  assert.equal(await p.locator('[data-candidate="71"]').count(),0);
  assert.equal(await p.locator('[data-candidate="72"]').count(),1);
  assert.equal(await p.locator('#claimCount').textContent(),'3,507');
  assert.equal(await p.locator('#confirmedClaimCount').textContent(),'2,662');
  await p.evaluate(snapshot=>applyServerMiningSnapshot({...snapshot,generated_at:150}),snapshot);
  assert.equal(await p.locator('[data-candidate="71"]').count(),0);
  assert.equal(await p.evaluate(()=>S.snapshotGeneratedAt),200000);
  assert.deepEqual(f.errors,[]);
 }finally{await f.browser.close()}
});

test('exact claim results survive delayed snapshots and do not mark the whole gallery fresh',async()=>{
 const f=await fixture();try{
  const p=f.page;await f.connect();f.claimedTokens.add(71);
  const timestamps=await p.evaluate(async()=>{
   // Process an already received reply so unrelated connection-time network
   // responses cannot race this assertion about exact-check processing.
   const original=backendJson,response=await original('check-claims',{body:{tokenIds:[71],deep:true}});
   backendJson=(op,args)=>op==='check-claims'?Promise.resolve(response):original(op,args);
   const before=S.lastServerSnapshot;
   try{await serverCheckClaims([71],{deep:true});return [before,S.lastServerSnapshot]}finally{backendJson=original}
  });
  assert.equal(timestamps[1],timestamps[0]);
  await p.evaluate(snapshot=>applyServerMiningSnapshot({...snapshot,generated_at:200}),snapshot);
  assert.equal(await p.locator('[data-candidate="71"]').count(),0);
  assert.equal(await p.locator('#claimCount').textContent(),'3,505');
  f.claimedTokens.delete(71);
  await p.evaluate(()=>serverCheckClaims([71],{deep:true}));
  assert.equal(await p.locator('[data-candidate="71"]').count(),0,'a known confirmed claim cannot become clear from a lagging relay response');
  assert.deepEqual(f.errors,[]);
 }finally{await f.browser.close()}
});

test('pending cards survive delayed snapshots but may return after an explicit complete clear check',async()=>{
 const f=await fixture();try{
  const p=f.page;
  await p.route('**/api/zb?op=check-claims',r=>r.fulfill({json:{ok:true,data:{ok:true,complete:true,relays_ok:4,pending_ids:[71],status_by_token:{71:'claimed_pending'}}}}));
  await p.evaluate(()=>serverCheckClaims([71],{deep:true}));
  await p.evaluate(snapshot=>applyServerMiningSnapshot({...snapshot,generated_at:200}),snapshot);
  assert.equal(await p.locator('[data-candidate="71"]').count(),0);
  await p.unroute('**/api/zb?op=check-claims');
  await p.evaluate(()=>serverCheckClaims([71],{deep:true}));
  assert.equal(await p.locator('[data-candidate="71"]').count(),1);
  assert.deepEqual(f.errors,[]);
 }finally{await f.browser.close()}
});

test('claimed gallery selection removes the card without starting workers or requesting a payment',async()=>{
 const f=await fixture();try{
  const p=f.page;await f.connect();f.claimedTokens.add(71);
  await p.getByRole('button',{name:'Select ZEC BLOCK #71',exact:true}).click();
  await p.waitForFunction(()=>!S.targetBusy&&!document.querySelector('[data-candidate="71"]'));
  assert.equal(await p.evaluate(()=>S.workers.length),0);
  assert.equal(await p.evaluate(()=>walletTest.sends+walletTest.signs),0);
  await p.getByRole('button',{name:'Select ZEC BLOCK #72',exact:true}).click();
  await p.waitForFunction(()=>S.target?.token===72&&!S.targetBusy);
  assert.equal(await p.locator('#startMineBtn').isEnabled(),true);
  assert.deepEqual(f.errors,[]);
 }finally{await f.browser.close()}
});

test('failed fresh checks cannot reuse a lease and incomplete clear responses cannot authorize spending',async()=>{
 const f=await fixture();try{
  const p=f.page;await f.connect();await p.locator('#findUnclaimedBtn').click();
  await p.waitForFunction(()=>S.target&&!S.targetBusy);f.fail(true);
  assert.equal(await p.evaluate(async()=>(await checkTargetAvailability(S.target,{refresh:true})).available),false);
  const gates=await p.evaluate(()=>{
   const good={complete:true,relays_ok:4,status_by_token:{71:'clear'},clear_ids:[71]};
   return [claimGateClear(good,71),claimGateClear({...good,relays_ok:undefined},71),claimGateClear({...good,clear_ids:[]},71),claimGateClear({...good,complete:false},71)];
  });
  assert.deepEqual(gates,[true,false,false,false]);
  assert.equal(await p.evaluate(()=>walletTest.sends),0);
  assert.deepEqual(f.errors,[]);
 }finally{await f.browser.close()}
});

test('a claim discovered during mining stops workers and directs the user to another NFT',async()=>{
 const f=await fixture();try{
  const p=f.page;await f.connect();await p.locator('#findUnclaimedBtn').click();await p.waitForFunction(()=>S.target&&!S.targetBusy);
  await p.locator('#miningDetails > summary').click();await p.locator('#engineSelect').selectOption('cpu');
  await p.evaluate(()=>CFG.powBits=256);await p.locator('#startMineBtn').click();await p.waitForFunction(()=>S.mining&&S.workers.length>0&&!S.targetBusy);
  await p.evaluate(snapshot=>applyServerMiningSnapshot({...snapshot,generated_at:200,candidate_ids:[1,2,71],verified_ids:[1,2,71],clear_ids:[72,73]}),snapshot);
  assert.equal(await p.evaluate(()=>S.mining),false);
  assert.equal(await p.evaluate(()=>S.workers.length),0);
  assert.equal(await p.locator('#actionTitle').textContent(),'Choose another NFT.');
  assert.equal(await p.locator('#findUnclaimedBtn').isVisible(),true);
  assert.equal(await p.locator('#submitClaimBtn').isDisabled(),true);
  assert.equal(await p.evaluate(()=>walletTest.sends),0);
  assert.deepEqual(f.errors,[]);
 }finally{await f.browser.close()}
});

test('claim becoming unavailable while the wallet signs is blocked before payment',async()=>{
 const f=await fixture();try{
  const p=f.page;await f.connect();await p.locator('#findUnclaimedBtn').click();await p.waitForFunction(()=>S.target&&!S.targetBusy);
  await p.locator('#miningDetails > summary').click();await p.locator('#engineSelect').selectOption('cpu');
  await p.evaluate(()=>CFG.powBits=8);await p.locator('#startMineBtn').click();await p.waitForFunction(()=>S.proof&&!S.targetBusy);
  await p.exposeFunction('simulateClaimCompetition',()=>f.claimedTokens.add(71));
  await p.evaluate(()=>{
   const sign=noirwallet.zcash.signMessage;
   noirwallet.zcash.signMessage=async(...args)=>{
    const result=await sign(...args);
    if(String(args[0]).startsWith('ZB1:CLAIM:v1'))await simulateClaimCompetition();
    return result;
   };
  });
  await p.locator('#submitClaimBtn').click();await p.waitForFunction(()=>walletTest.signs>=2&&!S.walletAction);
  assert.equal(await p.evaluate(()=>walletTest.sends),0);
  assert.equal(await p.evaluate(()=>loadFreeClaimRecovery(71)),null);
  assert.equal(await p.locator('[data-candidate="71"]').count(),0);
  assert.equal(await p.locator('#findUnclaimedBtn').isVisible(),true);
  assert.deepEqual(f.errors,[]);
 }finally{await f.browser.close()}
});

test('a late clear response cannot erase a newer pending claim or reopen its payment gate',async()=>{
 const f=await fixture();try{
  const result=await f.page.evaluate(async()=>{
   const original=backendJson;let finish;
   backendJson=(op,args)=>op==='check-claims'?new Promise(resolve=>finish=resolve):original(op,args);
   const old=serverCheckClaims([71],{deep:true});
   rememberUnavailable(71,'claimed_pending');updateAvailabilityCounts();
   const reply={ok:true,complete:true,relays_ok:4,clear_ids:[71],status_by_token:{71:'clear'}};
   finish(reply);await old;backendJson=original;
   return {blocked:tokenUnavailable(71),listed:S.serverClearIds.has(71),gate:claimGateClear(reply,71),cards:document.querySelectorAll('[data-candidate="71"]').length,sends:walletTest.sends};
  });
  assert.deepEqual(result,{blocked:true,listed:false,gate:false,cards:0,sends:0});assert.deepEqual(f.errors,[]);
 }finally{await f.browser.close()}
});

test('expired or failed gallery reads pause selection until a fresh snapshot arrives',async()=>{
 const f=await fixture();try{
  const p=f.page;await f.connect();
  await p.evaluate(()=>{S.lastServerSnapshot=Date.now()-GALLERY_MAX_AGE-1;renderAvailableTokens()});
  assert.equal(await p.locator('[data-candidate="71"]').isDisabled(),true);
  assert.match(await p.locator('[data-candidate="71"]').innerText(),/Checking/);
  assert.match(await p.locator('#availabilityFreshness').innerText(),/Selection is paused/);
  await p.evaluate(()=>loadServerMiningSnapshot({force:true}));
  assert.equal(await p.locator('[data-candidate="71"]').isEnabled(),true);
  f.fail(true);await p.evaluate(()=>loadServerMiningSnapshot({force:true}));
  assert.equal(await p.locator('[data-candidate="71"]').isDisabled(),true);
  assert.equal(await p.locator('#availableTokens').getByText('Available',{exact:true}).count(),0);
  f.fail(false);await p.locator('#refreshAvailable').click();
  await p.waitForFunction(()=>galleryIsFresh()&&!document.getElementById('refreshAvailable').disabled);
  assert.equal(await p.locator('[data-candidate="71"]').isEnabled(),true);
  assert.equal(await p.evaluate(()=>walletTest.sends),0);assert.deepEqual(f.errors,[]);
 }finally{await f.browser.close()}
});

test('confirmed NFT exclusions survive reload, wallet switching and a stale server snapshot',async()=>{
 const f=await fixture();try{
  const p=f.page;await f.connect();f.claimedTokens.add(71);
  await p.evaluate(()=>serverCheckClaims([71],{deep:true}));
  f.claimedTokens.delete(71);await p.reload({waitUntil:'domcontentloaded'});
  await p.waitForFunction(()=>S.lastServerSnapshot>0);
  await p.evaluate(()=>{S.ownerCommitment='ff'.repeat(32);updateMiningControls();renderAvailableTokens()});
  assert.equal(await p.locator('[data-candidate="71"]').count(),0);
  assert.equal(await p.evaluate(()=>tokenUnavailable(71)),true);
  assert.equal(await p.locator('[data-candidate="72"]').count(),1);assert.deepEqual(f.errors,[]);
 }finally{await f.browser.close()}
});

test('another tab immediately removes its saved or confirmed NFT from the gallery',async()=>{
 const f=await fixture();try{
  const p=f.page;await f.connect();const tab=await p.context().newPage();
  await tab.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Same-origin tab</title>'}));
  await tab.goto('http://localhost:4321/other-tab');
  const keys=await p.evaluate(()=>({pending:claimRecoveryQueueKey(S.ownerCommitment),confirmed:CONFIRMED_CLAIMS_KEY}));
  await tab.evaluate(keys=>localStorage.setItem(keys.pending,JSON.stringify([{tokenId:71,status:'wallet_approval'}])),keys);
  await p.waitForFunction(()=>!document.querySelector('[data-candidate="71"]'));
  await tab.evaluate(keys=>{localStorage.setItem(keys.confirmed,JSON.stringify([71]));localStorage.setItem(keys.pending,'[]')},keys);
  await p.waitForFunction(()=>unavailableTokens.get(71)==='claimed');
  assert.equal(await p.locator('[data-candidate="71"]').count(),0);assert.equal(await p.evaluate(()=>walletTest.sends),0);
  await tab.close();assert.deepEqual(f.errors,[]);
 }finally{await f.browser.close()}
});

test('an NFT claimed in another tab cannot open a second payment approval',async()=>{
 const f=await fixture();try{
  const p=f.page;await f.connect();await p.locator('#findUnclaimedBtn').click();await p.waitForFunction(()=>S.target&&!S.targetBusy);
  await p.evaluate(()=>{CFG.powBits=8;S.enginePreference='cpu'});await p.locator('#startMineBtn').click();await p.waitForFunction(()=>S.proof&&!S.targetBusy);
  const key=await p.evaluate(()=>'zb1-claim:'+CFG.genesisTxid+':'+S.target.token),tab=await p.context().newPage();
  await tab.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Same-origin claim</title>'}));
  await tab.goto('http://localhost:4321/other-claim');
  await tab.evaluate(key=>{navigator.locks.request(key,async()=>{window.locked=true;await new Promise(resolve=>window.releaseClaim=resolve)})},key);
  await tab.waitForFunction(()=>window.locked);
  await p.locator('#submitClaimBtn').click();await p.waitForFunction(()=>!S.walletAction);
  assert.equal(await p.evaluate(()=>walletTest.sends+walletTest.signs),0);assert.match(await p.locator('#toast').innerText(),/another tab/);
  await tab.evaluate(()=>window.releaseClaim());await tab.close();assert.deepEqual(f.errors,[]);
 }finally{await f.browser.close()}
});

test('final claim validation cannot reuse a lease check begun before wallet signing',async()=>{
 const f=await fixture();try{
  const p=f.page;await f.connect();await p.locator('#findUnclaimedBtn').click();await p.waitForFunction(()=>S.target&&!S.targetBusy);
  await p.evaluate(()=>{CFG.powBits=8;S.enginePreference='cpu'});await p.locator('#startMineBtn').click();await p.waitForFunction(()=>S.proof&&!S.targetBusy);
  await p.exposeFunction('claimArrivedDuringSigning',()=>f.claimedTokens.add(71));
  await p.evaluate(()=>{
   const sign=noirwallet.zcash.signMessage;
   noirwallet.zcash.signMessage=async(...args)=>{
    const result=await sign(...args);
    if(String(args[0]).startsWith('ZB1:CLAIM:v1')){S.leasePromise=Promise.resolve(S.miningLease);await claimArrivedDuringSigning()}
    return result;
   };
  });
  await p.locator('#submitClaimBtn').click();await p.waitForFunction(()=>walletTest.signs>=2&&!S.walletAction);
  assert.equal(await p.evaluate(()=>walletTest.sends),0);assert.equal(await p.evaluate(()=>loadFreeClaimRecovery(71)),null);
  assert.equal(await p.locator('[data-candidate="71"]').count(),0);assert.deepEqual(f.errors,[]);
 }finally{await f.browser.close()}
});
