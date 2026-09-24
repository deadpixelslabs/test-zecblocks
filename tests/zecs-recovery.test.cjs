const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const source=html.slice(html.indexOf('const ZECS_MINT_MESSAGE='),html.indexOf("$('zecsMintBtn').onclick=mintZecs;"));
const owner='11'.repeat(32),txid='ab'.repeat(32),other='cd'.repeat(32);
function fixture(){
  const data=new Map(),elements=new Map(),rows=new Map(),calls=[];
  const state={ownerCommitment:owner,walletEpoch:1,connection:{},zecsStats:{mint_open:true},zecsAccount:{eligible:true}};
  const c={S:state,console,Set,Map,Date,JSON,Number,String,Array,Math,Promise,
    localStorage:{getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k)},
    $:id=>{if(!elements.has(id))elements.set(id,{textContent:'',className:'',setAttribute(){},replaceChildren(){},appendChild(){}});return elements.get(id)},
    durableSet:(k,v)=>data.set(k,String(v)),
    zcashTxidFromResult:v=>typeof v==='string'?v:v?.txid||'',historyRows:x=>x,historyMemo:x=>x.memo,
    assertActionWallet:()=>{if(state.ownerCommitment!==owner||state.walletEpoch!==1)throw Error('Wallet changed.');},
    rpc:async(method)=>{calls.push(method);throw Error('Noir read timed out. Reopen the wallet and retry.');},
    toast:()=>{},renderZecsExperience:()=>{},
    backendJson:async(op,{body})=>{calls.push(body.action);if(body.action==='lookup')return {ok:true,rows:body.txids.map(id=>rows.get(id)).filter(Boolean)};if(body.action==='register'){rows.set(body.txid,{txid:body.txid,owner_commitment:owner,status:'pending'});return {ok:true,txid:body.txid,owner_commitment:owner,status:'pending'}};throw Error('Unexpected action '+body.action)},
    supabaseRpc:async(name)=>name==='zecblocks_zb20_stats'?{mint_open:true}:state.zecsAccount,
    esc:s=>String(s).replaceAll('<','&lt;'),short:s=>s.slice(0,8),
  };
  vm.createContext(c);vm.runInContext(source,c);c.updateZecsUI=()=>{};
  vm.runInContext(html.slice(html.indexOf('function rememberWalletBroadcast('),html.indexOf('function claimRecoveryNotice(')),c);
  return {c,state,rows,calls,data,status:()=>c.$('zecsStatus').textContent,
    lock:value=>c.saveZecsBroadcastLock(value),
    saved:(id=txid)=>data.set('zb20_zecs_registration_v1_'+owner,JSON.stringify({owner,txid:id,body:{txid:id,message:'fixture',anchorSignature:'saved'}})),
  };
}
test('manual recovery resolves a saved confirmed TXID without wallet history',async()=>{
  const f=fixture();f.lock({status:'txid_known',txid});f.rows.set(txid,{txid,owner_commitment:owner,status:'confirmed'});
  await f.c.recoverZecsMint();
  assert.equal(f.c.loadZecsBroadcastLock(),null);assert.equal(f.calls.includes('zcash_getTransactionHistory'),false);
  assert.match(f.status(),/confirmed/i);
});
test('manual recovery retries a saved registration without wallet history or another signature',async()=>{
  const f=fixture();f.lock({status:'txid_known',txid});f.saved();
  await f.c.recoverZecsMint();
  assert.equal(f.c.loadZecsBroadcastLock(),null);assert.equal(f.c.loadZecsRegistration(),null);
  assert.ok(f.calls.includes('register'));assert.equal(f.calls.some(x=>x.startsWith('zcash_')),false);
});
test('a registration-only journal is recovered and remains a mint gate until acknowledgement',async()=>{
  const f=fixture();f.saved();
  await f.c.recoverZecsMint();assert.equal(f.c.loadZecsRegistration(),null);assert.ok(f.calls.includes('register'));
});
test('failed registration remains durable and its error survives state refresh',async()=>{
  const f=fixture();f.lock({status:'txid_known',txid});f.saved();
  const base=f.c.backendJson;f.c.backendJson=async(...args)=>{if(args[1].body.action==='register')throw Error('Registration temporarily unavailable');return base(...args)};
  await f.c.recoverZecsMint();assert.ok(f.c.loadZecsBroadcastLock());assert.ok(f.c.loadZecsRegistration());
  await f.c.loadZecsState();await new Promise(r=>setImmediate(r));
  assert.match(f.status(),/Registration temporarily unavailable/);
});
test('one unresolved record cannot prevent clearing another acknowledged record',async()=>{
  const f=fixture();f.lock({status:'recovery_required',found:[txid,other]});
  f.rows.set(txid,{txid,owner_commitment:owner,status:'rejected',reject_reason:'fixture rejection'});
  f.rows.set(other,{txid:other,owner_commitment:owner,status:'confirmed'});
  await f.c.recoverZecsMint();
  assert.deepEqual(Array.from(f.c.loadZecsBroadcastLock().found),[txid]);assert.match(f.status(),/1.*(review|unresolved|attention)/i);
});
test('another owner registration never unlocks this wallet',async()=>{
  const f=fixture();f.lock({status:'txid_known',txid});f.rows.set(txid,{txid,owner_commitment:'ff'.repeat(32),status:'confirmed'});
  await f.c.recoverZecsMint();assert.ok(f.c.loadZecsBroadcastLock());assert.match(f.status(),/another wallet/i);
});
test('unknown broadcast with empty wallet history stays locked',async()=>{
  const f=fixture();f.lock({status:'broadcast_unknown'});f.c.rpc=async()=>[];
  await f.c.recoverZecsMint();assert.ok(f.c.loadZecsBroadcastLock());assert.match(f.status(),/TXID|transaction ID/i);
});
test('background recovery resolves acknowledged members of a partial queue without prompting',async()=>{
  const f=fixture();f.lock({status:'recovery_required',found:[txid,other]});f.rows.set(other,{txid:other,owner_commitment:owner,status:'confirmed'});
  await f.c.resumeZecsRegistration();assert.deepEqual(Array.from(f.c.loadZecsBroadcastLock().found),[txid]);
  assert.equal(f.calls.some(x=>x.startsWith('zcash_')),false);
});
test('wallet switch during lookup preserves the original journal and does not sign',async()=>{
  const f=fixture();f.lock({status:'txid_known',txid});
  f.c.backendJson=async()=>{f.state.ownerCommitment='ff'.repeat(32);f.state.walletEpoch++;return {ok:true,rows:[]}};
  await f.c.recoverZecsMint();
  assert.equal(JSON.parse(f.data.get('zb20_zecs_broadcast_lock_v2_'+owner)).txid,txid);
  assert.equal(f.data.has('zb20_zecs_broadcast_lock_v2_'+f.state.ownerCommitment),false);
  assert.equal(f.calls.some(x=>x.startsWith('zcash_')),false);
});
test('a failed signature does not strand an already confirmed mint later in the queue',async()=>{
  const f=fixture();f.lock({status:'recovery_required',found:[txid,other]});f.rows.set(other,{txid:other,owner_commitment:owner,status:'confirmed'});
  await f.c.recoverZecsMint();assert.deepEqual(Array.from(f.c.loadZecsBroadcastLock().found),[txid]);
  assert.equal(f.calls.includes('zcash_sendTransaction'),false);
});
test('registration acknowledgement must match both TXID and wallet',async()=>{
  for(const mismatch of [{txid:other,owner_commitment:owner},{txid,owner_commitment:'ff'.repeat(32)}]){
    const f=fixture();f.lock({status:'txid_known',txid});f.saved();const base=f.c.backendJson;
    f.c.backendJson=async(...args)=>args[1].body.action==='register'?{ok:true,status:'confirmed',...mismatch}:base(...args);
    await f.c.recoverZecsMint();assert.ok(f.c.loadZecsRegistration());assert.ok(f.c.loadZecsBroadcastLock());
  }
});
test('recovering unrelated historical mints cannot clear an unidentified broadcast',async()=>{
  const f=fixture();f.lock({status:'broadcast_unknown'});f.rows.set(txid,{txid,owner_commitment:owner,status:'confirmed'});
  f.c.rpc=async()=>[{txid,memo:'{"p":"zb-20","op":"mint","tick":"ZECS","amt":"210"}'}];
  await f.c.recoverZecsMint();assert.equal(f.c.loadZecsBroadcastLock().unidentified,true);assert.match(f.status(),/no TXID/);
});
test('late broadcast response identifies its own mint without discarding other pending TXIDs',()=>{
  const f=fixture();f.lock({status:'broadcast_unknown',unidentified:true,found:[other]});
  f.c.rememberWalletBroadcast(owner,'{"p":"zb-20","op":"mint","tick":"ZECS","amt":"210"}',{txid});
  const lock=f.c.loadZecsBroadcastLock();assert.equal(lock.unidentified,false);
  assert.deepEqual(new Set(lock.found),new Set([other,txid]));
  f.c.completeZecsRecord(txid,owner);assert.deepEqual(Array.from(f.c.loadZecsBroadcastLock().found),[other]);
});
test('a partial batch retains all transactions beyond the twelve-registration limit',async()=>{
  const f=fixture(),ids=Array.from({length:15},(_,i)=>(i+1).toString(16).padStart(64,'0'));
  f.lock({status:'recovery_required',found:ids});let registered=0;
  f.c.registerZecsMintTx=async id=>{registered++;f.c.completeZecsRecord(id,owner);return {ok:true,status:'pending'}};
  await f.c.recoverZecsMint();assert.equal(registered,12);assert.deepEqual(Array.from(f.c.loadZecsBroadcastLock().found),ids.slice(12));
});
test('registered recovery results automatically advance to confirmation without another click',async()=>{
  const f=fixture();f.lock({status:'txid_known',txid});f.rows.set(txid,{txid,owner_commitment:owner,status:'pending'});
  await f.c.recoverZecsMint();assert.equal(f.c.loadZecsBroadcastLock(),null);
  assert.match(f.c.$('zecsRecoveryList').innerHTML,/Waiting for Zcash confirmation/);
  f.rows.set(txid,{txid,owner_commitment:owner,status:'confirmed'});
  await f.c.loadZecsState();await new Promise(r=>setImmediate(r));
  assert.match(f.c.$('zecsRecoveryList').innerHTML,/Confirmed on Zcash/);
  assert.equal(f.c.zecsAwaitingConfirmation().length,0);
});
test('discovery excludes failed operations and incoming memos without hiding valid or legacy sends',async()=>{
  const f=fixture(),memo='{"p":"zb-20","op":"mint","tick":"ZECS","amt":"210"}';
  f.c.rpc=async()=>[
    {txid,memo,type:'send',status:'failed'},
    {txid:other,memo,type:'receive',status:'mined'},
    {txid:'ef'.repeat(32),memo,type:'send',status:'pending',timestamp:1700000000000},
    {txid:'12'.repeat(32),memo,type:'send',status:'mined',timestamp:1700000001000},
    {txid:'34'.repeat(32),memo},
  ];
  const candidates=await f.c.zecsMintHistoryCandidates();
  assert.deepEqual(Array.from(candidates,x=>x.txid),['12'.repeat(32),'ef'.repeat(32),'34'.repeat(32)]);
  assert.equal(candidates[0].timestamp,1700000001);
});
test('explicit selection of the matching outgoing mint resolves an unidentified broadcast without a send',async()=>{
  const f=fixture();f.lock({status:'broadcast_unknown',startedAt:1700000000});
  f.c.rpc=async method=>{f.calls.push(method);assert.equal(method,'zcash_getTransactionHistory');return [{txid,type:'send',status:'mined',timestamp:1700000001000,memo:'{"p":"zb-20","op":"mint","tick":"ZECS","amt":"210"}'}]};
  f.rows.set(txid,{txid,owner_commitment:owner,status:'confirmed'});
  await f.c.recoverZecsMint('0x'+txid.toUpperCase());
  assert.equal(f.c.loadZecsBroadcastLock(),null);assert.equal(f.c.loadZecsPendingTxid(),'');
  assert.match(f.status(),/Recovery complete/);assert.equal(f.calls.includes('zcash_sendTransaction'),false);
});
test('manual selection retains a concrete recovery journal through signature rejection',async()=>{
  const f=fixture();f.lock({status:'broadcast_unknown',startedAt:1700000000});
  f.c.rpc=async method=>{f.calls.push(method);if(method==='zcash_getTransactionHistory')return [{txid,type:'send',status:'pending',timestamp:1700000001000,memo:'{"p":"zb-20","op":"mint","tick":"ZECS","amt":"210"}'}];throw Error('User rejected signature')};
  await f.c.recoverZecsMint(txid);
  assert.equal(f.c.loadZecsBroadcastLock().unidentified,false);
  assert.equal(f.c.loadZecsPendingTxid(),txid);assert.equal(f.c.zecsRecoveryRequired(),true);
  assert.equal(f.calls.includes('zcash_sendTransaction'),false);
});
test('manual recovery rejects incoming, failed, stale, unknown-type and foreign-wallet transactions before changing the lock',async()=>{
  for(const details of [{type:'receive'},{status:'failed'},{timestamp:1600000000000},{type:''},{foreign:true},{timestamp:0}]){
    const f=fixture(),lock={status:'broadcast_unknown',startedAt:1700000000};f.lock(lock);
    f.c.rpc=async()=>[{txid,type:'send',status:'mined',timestamp:1700000001000,memo:'{"p":"zb-20","op":"mint","tick":"ZECS","amt":"210"}',...details}];
    if(details.foreign)f.rows.set(txid,{txid,owner_commitment:'ff'.repeat(32),status:'confirmed'});
    await f.c.recoverZecsMint(txid);
    assert.deepEqual(JSON.parse(JSON.stringify(f.c.loadZecsBroadcastLock())),lock);
    assert.equal(f.c.loadZecsPendingTxid(),'');assert.equal(f.calls.includes('register'),false);
  }
});
test('wallet switch during manual history verification cannot change either wallet journal',async()=>{
  const f=fixture();f.lock({status:'broadcast_unknown'});
  f.c.rpc=async()=>{f.state.ownerCommitment='ff'.repeat(32);f.state.walletEpoch++;return [{txid,type:'send',status:'mined',memo:'{"p":"zb-20","op":"mint","tick":"ZECS","amt":"210"}'}]};
  await f.c.recoverZecsMint(txid);
  assert.equal(JSON.parse(f.data.get('zb20_zecs_broadcast_lock_v2_'+owner)).status,'broadcast_unknown');
  assert.equal(f.data.has('zb20_zecs_broadcast_lock_v2_'+f.state.ownerCommitment),false);
});

