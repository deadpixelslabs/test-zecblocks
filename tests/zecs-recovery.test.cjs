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
