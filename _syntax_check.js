'use strict';
const CFG={
  genesisTxid:'ecf6fc3a79885f573d79de70a2de85c34667fc1a4fefe034d3a4015269379f0f',
  mailbox:'u1qqjyaypzmvgfnc9uatk5t0f6hmge6htpfck3d366nhx94450crtznujwn8kql9u39uzdqcdg8flzk3tmf32j2p4u0xvx370xwcjjsrmd',
  treasury:'t1b9PCdoCncgoc13CWwWz8tzZZLDYfMaTyz',
  supply:5000,powBits:26,freeClaims:500,paidClaimFeeZat:130000,marketFeeBps:300,
  explorer:'/api/zcash',
  relays:['wss://relay.damus.io','wss://nos.lol','wss://relay.primal.net','wss://relay.nostr.band'],
  nostrKind:30078,relayTag:'zb1-mainnet-v1'
};
const S={provider:null,connection:null,pubkey:null,ownerCommitment:null,balance:null,genesisHeight:null,target:null,proof:null,workers:[],mining:false,hashes:0,startMs:0,relay:null,nostr:null,events:[],claims:new Map(),transfers:[],listings:new Map(),offers:[],nostrSk:null,nostrPk:null,currentOfferListing:null,gpu:null,gpuStop:false,miningEngine:null,claimWatchTimer:null,claimCheckCache:new Map()};
const $=id=>document.getElementById(id); const enc=new TextEncoder();
function esc(v){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function toast(msg,ms=4200){const t=$('toast');t.textContent=msg;t.classList.add('show');clearTimeout(toast._t);toast._t=setTimeout(()=>t.classList.remove('show'),ms)}
function short(v,n=8){v=String(v||'');return v.length>n*2+1?v.slice(0,n)+'…'+v.slice(-n):v}
function hexToBytes(hex){hex=hex.replace(/^0x/,'');if(hex.length%2)hex='0'+hex;const a=new Uint8Array(hex.length/2);for(let i=0;i<a.length;i++)a[i]=parseInt(hex.slice(i*2,i*2+2),16);return a}
function bytesToHex(a){return [...a].map(x=>x.toString(16).padStart(2,'0')).join('')}
async function sha256Bytes(bytes){return new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))}
async function sha256HexBytes(bytes){return bytesToHex(await sha256Bytes(bytes))}
function u32le(n){const a=new Uint8Array(4);new DataView(a.buffer).setUint32(0,n,true);return a}
function u64le(n){let x=BigInt(n),a=new Uint8Array(8);for(let i=0;i<8;i++){a[i]=Number(x&255n);x>>=8n}return a}
function concat(...arr){const n=arr.reduce((s,a)=>s+a.length,0),o=new Uint8Array(n);let p=0;for(const a of arr){o.set(a,p);p+=a.length}return o}
function leadingZeroBits(bytes){let n=0;for(const b of bytes){if(b===0){n+=8;continue}for(let m=0x80;(b&m)===0;m>>=1)n++;break}return n}
function formatRate(hps){if(hps>=1e6)return (hps/1e6).toFixed(2)+' MH/s';if(hps>=1e3)return (hps/1e3).toFixed(1)+' kH/s';return Math.round(hps)+' H/s'}
function decimalValid(v){return /^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/.test(String(v))&&Number(v)>0}
function localEvents(){try{return JSON.parse(localStorage.getItem('zb1_events_v1')||'[]')}catch{return[]}}
function saveLocalEvent(e){const a=localEvents();if(!a.some(x=>x.eventId===e.eventId||x.txid&&x.txid===e.txid)){a.push(e);localStorage.setItem('zb1_events_v1',JSON.stringify(a.slice(-10000)))}}
function nostrSecretHex(){let h=localStorage.getItem('zb1_nostr_sk');return h||null}
function setNostrSecretHex(h){localStorage.setItem('zb1_nostr_sk',h)}
function provider(){const w=window.noirwallet;return w&&w.isNoirWallet&&w.zcash?w.zcash:null}
async function rpc(method,params){const p=provider();if(!p)throw new Error('Noir Wallet is not installed. Install the official mainnet extension first.');return p.request({method,...(params?{params}: {})})}
async function connectWallet(silent=false){
  try{
    const p=provider(); if(!p){if(!silent){toast('Noir Wallet not detected. Opening the official setup guide.');window.open('https://docs.zknoir.com/get-started/','_blank','noopener')}return}
    const c=await rpc(silent?'zcash_getAccounts':'zcash_requestAccounts'); if(!c)return;
    S.provider=p;S.connection=c;
    const k=await rpc('zcash_getPublicKey',[{signingMode:'derived'}]); if(!k?.pubkey)throw new Error('Noir Wallet did not return a derived public key.');
    S.pubkey=k.pubkey;S.ownerCommitment=await sha256HexBytes(hexToBytes(k.pubkey));
    try{S.balance=await rpc('zcash_getBalance')}catch{}
    updateWalletUI(); await loadWalletHistory(); await refreshAll();
    p.on?.('accountsChanged',()=>connectWallet(true).catch(()=>{}));
  }catch(e){if(!silent)toast(e.message||String(e),7000)}
}
function updateWalletUI(){
  const connected=!!S.connection;
  $('walletBtn').textContent=connected?short(S.ownerCommitment,6):'Connect Noir Wallet';
  $('ownerCommit').textContent=connected?short(S.ownerCommitment,12):'Connect wallet';
  $('portfolioCommit').textContent=connected?S.ownerCommitment:'Connect wallet to reveal your commitment.';
  $('portfolioShielded').textContent=connected?(S.connection.shielded||'—'):'Private until you connect.';
  $('zecBalance').textContent=S.balance?.available!=null?String(S.balance.available)+' ZEC':'—';
  $('loadTargetBtn').disabled=!connected;$('findUnclaimedBtn').disabled=!connected;$('startMineBtn').disabled=!connected||S.mining;$('syncPortfolioBtn').disabled=!connected;$('createListingBtn').disabled=!connected||ownedTokens().length===0;
}
$('walletBtn').onclick=()=>connectWallet(false);
async function loadWalletHistory(){
  if(!S.connection)return;
  try{const hist=await rpc('zcash_getTransactionHistory');for(const h of (hist||[])){const memo=h.memo||'';if(memo.startsWith('ZB1|')){const e=parseMemo(memo);if(e){e.txid=h.txid;e.status=h.status;e.timestamp=h.timestamp||Date.now()/1000;e.source='wallet';saveLocalEvent(normalizeEvent(e))}}}}catch(e){console.warn('history',e)}
}
function parseMemo(m){const p=m.split('|');if(p[0]!=='ZB1'||p.length<3)return null;const type={C:'CLAIM',T:'TRANSFER'}[p[1]]||p[1];const e={protocol:'ZB1',type,v:Number(p[2])||1,memo:m};for(const x of p.slice(3)){const i=x.indexOf('=');if(i>0)e[x.slice(0,i)]=x.slice(i+1)}if(type==='CLAIM'){e.tokenId=Number(e.T);e.nonce=e.N;e.pubkey=e.K;e.signature=e.S}else if(type==='TRANSFER'){e.tokenId=Number(e.I);e.toCommitment=e.O;e.pubkey=e.K;e.signature=e.S}return e}
function normalizeEvent(e){return {...e,eventId:e.eventId||e.txid||crypto.randomUUID(),timestamp:Number(e.timestamp)||Math.floor(Date.now()/1000)}}
async function explorerFetch(kind,id){
  const url=CFG.explorer+'?kind='+encodeURIComponent(kind)+(id!=null?'&id='+encodeURIComponent(String(id)):'');
  let r;
  try{r=await fetch(url,{headers:{accept:'application/json'},cache:'no-store'})}
  catch(e){throw new Error('Chain-data proxy unreachable. Upload the api/zcash.js file together with index.html.')}
  let j=null;try{j=await r.json()}catch{}
  if(!r.ok)throw new Error(j?.error||('Chain-data proxy error '+r.status));
  return j?.data??j;
}
function deepFind(obj,keys){if(!obj||typeof obj!=='object')return null;for(const k of keys)if(obj[k]!=null)return obj[k];for(const v of Object.values(obj)){if(v&&typeof v==='object'){const x=deepFind(v,keys);if(x!=null)return x}}return null}
async function resolveGenesis(){
  if(S.genesisHeight)return S.genesisHeight;
  const cached=Number(localStorage.getItem('zb1_genesis_height')||0);
  if(cached){S.genesisHeight=cached;updateGenesisUI();return cached}
  try{
    const j=await explorerFetch('tx',CFG.genesisTxid);
    const h=Number(deepFind(j,['blockHeight','block_height','blockheight','height']));
    if(!Number.isInteger(h)||h<100000)throw new Error('Confirmed Genesis height was not present in chain-data response.');
    S.genesisHeight=h;localStorage.setItem('zb1_genesis_height',String(h));updateGenesisUI();return h;
  }catch(e){$('gHeight').textContent='Chain data unavailable';$('heroHeight').textContent='Retry mining';throw e}
}
function updateGenesisUI(){if(!S.genesisHeight)return;$('gHeight').textContent=S.genesisHeight.toLocaleString();$('heroHeight').textContent=(S.genesisHeight-1).toLocaleString();}
function knownClaimForToken(token){
  return S.claims.get(Number(token))||null;
}
function setClaimStatus(text,kind=''){
  const el=$('claimStatus'); if(!el)return;
  el.textContent=text;
  el.style.color=kind==='good'?'#78d594':kind==='bad'?'#ff8989':kind==='warn'?'#f1cc76':'#d8d8d8';
}
function updateAvailabilityCounts(){
  const n=S.claims.size;
  $('knownClaimed').textContent=n.toLocaleString();
  $('knownAvailable').textContent=Math.max(0,CFG.supply-n).toLocaleString();
}
async function verifyClaimCandidate(ev,target){
  try{
    if(!ev||!target||!ev.txid||!/^[0-9a-f]{64}$/i.test(ev.txid))return {confirmed:false,proof:false};
    const owner=String(ev.ownerCommitment||'').toLowerCase(),nonce=String(ev.nonce??'');
    if(!/^[0-9a-f]{64}$/.test(owner)||!/^\d+$/.test(nonce))return {confirmed:false,proof:false};
    if(ev.sourceHash&&String(ev.sourceHash).toLowerCase()!==target.sourceHash)return {confirmed:false,proof:false};
    if(ev.sourceHeight&&Number(ev.sourceHeight)!==target.sourceHeight)return {confirmed:false,proof:false};
    const pre=concat(enc.encode('ZB1:MINE:v1'),hexToBytes(CFG.genesisTxid),u32le(target.token),hexToBytes(target.sourceHash),hexToBytes(owner),u64le(BigInt(nonce)));
    const h=await sha256Bytes(pre);
    if(leadingZeroBits(h)<CFG.powBits)return {confirmed:false,proof:false};
    let tx=null;
    try{tx=await explorerFetch('tx',ev.txid)}catch{}
    const bh=Number(deepFind(tx,['blockHeight','block_height','blockheight','height']));
    return {confirmed:Number.isInteger(bh)&&bh>0,proof:true,blockHeight:bh||null,txid:ev.txid};
  }catch{return {confirmed:false,proof:false}}
}
async function checkTargetAvailability(target,{refresh=true}={}){
  if(refresh)await fetchRelay();
  const ev=knownClaimForToken(target.token);
  if(!ev){
    setClaimStatus('AVAILABLE · no known claim','good');
    return {available:true,confirmed:false,event:null};
  }
  setClaimStatus('CLAIM DETECTED · verifying…','warn');
  const v=await verifyClaimCandidate(ev,target);
  if(v.proof&&v.confirmed){
    setClaimStatus('CLAIMED · confirmed on Zcash','bad');
    return {available:false,confirmed:true,event:ev,verify:v};
  }
  if(v.proof){
    setClaimStatus('CLAIM BROADCAST · confirmation pending','warn');
    return {available:false,confirmed:false,event:ev,verify:v};
  }
  setClaimStatus('CLAIM EVENT SEEN · choose another ID','warn');
  return {available:false,confirmed:false,event:ev,verify:v};
}
async function loadTarget(){
  try{
    if(!S.ownerCommitment)throw new Error('Connect Noir Wallet first.');
    const token=Number($('tokenInput').value);if(!Number.isInteger(token)||token<1||token>CFG.supply)throw new Error('Token ID must be 1–5000.');
    setClaimStatus('Checking discovery state…','warn');
    $('mineStatus').textContent='Loading source block…';$('hashLog').textContent='Resolving confirmed Genesis and source block from Zcash mainnet…';
    const gh=await resolveGenesis();const sh=gh-token;
    const j=await explorerFetch('block',sh);
    const hash=String(deepFind(j,['hash','block_hash','blockHash'])||'');
    if(!/^[0-9a-fA-F]{64}$/.test(hash))throw new Error('Could not resolve source block hash for height '+sh+'.');
    S.target={token,sourceHeight:sh,sourceHash:hash.toLowerCase()};S.proof=null;
    const availability=await checkTargetAvailability(S.target,{refresh:true});
    $('sourceInfo').textContent=sh.toLocaleString()+' · '+short(hash,10);
    artSvg($('heroArt'),hash+':'+sh,'ZB #'+token);$('heroToken').textContent='#'+token;$('heroHeight').textContent=sh.toLocaleString();
    if(!availability.available){
      $('mineStatus').textContent=availability.confirmed?'Already claimed':'Claim already detected';
      $('startMineBtn').disabled=true;$('submitClaimBtn').disabled=true;
      $('hashLog').textContent=availability.confirmed
        ?`ZEC BLOCK #${token} already has a confirmed claim.\nChoose another Token ID.`
        :`A claim for ZEC BLOCK #${token} is already visible in the discovery feed.\nChoose another Token ID to avoid wasting hashes.`;
      toast(`ZEC BLOCK #${token} is already claimed / being claimed. Choose another ID.`,8000);
      return false;
    }
    $('mineStatus').textContent='Target ready';$('startMineBtn').disabled=false;$('submitClaimBtn').disabled=true;
    $('hashLog').textContent='Target loaded. Source hash: '+hash+'\nNo known claim found for this Token ID. Ready to search the locked 26-bit SHA-256 proof with GPU/CPU.';
    return true;
  }catch(e){S.target=null;$('sourceInfo').textContent='Unavailable';setClaimStatus('Unavailable');$('mineStatus').textContent='Target load failed';$('hashLog').textContent='ERROR: '+(e.message||String(e));toast(e.message||String(e),8000);return false}
}
$('loadTargetBtn').onclick=loadTarget;
$('findUnclaimedBtn').onclick=async()=>{
  try{
    if(!S.ownerCommitment)throw new Error('Connect Noir Wallet first.');
    $('findUnclaimedBtn').disabled=true;
    await fetchRelay();
    let start=Number($('tokenInput').value)||1,found=null;
    for(let step=1;step<=CFG.supply;step++){
      const id=((start-1+step)%CFG.supply)+1;
      if(!S.claims.has(id)){found=id;break}
    }
    if(!found)throw new Error('No known unclaimed Token ID remains.');
    $('tokenInput').value=String(found);S.target=null;S.proof=null;
    setClaimStatus('Known unclaimed · load to verify','good');
    $('sourceInfo').textContent='Select a token';$('mineStatus').textContent='Idle';$('submitClaimBtn').disabled=true;$('startMineBtn').disabled=false;
    toast('Selected known-unclaimed ZEC BLOCK #'+found+'. Click Start Mining to verify and mine.');
  }catch(e){toast(e.message||String(e),7000)}
  finally{$('findUnclaimedBtn').disabled=!S.ownerCommitment}
};
$('tokenInput').addEventListener('input',()=>{
  S.target=null;S.proof=null;$('sourceInfo').textContent='Select a token';$('mineStatus').textContent='Idle';$('submitClaimBtn').disabled=true;
  const token=Number($('tokenInput').value),known=knownClaimForToken(token);
  if(Number.isInteger(token)&&token>=1&&token<=CFG.supply){
    if(known){setClaimStatus('KNOWN CLAIM · load to verify','warn');$('startMineBtn').disabled=true}
    else{setClaimStatus('Known unclaimed · load to verify','good');if(S.ownerCommitment&&!S.mining)$('startMineBtn').disabled=false}
  }else setClaimStatus('Select Token ID 1–5000');
});
function workerSource(){return `
const K=[1116352408,1899447441,-1245643825,-373957723,961987163,1508970993,-1841331548,-1424204075,-670586216,310598401,607225278,1426881987,1925078388,-2132889090,-1680079193,-1046744716,-459576895,-272742522,264347078,604807628,770255983,1249150122,1555081692,1996064986,-1740746414,-1473132947,-1341970488,-1084653625,-958395405,-710438585,113926993,338241895,666307205,773529912,1294757372,1396182291,1695183700,1986661051,-2117940946,-1838011259,-1564481375,-1474664885,-1035236496,-949202525,-778901479,-694614492,-200395387,275423344,430227734,506948616,659060556,883997877,958139571,1322822218,1537002063,1747873779,1955562222,2024104815,-2067236844,-1933114872,-1866530822,-1538233109,-1090935817,-965641998];
function rr(x,n){return(x>>>n)|(x<<(32-n))}function sha(m){const l=m.length,bit=l*8,n=((l+9+63)>>6)<<6,a=new Uint8Array(n);a.set(m);a[l]=128;const dv=new DataView(a.buffer);dv.setUint32(n-4,bit>>>0,false);dv.setUint32(n-8,Math.floor(bit/4294967296),false);let h0=1779033703,h1=-1150833019,h2=1013904242,h3=-1521486534,h4=1359893119,h5=-1694144372,h6=528734635,h7=1541459225,w=new Int32Array(64);for(let o=0;o<n;o+=64){for(let i=0;i<16;i++)w[i]=dv.getInt32(o+i*4,false);for(let i=16;i<64;i++){const x=w[i-15],y=w[i-2],s0=rr(x,7)^rr(x,18)^(x>>>3),s1=rr(y,17)^rr(y,19)^(y>>>10);w[i]=(w[i-16]+s0+w[i-7]+s1)|0}let a0=h0,b=h1,c=h2,d=h3,e=h4,f=h5,g=h6,h=h7;for(let i=0;i<64;i++){const S1=rr(e,6)^rr(e,11)^rr(e,25),ch=(e&f)^(~e&g),t1=(h+S1+ch+K[i]+w[i])|0,S0=rr(a0,2)^rr(a0,13)^rr(a0,22),maj=(a0&b)^(a0&c)^(b&c),t2=(S0+maj)|0;h=g;g=f;f=e;e=(d+t1)|0;d=c;c=b;b=a0;a0=(t1+t2)|0}h0=(h0+a0)|0;h1=(h1+b)|0;h2=(h2+c)|0;h3=(h3+d)|0;h4=(h4+e)|0;h5=(h5+f)|0;h6=(h6+g)|0;h7=(h7+h)|0}const out=new Uint8Array(32),od=new DataView(out.buffer);[h0,h1,h2,h3,h4,h5,h6,h7].forEach((x,i)=>od.setInt32(i*4,x,false));return out}
function zbits(b){let n=0;for(const x of b){if(x===0){n+=8;continue}for(let m=128;(x&m)===0;m>>=1)n++;break}return n}
onmessage=e=>{const {base,start,step,bits,batch}=e.data;const pre=new Uint8Array(base.length+8);pre.set(base);let nonce=BigInt(start),count=0,t=performance.now();for(;;){let x=nonce;for(let i=0;i<8;i++){pre[base.length+i]=Number(x&255n);x>>=8n}const h=sha(pre);count++;if(zbits(h)>=bits){postMessage({type:'found',nonce:nonce.toString(),hash:Array.from(h).map(x=>x.toString(16).padStart(2,'0')).join(''),count});return}nonce+=BigInt(step);if(count%batch===0){const now=performance.now();postMessage({type:'rate',count:batch,ms:now-t,nonce:nonce.toString()});t=now}}}`}