test('an ambiguous new mint retains its original attempt time and history baseline',async()=>{
  for(const result of ['throw','unsupported']){
    const f=fixture();f.c.CFG={mailbox:'test-mailbox'};f.c.walletRejected=()=>false;f.c.insufficientFundsError=()=>false;
    f.c.zecsUnregisteredHistoryMints=async()=>({candidates:[{txid:other}],missing:[],registered:[]});
    f.c.zecsFunction=async()=>({ok:true,eligible:true,mint_open:true});
    let before;
    f.c.rpc=async(method)=>{assert.equal(method,'zcash_sendTransaction');before=f.c.loadZecsBroadcastLock();if(result==='throw')throw Error('Connection lost');return {accepted:true}};
    await f.c.mintZecs();const lock=f.c.loadZecsBroadcastLock();
    assert.equal(lock.startedAt,before.startedAt);assert.deepEqual(Array.from(lock.historyBefore),[other]);assert.equal(lock.unidentified,true);
  }
});
test('one recent candidate is suggested without automatically unlocking or registering an unknown broadcast',async()=>{
  const f=fixture();f.lock({status:'broadcast_unknown',startedAt:1700000000,historyBefore:[]});
  f.c.rpc=async()=>[{txid,type:'send',status:'mined',timestamp:1700000001000,memo:'{"p":"zb-20","op":"mint","tick":"ZECS","amt":"210"}'}];
  await f.c.recoverZecsMint();
  assert.equal(f.c.$('zecsRecoveryTxid').value,txid);assert.equal(f.c.zecsRecoveryRequired(),true);
  assert.equal(f.calls.includes('register'),false);assert.match(f.status(),/Check the TXID/);
});
test('suggestions reject old, untimed, ambiguous, failed, incoming and pre-existing candidates',()=>{
  const f=fixture(),lock={startedAt:1000,historyBefore:[other]},candidate={txid,type:'send',status:'mined',timestamp:1010};
  assert.equal(f.c.suggestZecsBroadcast([candidate],lock).txid,txid);
  for(const changes of [{timestamp:0},{timestamp:999},{timestamp:1121},{status:'failed'},{type:'receive'},{txid:other}]){
    assert.equal(f.c.suggestZecsBroadcast([{...candidate,...changes}],lock),null);
  }
  assert.equal(f.c.suggestZecsBroadcast([candidate,{...candidate,txid:'ef'.repeat(32)}],lock),null);
});
test('explicit recovery cannot substitute a mint already present in the attempt baseline',async()=>{
  const f=fixture(),lock={status:'broadcast_unknown',startedAt:1700000000,historyBefore:[txid]};f.lock(lock);
  f.c.rpc=async()=>[{txid,type:'send',status:'mined',timestamp:1700000001000,memo:'{"p":"zb-20","op":"mint","tick":"ZECS","amt":"210"}'}];
  await f.c.recoverZecsMint(txid);
  assert.deepEqual(JSON.parse(JSON.stringify(f.c.loadZecsBroadcastLock())),lock);assert.equal(f.c.loadZecsPendingTxid(),'');
});

