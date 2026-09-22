import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { secp256k1 } from "npm:@noble/curves@1.9.7/secp256k1";
import { ripemd160 } from "npm:@noble/hashes@1.8.0/ripemd160";

const SUPABASE_URL=Deno.env.get("SUPABASE_URL")!;
const SERVICE=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase=createClient(SUPABASE_URL,SERVICE,{auth:{persistSession:false}});
const GENESIS="ecf6fc3a79885f573d79de70a2de85c34667fc1a4fefe034d3a4015269379f0f";
const GENESIS_HEIGHT=3488573,SUPPLY=5000,POW_BITS=26;
const TREASURY="t1b9PCdoCncgoc13CWwWz8tzZZLDYfMaTyz",FEE_ZAT=130000n;
const BASES=["https://api.mainnet.cipherscan.app/api"];
const CORS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"content-type, apikey, authorization","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json","Cache-Control":"no-store"};
const enc=new TextEncoder();
const txCache=new Map<string,any>(),blockCache=new Map<string,any>();

class DeferredError extends Error{}
const clean=(v:any)=>String(v??"").trim().replace(/^0x/,"").toLowerCase();
function hb(s:any){const x=clean(s);if(x.length%2||!/^[0-9a-f]*$/.test(x))throw new Error("bad hex");const b=new Uint8Array(x.length/2);for(let i=0;i<b.length;i++)b[i]=parseInt(x.slice(i*2,i*2+2),16);return b}
function hx(b:Uint8Array){return [...b].map(x=>x.toString(16).padStart(2,"0")).join("")}
function cat(...a:Uint8Array[]){let n=0;for(const x of a)n+=x.length;const o=new Uint8Array(n);let p=0;for(const x of a){o.set(x,p);p+=x.length}return o}
function u32(n:number){const b=new Uint8Array(4);new DataView(b.buffer).setUint32(0,n,true);return b}
function u64(n:bigint){const b=new Uint8Array(8);for(let i=0;i<8;i++){b[i]=Number(n&255n);n>>=8n}return b}
async function sha(b:Uint8Array){return new Uint8Array(await crypto.subtle.digest("SHA-256",b))}
async function dbl(b:Uint8Array){return sha(await sha(b))}
async function shahex(b:Uint8Array){return hx(await sha(b))}
function zbits(b:Uint8Array){let n=0;for(const x of b){if(x===0){n+=8;continue}for(let m=128;(x&m)===0;m>>=1)n++;break}return n}
function cs(n:number){if(n<=0xfc)return new Uint8Array([n]);if(n<=0xffff)return new Uint8Array([0xfd,n&255,(n>>8)&255]);const b=new Uint8Array(5);b[0]=0xfe;new DataView(b.buffer).setUint32(1,n,true);return b}
async function zmsgHash(message:string){const p="Zcash Signed Message:\n",pb=enc.encode(p),mb=enc.encode(message);return dbl(cat(cs(pb.length),pb,cs(mb.length),mb))}
function compactParts(sig:any){const b=hb(sig);if(b.length!==65)throw new Error("bad compact signature");const h=b[0];if(h<27||h>34)throw new Error("bad compact signature header");return {sig:b.slice(1),rec:(h>=31?h-31:h-27)}}
async function recoverPub(message:string,sig:any){
  const x=compactParts(sig),hash=await zmsgHash(message);
  const s=secp256k1.Signature.fromCompact(x.sig).addRecoveryBit(x.rec);
  return s.recoverPublicKey(hash).toRawBytes(false)
}
async function verifyPub(message:string,sig:any,pub:any){
  try{
    const got=secp256k1.ProjectivePoint.fromHex(await recoverPub(message,sig));
    const want=secp256k1.ProjectivePoint.fromHex(hb(pub));
    return got.equals(want)
  }catch{return false}
}
function b58(bytes:Uint8Array){const A="123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";let x=0n;for(const v of bytes)x=(x<<8n)|BigInt(v);let s="";while(x>0n){const r=Number(x%58n);s=A[r]+s;x/=58n}for(let i=0;i<bytes.length&&bytes[i]===0;i++)s="1"+s;return s||"1"}
async function pubToTaddr(pub:Uint8Array){const P=secp256k1.ProjectivePoint.fromHex(pub),c=P.toRawBytes(true),h160=ripemd160(await sha(c)),payload=cat(new Uint8Array([0x1c,0xb8]),h160),chk=(await dbl(payload)).slice(0,4);return b58(cat(payload,chk))}
function collectAddresses(o:any,out=new Set<string>(),depth=0){if(o==null||depth>8)return out;if(typeof o==="string"){if(/^t[13][1-9A-HJ-NP-Za-km-z]{20,}$/.test(o))out.add(o);return out}if(Array.isArray(o)){for(const v of o)collectAddresses(v,out,depth+1);return out}if(typeof o!=="object")return out;for(const [k,v] of Object.entries(o)){const key=k.toLowerCase();if((key.includes("address")||key==="addr")&&typeof v==="string"&&/^t[13][1-9A-HJ-NP-Za-km-z]{20,}$/.test(v))out.add(v);if(v&&typeof v==="object")collectAddresses(v,out,depth+1)}return out}
function valueZat(o:any){const v=o?.valueZat??o?.value_zat??o?.satoshis??o?.value??o?.amount;if(v==null)return null;if(typeof v==="string"&&/^\d+$/.test(v))return BigInt(v);if(typeof v==="number"&&Number.isInteger(v))return BigInt(v);if(typeof v==="number"&&Number.isFinite(v))return BigInt(Math.round(v*1e8));if(typeof v==="string"&&/^\d+\.\d+$/.test(v)){const [w,f=""]=v.split(".");return BigInt(w)*100000000n+BigInt((f+"00000000").slice(0,8))}return null}
async function chain(kind:"tx"|"block",id:string|number){
  const key=kind+":"+id,cache=kind==="tx"?txCache:blockCache,cached=cache.get(key);
  if(cached&&cached.expires>Date.now())return cached.data;
  cache.delete(key);
  let last:any=null;
  for(const base of BASES){
    const ac=new AbortController(),timer=setTimeout(()=>ac.abort(),6500);
    try{
      const r=await fetch(base+"/"+kind+"/"+encodeURIComponent(String(id)),{headers:{accept:"application/json","user-agent":"ZEC-BLOCKS-AUDIT/1.0"},signal:ac.signal});
      if(!r.ok){last=new Error(r.status===404?kind+" "+id+" not yet visible to the chain provider":"chain HTTP "+r.status);continue}
      const j=await r.json();
      // Never keep a pending transaction forever in a warm worker.
      if(kind!=="tx"||confirmed(j)){
        if(cache.size>=512)cache.delete(cache.keys().next().value!);
        cache.set(key,{data:j,expires:Date.now()+10000});
      }
      return j
    }catch(e){last=e}finally{clearTimeout(timer)}
  }
  throw new DeferredError("chain provider unavailable: "+String(last?.message||last||"unknown"))
}
function blockHeight(tx:any){return Number(tx?.blockHeight??tx?.block_height??tx?.blockheight??tx?.height)}
function confirmed(tx:any){const h=blockHeight(tx);return Number.isInteger(h)&&h>0&&String(tx?.status||"confirmed").toLowerCase()!=="pending"&&tx?.isCanonical!==false}
async function txIndexFor(txid:string,height:number){
  const b=await chain("block",height),a=b?.transactions??b?.tx??b?.data?.transactions;
  if(!Array.isArray(a))return null;
  const i=a.findIndex((x:any)=>clean(typeof x==="string"?x:(x?.txid||x?.hash||""))===clean(txid));
  return i>=0?i:null
}
async function sourceHashFor(token:number){const h=GENESIS_HEIGHT-token,b=await chain("block",h),x=clean(b?.hash||b?.block_hash||b?.blockHash);if(!/^[0-9a-f]{64}$/.test(x))throw new DeferredError("source block unavailable");return {height:h,hash:x}}
function claimV3Message(o:any){return `ZB1:CLAIM:v3|G=${GENESIS}|T=${Number(o.tokenId)}|N=${String(o.nonce)}|O=${clean(o.ownerCommitment)}|F=${clean(o.feeTxid)}|R=${String(o.feeSig)}|Z=${FEE_ZAT}`}
function legacyClaimV3Message(o:any){return `ZB1:CLAIM:v3|G=${GENESIS}|T=${Number(o.tokenId)}|N=${String(o.nonce)}|R=${clean(o.reservationTxid)}|F=${clean(o.feeTxid)}|Z=${FEE_ZAT}|O=${clean(o.ownerCommitment)}`}
function legacyReserveV3Message(o:any){return `ZB1:CLAIM_RESERVE:v3|G=${GENESIS}|T=${Number(o.tokenId)}|N=${String(o.nonce)}|H=${clean(o.sourceHash)}|O=${clean(o.ownerCommitment)}|E=${Number(o.expires)}`}
function feeMessage(owner:string,feeTxid:string){return `ZB1:FEE:v1|G=${GENESIS}|O=${owner}|F=${feeTxid}|Z=${FEE_ZAT}`}
async function verifyFee(owner:string,feeTxid:string,feeSig:string){
  const tx=await chain("tx",feeTxid);if(!confirmed(tx))throw new DeferredError("fee transaction not confirmed");
  const outs=Array.isArray(tx?.outputs)?tx.outputs:[],ins=Array.isArray(tx?.inputs)?tx.inputs:[];
  let paid=0n;for(const o of outs){const a=String(o?.address||o?.addr||o?.scriptPubKey?.address||o?.scriptPubKey?.addresses?.[0]||"");if(a===TREASURY){const z=valueZat(o);if(z!=null)paid+=z}}
  if(paid!==FEE_ZAT)throw new Error("fee amount/treasury mismatch");
  const pub=await recoverPub(feeMessage(owner,feeTxid),feeSig),addr=await pubToTaddr(pub),addrs=collectAddresses(ins);
  if(!addrs.has(addr))throw new Error("fee payer binding mismatch");
  return {height:blockHeight(tx),payer:addr,tx}
}
async function verifyLegacyFee(feeTxid:string){
  const tx=await chain("tx",feeTxid);if(!confirmed(tx))throw new DeferredError("legacy fee transaction not confirmed");
  const outs=Array.isArray(tx?.outputs)?tx.outputs:[];
  let paid=0n;for(const o of outs){const a=String(o?.address||o?.addr||o?.scriptPubKey?.address||o?.scriptPubKey?.addresses?.[0]||"");if(a===TREASURY){const z=valueZat(o);if(z!=null)paid+=z}}
  if(paid!==FEE_ZAT)throw new Error("legacy fee amount/treasury mismatch");
  return {height:blockHeight(tx),tx}
}
async function assertTxOrder(aTxid:string,aTx:any,bTxid:string,bTx:any,label:string){
  const ah=blockHeight(aTx),bh=blockHeight(bTx);
  if(ah>bh)throw new Error(label+" order invalid");
  if(ah===bh){
    const [ai,bi]=await Promise.all([txIndexFor(aTxid,ah),txIndexFor(bTxid,bh)]);
    if(ai==null||bi==null)throw new DeferredError(label+" same-block ordering unavailable");
    if(ai>=bi)throw new Error(label+" order invalid")
  }
}
async function legacyReservation(token:number,reservationTxid:string,owner:string,nonce:string,sourceHash:string){
  const {data,error}=await supabase.from("zecblocks_events")
    .select("event_key,txid,payload,event_timestamp")
    .eq("event_type","CLAIM_INTENT").eq("token_id",token).eq("txid",reservationTxid);
  if(error)throw error;
  const rows=(data||[]).filter((x:any)=>x?.payload);
  if(!rows.length)throw new DeferredError("legacy reservation discovery event unavailable");
  let r:any=rows.sort((a:any,b:any)=>Number(b.payload?.confirmations||0)-Number(a.payload?.confirmations||0))[0];
  const o=r.payload||{},pub=clean(o.pubkey),sig=String(o.signature||""),expires=Number(o.expires||0);
  if(!(/^[0-9a-f]{66}$/.test(pub)||/^[0-9a-f]{130}$/.test(pub))||!/^[0-9a-f]{130}$/i.test(clean(sig)))throw new Error("bad legacy reservation signature fields");
  const derived=await shahex(hb(pub));if(derived!==owner)throw new Error("legacy reservation owner mismatch");
  if(String(o.nonce??"")!==nonce||clean(o.sourceHash)!==sourceHash||clean(o.ownerCommitment)!==owner||clean(o.reservationTxid||o.txid)!==reservationTxid)throw new Error("legacy reservation fields mismatch");
  const msg=legacyReserveV3Message({tokenId:token,nonce,sourceHash,ownerCommitment:owner,expires});
  if(!(await verifyPub(msg,sig,pub)))throw new Error("legacy reservation signature mismatch");
  const tx=await chain("tx",reservationTxid);if(!confirmed(tx))throw new DeferredError("legacy reservation transaction not confirmed");
  return {tx,expires,pub}
}
async function ensureLegacyFeeUnique(feeTxid:string,claimTxid:string){
  const {data,error}=await supabase.from("zecblocks_events")
    .select("txid,token_id,payload")
    .eq("event_type","CLAIM").eq("verification_status","verified").eq("protocol_audited",true)
    .contains("payload",{feeTxid}).limit(10);
  if(error)throw error;
  const other=(data||[]).find((x:any)=>clean(x.txid)!==claimTxid);
  if(other)throw new Error("legacy fee TXID already consumed by another canonical claim")
}
async function proofCheck(o:any,owner:string){
  const token=Number(o.tokenId),nonce=String(o.nonce??"");if(!Number.isInteger(token)||token<1||token>SUPPLY||!/^\d+$/.test(nonce))throw new Error("bad claim fields");
  const src=await sourceHashFor(token);
  if(Number(o.sourceHeight)!==src.height||clean(o.sourceHash)!==src.hash)throw new Error("source block mismatch");
  const p=await sha(cat(enc.encode("ZB1:MINE:v1"),hb(GENESIS),u32(token),hb(src.hash),hb(owner),u64(BigInt(nonce))));
  if(zbits(p)<POW_BITS)throw new Error("bad pow");
  if(o.proofHash&&clean(o.proofHash)!==hx(p))throw new Error("proof hash mismatch");
  return {src,proofHash:hx(p)}
}
function parseMemoFields(m:any){
  const s=String(m||"").trim();
  if(!s.startsWith("ZB1|C|"))return {};
  const p=s.split("|"),out:any={};
  out.v=Number(p[2]||1);
  for(const x of p.slice(3)){
    const i=x.indexOf("=");if(i>0)out[x.slice(0,i)]=x.slice(i+1)
  }
  const r=String(out.R||"");
  return {
    v:out.v,tokenId:Number(out.T),nonce:out.N,pubkey:out.K,
    ownerCommitment:out.O,signature:out.S,feeTxid:out.F,
    feeSig:/^[0-9a-f]{130}$/i.test(r)?r:undefined,
    reservationTxid:/^[0-9a-f]{64}$/i.test(r)?r:undefined,
    feeZat:out.Z?Number(out.Z):undefined
  }
}
async function validate(row:any){
  const raw=row.payload||{},pm=parseMemoFields(raw.memo);
  const o={...pm,...raw,
    signature:raw.signature||pm.signature,
    pubkey:raw.pubkey||pm.pubkey,
    ownerCommitment:raw.ownerCommitment||pm.ownerCommitment,
    feeTxid:raw.feeTxid||pm.feeTxid,
    feeSig:raw.feeSig||pm.feeSig,
    nonce:raw.nonce??pm.nonce,
    tokenId:raw.tokenId??pm.tokenId,
    v:Number(raw.v||pm.v||1)
  };
  const v=Number(o.v||1),token=Number(o.tokenId??row.token_id),txid=clean(o.txid||row.txid);
  if(!Number.isInteger(token)||token<1||token>SUPPLY||!/^[0-9a-f]{64}$/.test(txid))throw new Error("bad claim");
  let owner="",feeTxid:string|null=null;
  if(v>=3){
    feeTxid=clean(o.feeTxid);
    const sig=String(o.signature||""),pubkey=clean(o.pubkey),reservationTxid=clean(o.reservationTxid);
    const legacyReservationFormat=/^[0-9a-f]{64}$/.test(reservationTxid)&&(/^[0-9a-f]{66}$/.test(pubkey)||/^[0-9a-f]{130}$/.test(pubkey))&&!o.feeSig;
    if(legacyReservationFormat){
      if(!/^[0-9a-f]{64}$/.test(feeTxid)||!/^[0-9a-f]{130}$/i.test(clean(sig)))throw new Error("bad legacy v3 fields");
      owner=await shahex(hb(pubkey));
      if(o.ownerCommitment&&clean(o.ownerCommitment)!==owner)throw new Error("legacy owner commitment mismatch");
      const nonce=String(o.nonce??""),src=await sourceHashFor(token);
      const msg=legacyClaimV3Message({tokenId:token,nonce,reservationTxid,feeTxid,ownerCommitment:owner});
      if(!(await verifyPub(msg,sig,pubkey)))throw new Error("legacy final claim signature mismatch");
      await proofCheck({...o,tokenId:token,sourceHeight:src.height,sourceHash:src.hash},owner);
      const reservation=await legacyReservation(token,reservationTxid,owner,nonce,src.hash);
      const fee=await verifyLegacyFee(feeTxid);
      await ensureLegacyFeeUnique(feeTxid,txid);
      const claimTx=await chain("tx",txid);if(!confirmed(claimTx))throw new DeferredError("claim transaction not confirmed");
      await assertTxOrder(reservationTxid,reservation.tx,feeTxid,fee.tx,"reservation→fee");
      await assertTxOrder(feeTxid,fee.tx,txid,claimTx,"fee→claim");
      const memo=`ZB1|C|3|T=${token}|N=${nonce}|R=${reservationTxid}|F=${feeTxid}|Z=${FEE_ZAT}|K=${pubkey}|S=${sig}`;
      if(o.memo&&String(o.memo)!==memo)throw new Error("legacy memo fields mismatch");
      const ch=blockHeight(claimTx);
      return {valid:true,token,txid,owner,version:v,blockHeight:ch,txIndex:await txIndexFor(txid,ch),feeTxid,legacyReservation:true}
    }

    owner=clean(o.ownerCommitment);
    const feeSig=String(o.feeSig||"");
    if(!/^[0-9a-f]{64}$/.test(owner)||!/^[0-9a-f]{64}$/.test(feeTxid)||!/^[0-9a-f]{130}$/i.test(clean(feeSig))||!/^[0-9a-f]{130}$/i.test(clean(sig)))throw new Error("bad v3 fields");
    const msg=claimV3Message({...o,tokenId:token,ownerCommitment:owner,feeTxid,feeSig}),pub=await recoverPub(msg,sig),derived=await shahex(pub);
    if(derived!==owner)throw new Error("owner signature mismatch");
    await proofCheck({...o,tokenId:token},owner);
    const fee=await verifyFee(owner,feeTxid,feeSig);
    const claimTx=await chain("tx",txid);if(!confirmed(claimTx))throw new DeferredError("claim transaction not confirmed");
    const ch=blockHeight(claimTx);if(fee.height>ch)throw new Error("fee after claim");
    if(fee.height===ch){const [fi,ci]=await Promise.all([txIndexFor(feeTxid,ch),txIndexFor(txid,ch)]);if(fi==null||ci==null)throw new DeferredError("same-block ordering unavailable");if(fi>=ci)throw new Error("fee not before claim")}
    const memo=`ZB1|C|3|T=${token}|N=${String(o.nonce)}|O=${owner}|S=${String(o.signature)}|F=${feeTxid}|R=${feeSig}|Z=${FEE_ZAT}`;
    if(o.memo&&String(o.memo)!==memo)throw new Error("memo fields mismatch");
    return {valid:true,token,txid,owner,version:v,blockHeight:ch,txIndex:await txIndexFor(txid,ch),feeTxid}
  }
  const pub=clean(o.pubkey),sig=String(o.signature||""),nonce=String(o.nonce??"");if(!pub||!/^[0-9a-f]{130}$/i.test(clean(sig)))throw new Error("bad legacy fields");
  owner=await shahex(hb(pub));
  const msg=`ZB1:CLAIM:v1|G=${GENESIS}|T=${token}|N=${nonce}|K=${pub}`;
  if(!(await verifyPub(msg,sig,pub)))throw new Error("bad signature");
  await proofCheck({...o,tokenId:token,ownerCommitment:owner},owner);
  const claimTx=await chain("tx",txid);if(!confirmed(claimTx))throw new DeferredError("claim transaction not confirmed");
  const ch=blockHeight(claimTx);
  return {valid:true,token,txid,owner,version:v,blockHeight:ch,txIndex:await txIndexFor(txid,ch),feeTxid:null}
}
async function markToken(token:number){
  const {data:stateRows,error}=await supabase.rpc("zecblocks_claim_state_rows",{p_token_ids:[token]});
  if(error)throw error;
  const rows=(stateRows||[]).filter((x:any)=>x.event_type==="CLAIM");
  const valid=(rows||[]).filter((x:any)=>x.protocol_audited===true&&x.chain_confirmed===true&&x.verification_status==="verified")
    .sort((a:any,b:any)=>Number(a.payload?.blockHeight||a.event_timestamp||0)-Number(b.payload?.blockHeight||b.event_timestamp||0));
  if(valid.length){
    const x:any=valid[0],o=x.payload||{},owner=clean(o.ownerCommitment)||clean(o._auditedOwner);
    await supabase.from("zecblocks_claim_availability").update({status:"claimed",claim_event_key:x.event_key,claim_txid:x.txid,last_checked_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("token_id",token);
    return
  }
  const pending=(rows||[]).some((x:any)=>{
    if(x.protocol_audited===true)return false;
    const v=Number(x.payload?.v||1);
    return v>=3||["pending","deferred","verified"].includes(String(x.verification_status))
  });
  const {data:a}=await supabase.from("zecblocks_claim_availability").select("relay_quorum").eq("token_id",token).maybeSingle();
  const status=pending?"claimed_pending":Number(a?.relay_quorum||0)>=3?"clear":"unknown";
  await supabase.from("zecblocks_claim_availability").update({status,claim_event_key:null,claim_txid:null,updated_at:new Date().toISOString()}).eq("token_id",token)
}
async function auditRow(row:any){
  const token=Number(row.token_id),txid=clean(row.txid||row.payload?.txid),now=new Date().toISOString();

  // Never retroactively invalidate a claim that production already finalized.
  // Historical ownership remains grandfathered even if an older backend bug allowed
  // one fee credit to be reused more than once.
  if(row.verification_status==="verified"&&row.verified_level==="full"&&row.protocol_audited===true&&row.chain_confirmed===true){
    return {ok:true,token,txid,existing:true}
  }

  // A relay can add a duplicate row after this transaction was finalized.
  // Token-scoped recovery must respect the same rule as the batch audit queue.
  const {data:finalized,error:finalizedError}=await supabase.from("zecblocks_events")
    .select("event_key").eq("event_type","CLAIM").eq("token_id",token).eq("txid",txid)
    .eq("verification_status","verified").eq("verified_level","full")
    .eq("protocol_audited",true).eq("chain_confirmed",true).limit(1);
  if(finalizedError)throw finalizedError;
  if(finalized?.length){await markToken(token);return {ok:true,token,txid,existing:true}}

  try{
    const v=await validate(row);

    if(v.feeTxid){
      const {error:feeUseErr}=await supabase.rpc("zecblocks_claim_fee_consume",{
        p_fee_txid:v.feeTxid,
        p_claim_txid:txid,
        p_token_id:token,
        p_owner_commitment:v.owner,
        p_claim_block_height:v.blockHeight,
        p_claim_tx_index:v.txIndex
      });
      if(feeUseErr)throw new Error(String(feeUseErr.message||feeUseErr))
    }

    const patched={...(row.payload||{}),ownerCommitment:v.owner,_auditedOwner:v.owner,blockHeight:v.blockHeight,txIndex:v.txIndex};
    const {error}=await supabase.from("zecblocks_events").update({
      verification_status:"verified",verified_level:"full",valid_signature:true,
      protocol_audited:true,chain_confirmed:true,audited_at:now,audit_error:null,verification_error:null,
      block_height:v.blockHeight,tx_index:v.txIndex,payload:patched,updated_at:now
    }).eq("event_type","CLAIM").eq("token_id",token).eq("txid",txid);
    if(error)throw error;
    const {data:rep}=await supabase.from("zecblocks_events").select("event_key,event_timestamp,relay_event_id").eq("event_type","CLAIM").eq("token_id",token).eq("txid",txid).limit(1).maybeSingle();
    const eventKey=rep?.event_key||row.event_key;
    const {error:seenErr}=await supabase.from("zecblocks_claims_seen").upsert({token_id:token,event_key:eventKey,txid,owner_commitment:v.owner,event_timestamp:Number(rep?.event_timestamp||row.event_timestamp||0),relay_event_id:String(rep?.relay_event_id||""),last_seen_at:now},{onConflict:"token_id"});
    if(seenErr)throw seenErr;
    const {error:ownErr}=await supabase.from("zecblocks_ownership_events").upsert({event_key:eventKey,token_id:token,event_type:"claim",from_commitment:null,to_commitment:v.owner,event_timestamp:Number(rep?.event_timestamp||row.event_timestamp||0),block_height:v.blockHeight,tx_index:v.txIndex,chain:"zcash",txid,verified_level:"full",payload:patched,updated_at:now},{onConflict:"event_key"});
    if(ownErr)throw ownErr;
    await markToken(token);
    return {ok:true,token,txid}
  }catch(e){
    const deferred=e instanceof DeferredError,err=String((e as any)?.message||e).slice(0,500);
    const {error}=await supabase.from("zecblocks_events").update({
      verification_status:deferred?"deferred":"invalid",protocol_audited:!deferred,
      chain_confirmed:deferred?null:false,audited_at:deferred?null:now,audit_error:err,
      verification_error:err,updated_at:now
    }).eq("event_type","CLAIM").eq("token_id",token).eq("txid",txid);
    if(error)throw error;
    await markToken(token);
    return {ok:false,deferred,token,txid,error:err}
  }
}

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:CORS});
  if(req.method!=="POST")return new Response(JSON.stringify({ok:false,error:"POST only"}),{status:405,headers:CORS});
  try{
    const body=await req.json().catch(()=>({}));
    const onlyToken=Number(body.tokenId);
    let rows:any[]=[];
    if(Number.isInteger(onlyToken)&&onlyToken>=1&&onlyToken<=SUPPLY){
      const {data,error}=await supabase.from("zecblocks_events").select("*").eq("event_type","CLAIM").eq("token_id",onlyToken);
      if(error)throw error;
      const score=(x:any)=>{
        const p=x?.payload||{};let s=0;
        if(Number(p.v||1)>=3)s+=100;
        if(p.memo)s+=30;if(p.signature)s+=25;if(p.pubkey)s+=20;
        if(p.ownerCommitment)s+=15;if(p.proofHash)s+=10;if(p.sourceHash)s+=10;if(p.nonce!=null)s+=5;
        return s
      };
      const by=new Map<string,any>();
      for(const x of data||[]){
        const k=clean(x.txid)||x.event_key,prev=by.get(k);
        if(!prev||score(x)>score(prev))by.set(k,x)
      }
      rows=[...by.values()]
    }else{
      const {data,error}=await supabase.rpc("zecblocks_claim_audit_batch",{p_limit:Math.max(1,Math.min(40,Number(body.limit)||20))});
      if(error)throw error;rows=data||[]
    }
    const out:any[]=[];
    for(let i=0;i<rows.length;i+=5){
      const r=await Promise.all(rows.slice(i,i+5).map(auditRow));out.push(...r)
    }
    const affected=[...new Set(out.map(x=>Number(x.token)).filter(Number.isInteger))];
    if(affected.length){const {error}=await supabase.rpc("zecblocks_rebuild_ownership_tokens",{p_token_ids:affected});if(error)console.warn("ownership rebuild",error)}
    return new Response(JSON.stringify({ok:true,audited:out.length,valid:out.filter(x=>x.ok).length,invalid:out.filter(x=>!x.ok&&!x.deferred).length,deferred:out.filter(x=>x.deferred).length,results:out.slice(0,50)}),{headers:CORS})
  }catch(e){
    return new Response(JSON.stringify({ok:false,error:String((e as any)?.message||e)}),{status:500,headers:CORS})
  }
});