const GPU_SHA256_WGSL=`
const K = array<u32, 64>(
  0x428a2f98u,0x71374491u,0xb5c0fbcfu,0xe9b5dba5u,0x3956c25bu,0x59f111f1u,0x923f82a4u,0xab1c5ed5u,
  0xd807aa98u,0x12835b01u,0x243185beu,0x550c7dc3u,0x72be5d74u,0x80deb1feu,0x9bdc06a7u,0xc19bf174u,
  0xe49b69c1u,0xefbe4786u,0x0fc19dc6u,0x240ca1ccu,0x2de92c6fu,0x4a7484aau,0x5cb0a9dcu,0x76f988dau,
  0x983e5152u,0xa831c66du,0xb00327c8u,0xbf597fc7u,0xc6e00bf3u,0xd5a79147u,0x06ca6351u,0x14292967u,
  0x27b70a85u,0x2e1b2138u,0x4d2c6dfcu,0x53380d13u,0x650a7354u,0x766a0abbu,0x81c2c92eu,0x92722c85u,
  0xa2bfe8a1u,0xa81a664bu,0xc24b8b70u,0xc76c51a3u,0xd192e819u,0xd6990624u,0xf40e3585u,0x106aa070u,
  0x19a4c116u,0x1e376c08u,0x2748774cu,0x34b0bcb5u,0x391c0cb3u,0x4ed8aa4au,0x5b9cca4fu,0x682e6ff3u,
  0x748f82eeu,0x78a5636fu,0x84c87814u,0x8cc70208u,0x90befffau,0xa4506cebu,0xbef9a3f7u,0xc67178f2u
);
struct Params { startNonce:u32, count:u32, targetTop:u32, _pad:u32 };
struct Result { flag:atomic<u32>, nonce:atomic<u32> };
@group(0) @binding(0) var<storage, read> tmpl: array<u32>;
@group(0) @binding(1) var<storage, read> params: Params;
@group(0) @binding(2) var<storage, read_write> result: Result;
fn rotr(x:u32,n:u32)->u32{return (x>>n)|(x<<(32u-n));}
fn compress(inputState:array<u32,8>, block:array<u32,16>)->array<u32,8>{
  var w:array<u32,64>;
  for(var i:u32=0u;i<16u;i=i+1u){w[i]=block[i];}
  for(var i:u32=16u;i<64u;i=i+1u){
    let x=w[i-15u];let y=w[i-2u];
    let s0=rotr(x,7u)^rotr(x,18u)^(x>>3u);
    let s1=rotr(y,17u)^rotr(y,19u)^(y>>10u);
    w[i]=w[i-16u]+s0+w[i-7u]+s1;
  }
  var a=inputState[0];var b=inputState[1];var c=inputState[2];var d=inputState[3];
  var e=inputState[4];var f=inputState[5];var g=inputState[6];var h=inputState[7];
  for(var i:u32=0u;i<64u;i=i+1u){
    let S1=rotr(e,6u)^rotr(e,11u)^rotr(e,25u);let ch=(e&f)^((~e)&g);
    let t1=h+S1+ch+K[i]+w[i];let S0=rotr(a,2u)^rotr(a,13u)^rotr(a,22u);
    let maj=(a&b)^(a&c)^(b&c);let t2=S0+maj;
    h=g;g=f;f=e;e=d+t1;d=c;c=b;b=a;a=t1+t2;
  }
  return array<u32,8>(inputState[0]+a,inputState[1]+b,inputState[2]+c,inputState[3]+d,inputState[4]+e,inputState[5]+f,inputState[6]+g,inputState[7]+h);
}
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
  let idx=gid.x;if(idx>=params.count){return;}
  let nonce=params.startNonce+idx;
  var b0:array<u32,16>;for(var i:u32=0u;i<16u;i=i+1u){b0[i]=tmpl[i];}
  var state=array<u32,8>(0x6a09e667u,0xbb67ae85u,0x3c6ef372u,0xa54ff53au,0x510e527fu,0x9b05688cu,0x1f83d9abu,0x5be0cd19u);
  state=compress(state,b0);
  var b1:array<u32,16>;for(var i:u32=0u;i<16u;i=i+1u){b1[i]=tmpl[16u+i];}
  b1[11u]=(b1[11u]&0xffffff00u)|(nonce&0xffu);
  b1[12u]=((nonce>>8u)&0xffu)<<24u|((nonce>>16u)&0xffu)<<16u|((nonce>>24u)&0xffu)<<8u;
  b1[13u]=0x00000080u;
  state=compress(state,b1);
  if(state[0]<params.targetTop){
    atomicStore(&result.nonce,nonce);
    atomicStore(&result.flag,1u);
  }
}`;
async function mineBase(){return concat(enc.encode('ZB1:MINE:v1'),hexToBytes(CFG.genesisTxid),u32le(S.target.token),hexToBytes(S.target.sourceHash),hexToBytes(S.ownerCommitment))}
function gpuTemplateWords(base){
  if(base.length!==111)throw new Error('Unexpected ZB-1 mining preimage base length: '+base.length);
  const msg=new Uint8Array(128);msg.set(base,0);msg[119]=0x80;
  const bitLen=(base.length+8)*8;const dv=new DataView(msg.buffer);dv.setUint32(120,0,false);dv.setUint32(124,bitLen,false);
  const w=new Uint32Array(32);for(let i=0;i<32;i++)w[i]=dv.getUint32(i*4,false);return w
}
async function initGpuMiner(){
  if(S.gpu?.device)return S.gpu;
  if(!navigator.gpu)throw new Error('WebGPU is not available in this browser.');
  const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});if(!adapter)throw new Error('No WebGPU adapter found.');
  const device=await adapter.requestDevice();
  const module=device.createShaderModule({code:GPU_SHA256_WGSL});
  const info=await module.getCompilationInfo();const errs=info.messages.filter(x=>x.type==='error');if(errs.length)throw new Error('WebGPU SHA-256 shader compile error: '+errs.map(x=>x.message).join(' | '));
  const pipeline=device.createComputePipeline({layout:'auto',compute:{module,entryPoint:'main'}});
  S.gpu={adapter,device,pipeline};
  device.lost.then(()=>{S.gpu=null;if(S.mining&&S.miningEngine==='GPU'){S.gpuStop=true;toast('GPU device was lost. Restart mining to use CPU fallback.',7000)}});
  return S.gpu
}
async function verifyGpuCandidate(base,nonce){
  const pre=concat(base,u64le(BigInt(nonce)));const h=await sha256Bytes(pre);return leadingZeroBits(h)>=CFG.powBits?bytesToHex(h):null
}
async function startGpuMining(base){
  const {device,pipeline}=await initGpuMiner();S.miningEngine='GPU';S.gpuStop=false;$('mineEngine').textContent='WebGPU · SHA-256';$('hashLog').textContent='WebGPU active. Searching the locked ZB-1 26-bit proof…';
  const template=gpuTemplateWords(base),templateBuf=device.createBuffer({size:128,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});device.queue.writeBuffer(templateBuf,0,template);
  const paramsBuf=device.createBuffer({size:16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
  const resultBuf=device.createBuffer({size:8,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST});
  const readBuf=device.createBuffer({size:8,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  const bind=pipeline.getBindGroupLayout(0),group=device.createBindGroup({layout:bind,entries:[{binding:0,resource:{buffer:templateBuf}},{binding:1,resource:{buffer:paramsBuf}},{binding:2,resource:{buffer:resultBuf}}]});
  let start=0,batch=524288,lines=[];const expected=2**CFG.powBits,targetTop=2**(32-CFG.powBits);
  try{
    while(S.mining&&!S.gpuStop){
      if(start>0xffffffff-batch)throw new Error('GPU nonce range exhausted. Restart with CPU fallback.');
      device.queue.writeBuffer(paramsBuf,0,new Uint32Array([start,batch,targetTop,0]));device.queue.writeBuffer(resultBuf,0,new Uint32Array([0,0]));
      const encoder=device.createCommandEncoder(),pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(Math.ceil(batch/256));pass.end();encoder.copyBufferToBuffer(resultBuf,0,readBuf,0,8);
      const t0=performance.now();device.queue.submit([encoder.finish()]);await readBuf.mapAsync(GPUMapMode.READ);const data=new Uint32Array(readBuf.getMappedRange().slice(0));readBuf.unmap();const ms=Math.max(1,performance.now()-t0);
      S.hashes+=batch;const rate=batch/(ms/1000),avg=S.hashes/Math.max((performance.now()-S.startMs)/1000,.1);$('hashrate').textContent=formatRate(avg);$('mineProgress').style.width=Math.min(99,(S.hashes/expected)*100)+'%';
      lines.push('GPU '+start.toLocaleString()+'–'+(start+batch-1).toLocaleString()+' · '+formatRate(rate));if(lines.length>8)lines=lines.slice(-8);$('hashLog').textContent=lines.join('\n');
      if(data[0]===1){const nonce=data[1],hash=await verifyGpuCandidate(base,nonce);if(hash){S.proof={nonce:String(nonce),hash};stopMining(false);$('mineStatus').textContent='VALID PROOF FOUND';$('mineProgress').style.width='100%';$('hashLog').textContent+='\n\nGPU VERIFIED nonce '+nonce+'\n'+hash;$('submitClaimBtn').disabled=false;toast('GPU found and CPU/WebCrypto verified a valid 26-bit proof.');return}}
      start+=batch;
    }
  }finally{templateBuf.destroy();paramsBuf.destroy();resultBuf.destroy();readBuf.destroy()}
}
async function startCpuMining(base,reason=''){
  S.miningEngine='CPU';$('mineEngine').textContent='CPU Web Workers';let lines=[];$('hashLog').textContent=(reason?reason+'\n':'')+'Starting CPU workers…';
  const wc=Math.max(1,Math.min(8,navigator.hardwareConcurrency||4)),src=workerSource(),url=URL.createObjectURL(new Blob([src],{type:'text/javascript'}));
  for(let i=0;i<wc;i++){const w=new Worker(url);S.workers.push(w);w.onmessage=async ev=>{if(!S.mining)return;const d=ev.data;if(d.type==='rate'){S.hashes+=d.count;const secs=(performance.now()-S.startMs)/1000;$('hashrate').textContent=formatRate(S.hashes/Math.max(secs,.1));const expected=2**CFG.powBits,p=Math.min(99,(S.hashes/expected)*100);$('mineProgress').style.width=p+'%';lines.push('CPU nonce '+d.nonce+' · '+formatRate(d.count/(d.ms/1000)));if(lines.length>8)lines=lines.slice(-8);$('hashLog').textContent=lines.join('\n')}else if(d.type==='found'){S.proof={nonce:d.nonce,hash:d.hash};stopMining(false);$('mineStatus').textContent='VALID PROOF FOUND';$('mineProgress').style.width='100%';$('hashLog').textContent+='\n\nFOUND nonce '+d.nonce+'\n'+d.hash;$('submitClaimBtn').disabled=false;toast('Valid 26-bit proof found. Review and submit the claim.')}};w.postMessage({base,start:String(i),step:wc,bits:CFG.powBits,batch:20000})}
  URL.revokeObjectURL(url)
}
async function startMining(){
  try{
    if(S.mining)return;if(!S.ownerCommitment)throw new Error('Connect Noir Wallet first.');const wanted=Number($('tokenInput').value);if(!S.target||S.target.token!==wanted){const ok=await loadTarget();if(!ok||!S.target)return}
    const gate=await checkTargetAvailability(S.target,{refresh:true});if(!gate.available)throw new Error(`ZEC BLOCK #${wanted} already has a known claim. Choose another Token ID.`);
    S.mining=true;S.proof=null;S.hashes=0;S.startMs=performance.now();S.gpuStop=false;startClaimWatch();$('startMineBtn').disabled=true;$('stopMineBtn').disabled=false;$('submitClaimBtn').disabled=true;$('mineStatus').textContent='Mining…';$('hashrate').textContent='0 H/s';$('mineProgress').style.width='0%';
    const base=await mineBase();
    if(navigator.gpu){try{await startGpuMining(base);return}catch(e){console.warn('WebGPU miner fallback',e);if(!S.mining)return;await startCpuMining(base,'WebGPU unavailable/failed: '+(e.message||String(e))+'. Falling back to CPU.');return}}
    await startCpuMining(base,'WebGPU not supported in this browser. CPU fallback active.');
  }catch(e){S.mining=false;$('mineStatus').textContent='Mining error';toast(e.message||String(e),7000)}
}

function startClaimWatch(){
  if(S.claimWatchTimer)clearInterval(S.claimWatchTimer);
  S.claimWatchTimer=setInterval(async()=>{
    if(!S.mining||!S.target)return;
    try{
      await fetchRelay();
      const ev=knownClaimForToken(S.target.token);
      if(ev){
        const token=S.target.token;
        stopMining(false);
        setClaimStatus('COMPETING CLAIM DETECTED','bad');
        $('mineStatus').textContent='Target claimed / pending';
        $('hashLog').textContent+=`\n\nSTOPPED: A claim for ZEC BLOCK #${token} appeared while you were mining.\nChoose another Token ID.`;
        toast(`Mining stopped: claim detected for ZEC BLOCK #${token}.`,9000);
      }
    }catch(e){console.warn('claim watch',e)}
  },12000);
}

function stopMining(mark=true){S.mining=false;S.gpuStop=true;if(S.claimWatchTimer){clearInterval(S.claimWatchTimer);S.claimWatchTimer=null}for(const w of S.workers)w.terminate();S.workers=[];$('stopMineBtn').disabled=true;$('startMineBtn').disabled=!S.target;if(mark)$('mineStatus').textContent='Stopped'}
$('startMineBtn').onclick=startMining;$('stopMineBtn').onclick=()=>stopMining(true);
async function submitClaim(){
  try{
    if(!S.proof||!S.target)throw new Error('No valid proof is ready.');if(!S.ownerCommitment)throw new Error('Connect wallet first.');
    const finalCheck=await checkTargetAvailability(S.target,{refresh:true});if(!finalCheck.available)throw new Error(`ZEC BLOCK #${S.target.token} was claimed before submission. Choose another Token ID.`);
    if(S.claims.size>=CFG.freeClaims)throw new Error('The free-claim window appears full in the discovery feed. Paid-claim flow is intentionally not enabled in this build until the two-transaction fee path is finalized.');
    const msg=`ZB1:CLAIM:v1|G=${CFG.genesisTxid}|T=${S.target.token}|N=${S.proof.nonce}|K=${S.pubkey}`;
    const sig=await rpc('zcash_signMessage',[msg,{signingMode:'derived'}]);
    const memo=`ZB1|C|1|T=${S.target.token}|N=${S.proof.nonce}|K=${sig.pubkey}|S=${sig.signature}`;
    if(enc.encode(memo).length>512)throw new Error('Claim memo exceeds 512 bytes.');
    $('submitClaimBtn').disabled=true;$('mineStatus').textContent='Waiting for wallet approval…';
    const txid=await rpc('zcash_sendTransaction',[{to:CFG.mailbox,amount:'0.00000001',memo,fundingSource:'shielded'}]);
    const ev=normalizeEvent({protocol:'ZB1',v:1,type:'CLAIM',txid,memo,tokenId:S.target.token,nonce:S.proof.nonce,pubkey:sig.pubkey,ownerCommitment:S.ownerCommitment,sourceHeight:S.target.sourceHeight,sourceHash:S.target.sourceHash,proofHash:S.proof.hash,timestamp:Math.floor(Date.now()/1000),status:'pending'});
    saveLocalEvent(ev);await publishRelay(ev);S.proof=null;$('mineStatus').textContent='Claim broadcast · '+short(txid,8);toast('Claim broadcast: '+txid,8000);await refreshAll();
  }catch(e){$('submitClaimBtn').disabled=false;$('mineStatus').textContent='Claim not submitted';toast(e.message||String(e),8000)}
}
$('submitClaimBtn').onclick=submitClaim;
async function initNostr(){
  try{S.nostr=await import('https://esm.sh/nostr-tools@2.17.0?bundle');S.relay=new S.nostr.SimplePool();let sk=nostrSecretHex();if(sk){S.nostrSk=hexToBytes(sk)}else{S.nostrSk=S.nostr.generateSecretKey();setNostrSecretHex(bytesToHex(S.nostrSk))}S.nostrPk=S.nostr.getPublicKey(S.nostrSk);$('relayStatus').textContent='Relay: ready'}catch(e){console.warn(e);$('relayStatus').textContent='Relay: local-only'}
}
async function publishRelay(obj){
  saveLocalEvent(obj);if(!S.nostr||!S.relay||!S.nostrSk)return;
  try{const d=obj.txid||obj.eventId||crypto.randomUUID();const e=S.nostr.finalizeEvent({kind:CFG.nostrKind,created_at:Math.floor(Date.now()/1000),tags:[['t',CFG.relayTag],['d',d],['type',obj.type||'EVENT'],['token',String(obj.tokenId||0)]],content:JSON.stringify(obj)},S.nostrSk);await Promise.any(S.relay.publish(CFG.relays,e));}catch(e){console.warn('relay publish',e)}
}
async function fetchRelay(){
  let arr=localEvents(),ok=0,totalRemote=0;
  if(S.nostr&&S.relay){
    const rs=await Promise.allSettled(CFG.relays.map(async url=>{
      const evs=await Promise.race([
        S.relay.querySync([url],{kinds:[CFG.nostrKind],'#t':[CFG.relayTag],limit:7000}),
        new Promise((_,rej)=>setTimeout(()=>rej(new Error('relay timeout')),6500))
      ]);
      return evs||[];
    }));
    for(const r of rs){
      if(r.status==='fulfilled'){
        ok++; totalRemote+=r.value.length;
        for(const n of r.value){try{arr.push(normalizeEvent(JSON.parse(n.content)))}catch{}}
      }
    }
    $('relayStatus').textContent=`Relays: ${ok}/${CFG.relays.length} · ${totalRemote} events`;
  }
  const ded=new Map();for(const e of arr){const k=e.txid||e.eventId||JSON.stringify(e);const old=ded.get(k);if(!old||(e.timestamp||0)>(old.timestamp||0))ded.set(k,e)}
  S.events=[...ded.values()];rebuildState();updateAvailabilityCounts();
}
function rebuildState(){
  const claims=new Map(),trans=[];const sorted=[...S.events].sort((a,b)=>(a.timestamp||0)-(b.timestamp||0));
  for(const e of sorted){if(e.type==='CLAIM'&&Number.isInteger(Number(e.tokenId))&&!claims.has(Number(e.tokenId)))claims.set(Number(e.tokenId),e);else if(e.type==='TRANSFER')trans.push(e)}
  for(const e of trans){const id=Number(e.tokenId),c=claims.get(id);if(c)e._applied=true}
  S.claims=claims;S.transfers=trans;
  const listings=new Map(),offers=[];for(const e of sorted){if(e.type==='SALE'){const k=e.listingId||e.eventId;listings.set(k,e)}else if(e.type==='SALE_CANCEL'){listings.delete(e.listingId)}else if(e.type==='OFFER')offers.push(e)}S.listings=listings;S.offers=offers;
  $('claimCount').textContent=claims.size.toLocaleString();updateAvailabilityCounts();renderMarket();renderPortfolio();updateWalletUI();
}
function currentOwner(id){const c=S.claims.get(Number(id));if(!c)return null;let owner=c.ownerCommitment||null;for(const t of S.transfers.filter(x=>Number(x.tokenId)===Number(id)).sort((a,b)=>(a.timestamp||0)-(b.timestamp||0))){if(t.fromCommitment&&owner&&t.fromCommitment!==owner)continue;owner=t.toCommitment||owner}return owner}
function ownedTokens(){if(!S.ownerCommitment)return[];return [...S.claims.values()].filter(c=>currentOwner(c.tokenId)===S.ownerCommitment).sort((a,b)=>a.tokenId-b.tokenId)}
function activeListings(){const now=Math.floor(Date.now()/1000);return [...S.listings.values()].filter(x=>(x.expires||0)>now&&currentOwner(x.tokenId)===x.sellerCommitment)}
function renderMarket(){
  const q=$('marketSearch').value.trim().toLowerCase(),sort=$('marketSort').value;let a=activeListings().filter(x=>!q||String(x.tokenId).includes(q)||String(x.sellerCommitment).toLowerCase().includes(q));
  if(sort==='priceLow')a.sort((x,y)=>Number(x.price)-Number(y.price));else if(sort==='priceHigh')a.sort((x,y)=>Number(y.price)-Number(x.price));else a.sort((x,y)=>(y.timestamp||0)-(x.timestamp||0));
  const g=$('marketGrid');g.innerHTML='';if(!a.length){g.innerHTML='<div class="empty" style="grid-column:1/-1">No active listings found yet. Connect a wallet and list an owned ZEC BLOCK to open the order board.</div>';return}
  for(const l of a){const c=S.claims.get(Number(l.tokenId));const artHash=c?.sourceHash||CFG.genesisTxid;const card=document.createElement('article');card.className='nft';card.innerHTML=`<div class="nftart"><svg class="blockArt" viewBox="0 0 600 600"></svg></div><div class="nftinfo"><div class="nftline"><span class="nfttitle">ZEC BLOCK #${esc(l.tokenId)}</span><span class="price">${esc(l.price)} ZEC</span></div><div class="meta"><span>Seller ${esc(short(l.sellerCommitment,6))}</span><span>${new Date((l.expires||0)*1000).toLocaleDateString()}</span></div><div class="controls"><button class="btn offerBtn" style="min-height:32px">Make Offer</button></div></div>`;artSvg(card.querySelector('svg'),artHash+':'+(c?.sourceHeight||l.tokenId),'ZB #'+l.tokenId);card.querySelector('.offerBtn').onclick=()=>openOffer(l);g.appendChild(card)}
}
$('marketSearch').oninput=renderMarket;$('marketSort').onchange=renderMarket;$('refreshMarketBtn').onclick=()=>fetchRelay().catch(e=>toast(e.message));
function modal(id,on=true){$(id).classList.toggle('show',on)}document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>modal(b.dataset.close,false));
function openListing(){const own=ownedTokens();if(!own.length)return toast('No owned ZEC BLOCKS found in the current discovery state.');const s=$('listingToken');s.innerHTML=own.map(x=>`<option value="${x.tokenId}">ZEC BLOCK #${x.tokenId}</option>`).join('');modal('listingModal',true)}
$('createListingBtn').onclick=openListing;
async function signDerived(msg){const r=await rpc('zcash_signMessage',[msg,{signingMode:'derived'}]);return r}
$('publishListingBtn').onclick=async()=>{try{const tokenId=Number($('listingToken').value),price=$('listingPrice').value.trim(),days=Number($('listingDays').value);if(!ownedTokens().some(x=>x.tokenId===tokenId))throw new Error('Token is not owned by this commitment.');if(!decimalValid(price))throw new Error('Enter a valid ZEC price.');if(!Number.isInteger(days)||days<1||days>30)throw new Error('Expiry must be 1–30 days.');const nonce=crypto.randomUUID(),expires=Math.floor(Date.now()/1000)+days*86400,msg=`ZB1:SALE:v1|G=${CFG.genesisTxid}|T=${tokenId}|P=${price}|E=${expires}|X=${nonce}|O=${S.ownerCommitment}`;const sig=await signDerived(msg);const e=normalizeEvent({protocol:'ZB1',v:1,type:'SALE',eventId:'sale:'+nonce,listingId:'sale:'+nonce,tokenId,price,expires,nonce,sellerCommitment:S.ownerCommitment,pubkey:sig.pubkey,signature:sig.signature,timestamp:Math.floor(Date.now()/1000)});await publishRelay(e);modal('listingModal',false);toast('Listing published to the P2P discovery relays.');await fetchRelay()}catch(e){toast(e.message||String(e),7000)}};
function openOffer(l){if(!S.ownerCommitment)return toast('Connect Noir Wallet first.');S.currentOfferListing=l;$('offerToken').value='ZEC BLOCK #'+l.tokenId;$('offerPrice').value=l.price;modal('offerModal',true)}
$('publishOfferBtn').onclick=async()=>{try{const l=S.currentOfferListing;if(!l)throw new Error('No listing selected.');const price=$('offerPrice').value.trim();if(!decimalValid(price))throw new Error('Enter a valid ZEC offer.');const nonce=crypto.randomUUID(),msg=`ZB1:OFFER:v1|L=${l.listingId}|T=${l.tokenId}|P=${price}|B=${S.ownerCommitment}|X=${nonce}`;const sig=await signDerived(msg);const e=normalizeEvent({protocol:'ZB1',v:1,type:'OFFER',eventId:'offer:'+nonce,listingId:l.listingId,tokenId:l.tokenId,price,buyerCommitment:S.ownerCommitment,sellerCommitment:l.sellerCommitment,pubkey:sig.pubkey,signature:sig.signature,timestamp:Math.floor(Date.now()/1000)});await publishRelay(e);modal('offerModal',false);toast('Offer published. No funds moved.');await fetchRelay()}catch(e){toast(e.message||String(e),7000)}};
function renderPortfolio(){
  const own=ownedTokens();$('ownedCount').textContent=own.length;$('listingCount').textContent=S.ownerCommitment?activeListings().filter(x=>x.sellerCommitment===S.ownerCommitment).length:0;$('offerCount').textContent=S.ownerCommitment?S.offers.filter(x=>x.sellerCommitment===S.ownerCommitment).length:0;
  const g=$('portfolioGrid');g.innerHTML='';if(!S.ownerCommitment){g.innerHTML='<div class="empty" style="grid-column:1/-1">Connect Noir Wallet to calculate your ZB-1 owner commitment and load your portfolio.</div>';return}if(!own.length){g.innerHTML='<div class="empty" style="grid-column:1/-1">No ZEC BLOCKS are currently mapped to this owner commitment in the discovery feed.</div>';return}
  for(const c of own){const card=document.createElement('article');card.className='nft';card.innerHTML=`<div class="nftart"><svg class="blockArt" viewBox="0 0 600 600"></svg></div><div class="nftinfo"><div class="nftline"><span class="nfttitle">ZEC BLOCK #${c.tokenId}</span><span class="badge live">OWNED</span></div><div class="meta"><span>Source ${esc(c.sourceHeight||'—')}</span><span>${esc(short(c.txid||'',6))}</span></div><div class="controls"><button class="btn listOne">List</button><button class="btn transferOne">Transfer</button></div></div>`;artSvg(card.querySelector('svg'),(c.sourceHash||CFG.genesisTxid)+':'+(c.sourceHeight||c.tokenId),'ZB #'+c.tokenId);card.querySelector('.listOne').onclick=()=>{openListing();$('listingToken').value=String(c.tokenId)};card.querySelector('.transferOne').onclick=()=>{S.transferToken=c.tokenId;$('transferToken').value='ZEC BLOCK #'+c.tokenId;modal('transferModal',true)};g.appendChild(card)}
}
$('syncPortfolioBtn').onclick=async()=>{try{S.balance=await rpc('zcash_getBalance');await loadWalletHistory();await fetchRelay();updateWalletUI();toast('Portfolio synced.')}catch(e){toast(e.message||String(e),7000)}};
$('submitTransferBtn').onclick=async()=>{try{const tokenId=Number(S.transferToken),to=$('recipientCommit').value.trim().toLowerCase();if(!/^[0-9a-f]{64}$/.test(to))throw new Error('Recipient commitment must be exactly 64 hex characters.');if(currentOwner(tokenId)!==S.ownerCommitment)throw new Error('This wallet is not the current owner in the discovery state.');const msg=`ZB1:TRANSFER:v1|G=${CFG.genesisTxid}|T=${tokenId}|F=${S.ownerCommitment}|O=${to}`;const sig=await signDerived(msg);const memo=`ZB1|T|1|I=${tokenId}|O=${to}|K=${sig.pubkey}|S=${sig.signature}`;if(enc.encode(memo).length>512)throw new Error('Transfer memo exceeds 512 bytes.');const txid=await rpc('zcash_sendTransaction',[{to:CFG.mailbox,amount:'0.00000001',memo,fundingSource:'shielded'}]);const e=normalizeEvent({protocol:'ZB1',v:1,type:'TRANSFER',txid,memo,tokenId,fromCommitment:S.ownerCommitment,toCommitment:to,pubkey:sig.pubkey,signature:sig.signature,timestamp:Math.floor(Date.now()/1000),status:'pending'});await publishRelay(e);modal('transferModal',false);$('recipientCommit').value='';toast('Transfer broadcast: '+txid,8000);await fetchRelay()}catch(e){toast(e.message||String(e),8000)}};
async function refreshAll(){await fetchRelay();renderMarket();renderPortfolio()}
function artSvg(svg,seed,label){const gold=['#d3a84f','#e9c56e','#b98a37','#f0d690'],bg=['#080808','#0c0c0c','#11100e','#0a0a0a'],dark=['#111','#141311','#181613','#1d1a15'];const hex=((seed||'')+seed).toLowerCase().replace(/[^0-9a-f]/g,'')||'0',bits=[...hex].map(ch=>parseInt(ch,16).toString(2).padStart(4,'0')).join(''),grid=24,cell=20,pad=60,bgc=bg[parseInt(hex[0]||'0',16)%bg.length],g1=gold[parseInt(hex[1]||'0',16)%4],g2=gold[parseInt(hex[2]||'0',16)%4],g3=gold[parseInt(hex[3]||'0',16)%4],d1=dark[parseInt(hex[4]||'0',16)%4];const r=(x,y,w=1,h=1,f=d1,o=1)=>`<rect x="${pad+x*cell}" y="${pad+y*cell}" width="${w*cell}" height="${h*cell}" fill="${f}" opacity="${o}"/>`;let a=`<rect width="600" height="600" fill="${bgc}"/>`;for(let y=0;y<grid;y++)for(let x=0;x<grid;x++){const i=(x+y*grid)%bits.length;if(((x+y)%2===0&&bits[i]==='1')||((x+y)%5===0&&bits[(i+17)%bits.length]==='1'))a+=r(x,y,1,1,dark[(x+y)%4],.35)}for(let y=0;y<grid;y++)for(let x=0;x<grid;x++){const ed=x===0||y===0||x===grid-1||y===grid-1,inn=x===2||y===2||x===grid-3||y===grid-3;if(ed)a+=r(x,y,1,1,(x+y)%3===0?g2:g1,.96);else if(inn&&((x+y)%2===0||bits[(x*7+y*11)%bits.length]==='1'))a+=r(x,y,1,1,g3,.88)}for(let y=0;y<16;y++)for(let x=0;x<8;x++){const i=(y*8+x)%bits.length,b1=bits[i]==='1',b2=bits[(i+29)%bits.length]==='1',b3=bits[(i+61)%bits.length]==='1',ring=Math.max(Math.abs(x-3.5),Math.abs(y-7.5));let on=ring<=1.5?(b1||b2):ring<=3.5?((b1&&b2)||(b1&&((x+y)%2===0))):ring<=6.5?(b1&&b2&&(b3||((x+y)%3===0))):false;if(on){const f=(x+y)%5===0?g3:(b2&&b3?g2:g1);a+=r(4+x,4+y,1,1,f,.98)+r(grid-5-x,4+y,1,1,f,.98)}}const arm=3+(parseInt(hex[5]||'0',16)%4);a+=r(11,11-arm,2,arm*2+2,g2,.96)+r(11-arm,11,arm*2+2,2,g2,.96)+r(10,10,4,4,g1,1);svg.innerHTML=a+`<text x="36" y="46" fill="#6d665a" font-size="14" font-family="monospace">ZEC BLOCKS / ${esc(label)}</text><text x="36" y="568" fill="#45413b" font-size="11" font-family="monospace">${esc(String(seed).slice(0,34).toUpperCase())}</text>`}
artSvg($('heroArt'),CFG.genesisTxid,'ZB #1');
(async()=>{$('mineEngine').textContent=navigator.gpu?'WebGPU ready · GPU preferred':'CPU fallback';await initNostr();try{await resolveGenesis()}catch(e){console.warn(e)}try{await connectWallet(true)}catch{}await fetchRelay();updateWalletUI()})();