const foreign='ff'.repeat(32),archiveKey=id=>'zb20_zecs_foreign_mint_v1_'+owner+'_'+id;
test('foreign history-only locks self-heal in both manual and background recovery without wallet prompts',async()=>{
  for(const method of ['recoverZecsMint','resumeZecsRegistration'])for(const status of ['pending','confirmed']){
    const f=fixture(),lock={status:'recovery_required',found:[txid],detectedAt:1700000000};f.lock(lock);
    f.rows.set(txid,{txid,owner_commitment:foreign,status});
    await f.c[method]();
    assert.equal(f.c.zecsRecoveryRequired(),false);
    const archive=JSON.parse(f.data.get(archiveKey(txid)));
    assert.deepEqual(archive.broadcastLock.found,[txid]);assert.equal(archive.lookup.owner_commitment,foreign);
    assert.equal(archive.reason,'history_discovery');
    assert.equal(f.calls.some(x=>x.startsWith('zcash_')||x==='register'),false);
    assert.equal(f.c.zecsAwaitingConfirmation().length,0);
    assert.match(f.c.$('zecsRecoveryList').innerHTML,/another wallet/);
  }
});
test('fresh discovery of an already registered foreign mint does not poison the recovery gate',async()=>{
  const f=fixture();f.rows.set(txid,{txid,owner_commitment:foreign,status:'confirmed'});
  f.c.rpc=async method=>{f.calls.push(method);return [{txid,type:'send',status:'mined',memo:'{"p":"zb-20","op":"mint","tick":"ZECS","amt":"210"}'}]};
  await f.c.recoverZecsMint();assert.equal(f.c.zecsRecoveryRequired(),false);
  assert.match(f.status(),/0 confirmed.*1 history item/);assert.equal(f.calls.includes('register'),false);
  const scan=await f.c.zecsUnregisteredHistoryMints();assert.equal(scan.missing.length,0);
});
test('foreign history cleanup preserves every unresolved member of a mixed queue',async()=>{
  const f=fixture();f.lock({status:'recovery_required',found:[txid,other]});
  f.rows.set(txid,{txid,owner_commitment:foreign,status:'confirmed'});
  await f.c.resumeZecsRegistration();
  assert.deepEqual(Array.from(f.c.loadZecsBroadcastLock().found),[other]);assert.ok(f.data.get(archiveKey(txid)));
  assert.equal(f.calls.some(x=>x.startsWith('zcash_')),false);
});
test('discovery cleanup never silently discards a send, signature, attempt or unknown broadcast',async()=>{
  for(const evidence of ['pending','signature','txid','startedAt','historyBefore','unidentified','broadcast_unknown']){
    const f=fixture(),lock={status:'recovery_required',found:[txid]};
    if(evidence==='pending')f.c.saveZecsPendingTxid(txid);
    else if(evidence==='signature')f.saved();
    else if(evidence==='broadcast_unknown')lock.status='broadcast_unknown';
    else lock[evidence]=evidence==='txid'?txid:evidence==='historyBefore'?[]:true;
    f.lock(lock);f.rows.set(txid,{txid,owner_commitment:foreign,status:'confirmed'});
    await f.c.resumeZecsRegistration();
    assert.equal(f.c.zecsRecoveryRequired(),true);assert.equal(f.data.has(archiveKey(txid)),false);
  }
});
test('a confirmed ownership conflict can be explicitly set aside with its full journal retained',async()=>{
  const f=fixture();f.lock({status:'txid_known',txid,startedAt:1700000000,historyBefore:[]});f.c.saveZecsPendingTxid(txid);f.saved();
  f.rows.set(txid,{txid,owner_commitment:foreign,status:'confirmed'});
  await f.c.resumeZecsRegistration();assert.equal(f.c.zecsRecoveryRequired(),true);
  assert.match(f.c.$('zecsRecoveryList').innerHTML,/Remove from pending queue/);
  await f.c.setAsideZecsForeignMint(txid);assert.equal(f.c.zecsRecoveryRequired(),false);
  const archive=JSON.parse(f.data.get(archiveKey(txid)));
  assert.equal(archive.broadcastLock.txid,txid);assert.equal(archive.pendingTxid,txid);
  assert.equal(archive.registration.body.anchorSignature,'saved');assert.equal(archive.reason,'user_set_aside');
  assert.equal(f.calls.some(x=>x.startsWith('zcash_')||x==='register'),false);
  await f.c.setAsideZecsForeignMint(txid);assert.equal(f.data.get(archiveKey(txid)),JSON.stringify(archive));
});
test('set-aside rechecks confirmed foreign ownership and cannot bypass an unidentified broadcast',async()=>{
  for(const scenario of ['own','pending','invalid','missing','unknown','legacy_unknown','wallet_switch','lookup_error']){
    const f=fixture(),lock={status:'txid_known',txid};
    if(scenario==='unknown')lock.unidentified=true;
    if(scenario==='legacy_unknown'){delete lock.txid;lock.status='broadcast_unknown';lock.found=[txid]}
    f.lock(lock);f.c.saveZecsPendingTxid(txid);
    if(scenario!=='missing')f.rows.set(txid,{txid,owner_commitment:scenario==='own'?owner:foreign,status:['pending','invalid'].includes(scenario)?scenario:'confirmed'});
    if(scenario==='wallet_switch')f.c.backendJson=async()=>{f.state.ownerCommitment=foreign;f.state.walletEpoch++;return {ok:true,rows:[{txid,owner_commitment:foreign,status:'confirmed'}]}};
    if(scenario==='lookup_error')f.c.backendJson=async()=>{throw Error('unavailable')};
    await f.c.setAsideZecsForeignMint(txid);
    assert.ok(f.data.get('zb20_zecs_broadcast_lock_v2_'+owner));
    assert.equal(f.data.get('zb20_zecs_pending_mint_txid_'+owner),txid);assert.equal(f.data.has(archiveKey(txid)),false);
    assert.equal(f.calls.some(x=>x.startsWith('zcash_')||x==='register'),false);
  }
});
test('an archive write failure preserves the queue in automatic and explicit recovery',async()=>{
  for(const explicit of [false,true]){
    const f=fixture();f.lock(explicit?{status:'txid_known',txid}:{status:'recovery_required',found:[txid]});
    f.rows.set(txid,{txid,owner_commitment:foreign,status:'confirmed'});
    f.c.durableSet=()=>{throw Error('Recovery storage unavailable')};
    await f.c[explicit?'setAsideZecsForeignMint':'resumeZecsRegistration'](txid);
    assert.equal(f.c.zecsRecoveryRequired(),true);assert.equal(f.data.has(archiveKey(txid)),false);
  }
});
test('setting aside one conflict retains another exact send and signature',async()=>{
  const f=fixture();f.lock({status:'txid_known',txid:other,found:[txid,other],startedAt:1700000000});f.c.saveZecsPendingTxid(other);f.saved(other);
  f.rows.set(txid,{txid,owner_commitment:foreign,status:'confirmed'});
  // Avoid background registration while observing the queue immediately after the explicit action.
  f.c.loadZecsState=async()=>{};
  await f.c.setAsideZecsForeignMint(txid);
  assert.equal(f.c.loadZecsBroadcastLock().txid,other);assert.deepEqual(Array.from(f.c.loadZecsBroadcastLock().found),[other]);
  assert.equal(f.c.loadZecsPendingTxid(),other);assert.equal(f.c.loadZecsRegistration().txid,other);
});
