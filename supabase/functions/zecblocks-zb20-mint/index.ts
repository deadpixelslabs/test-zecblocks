import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { verify as secpVerify } from "npm:@noble/secp256k1@2.2.3";

const URL=Deno.env.get("SUPABASE_URL")!;
const SERVICE=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase=createClient(URL,SERVICE,{auth:{persistSession:false}});
const CORS={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"content-type, apikey, authorization",
  "Access-Control-Allow-Methods":"POST, OPTIONS",
  "Content-Type":"application/json",
  "Cache-Control":"no-store"
};

const MINT_MESSAGE='{"p":"zb-20","op":"mint","tick":"ZECS","amt":"210"}';
const DEPLOY_TXID="5bde45c224ae58a41bdd72ab0bfdfe36a23a4d3aa5335381842e19fdac02e5ed";
const EXPLORERS=["https://api.mainnet.cipherscan.app/api"];
const enc=new TextEncoder();

function clean(v:any){return String(v??"").trim()}
function hx(v:any,n?:number){
  const s=clean(v).replace(/^0x/,"").toLowerCase();
  if(!/^[0-9a-f]+$/.test(s))return "";
  if(n&&s.length!==n)return "";
  return s
}
function hb(s:any){
  const x=hx(s);if(!x||x.length%2)return new Uint8Array();
  const b=new Uint8Array(x.length/2);
  for(let i=0;i<b.length;i++)b[i]=parseInt(x.slice(i*2,i*2+2),16);
  return b
}
function cat(...a:Uint8Array[]){
  let n=0;for(const x of a)n+=x.length;
  const o=new Uint8Array(n);let p=0;
  for(const x of a){o.set(x,p);p+=x.length}
  return o
}
function cs(n:number){
  if(n<=0xfc)return new Uint8Array([n]);
  if(n<=0xffff)return new Uint8Array([0xfd,n&255,(n>>8)&255]);
  const b=new Uint8Array(5);b[0]=0xfe;new DataView(b.buffer).setUint32(1,n,true);return b
}
async function sha(b:Uint8Array){return new Uint8Array(await crypto.subtle.digest("SHA-256",b))}
async function dbl(b:Uint8Array){return sha(await sha(b))}
async function shahex(b:Uint8Array){return [...await sha(b)].map(x=>x.toString(16).padStart(2,"0")).join("")}
async function vsig(message:string,sig:any,pub:any){
  try{
    const s=hx(sig),p=hx(pub);
    if(!/^[0-9a-f]{130}$/.test(s)||!(/^[0-9a-f]{66}$/.test(p)||/^[0-9a-f]{130}$/.test(p)))return false;
    const sb=hb(s),prefix="Zcash Signed Message:\n",pb=enc.encode(prefix),mb=enc.encode(message);
    const hash=await dbl(cat(cs(pb.length),pb,cs(mb.length),mb));
    return secpVerify(sb.slice(1,65),hash,hb(p),{lowS:false})
  }catch{return false}
}
function deep(o:any,keys:string[]):any{
  if(!o||typeof o!=="object")return null;
  for(const k of keys)if(o[k]!=null)return o[k];
  for(const v of Object.values(o)){if(v&&typeof v==="object"){const z=deep(v,keys);if(z!=null)return z}}
  return null
}
async function explorer(path:string){
  let last:any=null;
  for(const base of EXPLORERS){
    const ac=new AbortController(),timer=setTimeout(()=>ac.abort(),4500);
    try{
      const r=await fetch(base+path,{headers:{accept:"application/json","user-agent":"ZEC-BLOCKS-ZB20/1.0"},signal:ac.signal});
      if(!r.ok){last=new Error("HTTP "+r.status);continue}
      return await r.json()
    }catch(e){last=e}
    finally{clearTimeout(timer)}
  }
  throw last||new Error("Zcash explorer unavailable")
}
async function txInfo(txid:string){
  const tx=await explorer("/tx/"+txid);
  const bh=Number(deep(tx,["blockHeight","block_height","blockheight","height"]));
  if(!Number.isInteger(bh)||bh<=0)return null;
  const bt=Number(deep(tx,["blockTime","block_time","time","timestamp"]))||0;
  let conf=Number(deep(tx,["confirmations"]))||0;
  if(conf<=0){
    try{
      const info=await explorer("/info");
      const tip=Number(deep(info,["blocks","blockHeight","block_height","height","tipHeight","tip_height"]));
      if(Number.isInteger(tip)&&tip>=bh)conf=tip-bh+1
    }catch{}
  }
  return {blockHeight:bh,blockTime:bt,confirmations:Math.max(1,conf||1)}
}
async function ensureDeployConfirmed(){
  const {data:r,error}=await supabase.from("zecblocks_zb20_registry").select("*").eq("tick","ZECS").maybeSingle();
  if(error)throw error;
  if(!r||String(r.deploy_txid)!==DEPLOY_TXID)throw new Error("ZECS_CANONICAL_DEPLOYMENT_MISSING");
  if(r.status==="confirmed"&&Number(r.block_height)>0)return r;

  let ci:any=null;
  try{ci=await txInfo(DEPLOY_TXID)}catch{}
  if(!ci)throw new Error("ZECS_DEPLOYMENT_CONFIRMATION_PENDING");

  const now=new Date().toISOString();
  const {error:e1}=await supabase.from("zecblocks_zb20_deployments").update({
    status:"confirmed",chain_confirmed:true,block_height:ci.blockHeight,updated_at:now
  }).eq("txid",DEPLOY_TXID);
  if(e1)throw e1;
  const {error:e2}=await supabase.from("zecblocks_zb20_registry").update({
    status:"confirmed",confirmed_at:now,block_height:ci.blockHeight
  }).eq("tick","ZECS").eq("deploy_txid",DEPLOY_TXID);
  if(e2)throw e2;
  return {...r,status:"confirmed",block_height:ci.blockHeight,confirmed_at:now}
}
async function holderEligibility(owner:string){
  const {data,error}=await supabase.from("zecblocks_tokens")
    .select("token_id")
    .eq("owner_commitment",owner)
    .eq("owner_verified_level","full")
    .order("token_id",{ascending:true})
    .limit(1);
  if(error)throw error;
  const tokenId=Number(data?.[0]?.token_id||0);
  return {eligible:Number.isInteger(tokenId)&&tokenId>=1&&tokenId<=5000,tokenId}
}
async function stats(){
  const {data,error}=await supabase.rpc("zecblocks_zb20_stats");
  if(error)throw error;
  return data
}
async function account(owner:string){
  const {data,error}=await supabase.rpc("zecblocks_zb20_account",{p_owner_commitment:owner});
  if(error)throw error;
  return data
}
async function finalize(txid:string,ci:any){
  const {data,error}=await supabase.rpc("zecblocks_zb20_finalize_mint",{
    p_txid:txid,
    p_block_height:ci.blockHeight,
    p_block_time:ci.blockTime||0,
    p_confirmations:ci.confirmations||1
  });
  if(error)throw error;
  return data
}
function jres(x:any,status=200){return new Response(JSON.stringify(x),{status,headers:CORS})}

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:CORS});
  if(req.method!=="POST")return jres({ok:false,error:"POST only"},405);

  try{
    const b=await req.json().catch(()=>({}));
    const action=clean(b.action||"preflight").toLowerCase();

    if(action==="lookup"){
      const txids=[...new Set((Array.isArray(b.txids)?b.txids:[b.txid]).map((x:any)=>hx(x,64)).filter(Boolean))].slice(0,50);
      if(!txids.length)return jres({ok:true,action,rows:[]});
      const {data,error}=await supabase.from("zecblocks_zb20_mints")
        .select("txid,status,owner_commitment,chain_confirmed,block_height,confirmations,reject_reason,created_at,updated_at")
        .in("txid",txids);
      if(error)throw error;
      return jres({ok:true,action,rows:data||[]})
    }

    if(action==="preflight"){
      const owner=hx(b.ownerCommitment,64);
      if(!owner)throw new Error("Connect Noir Wallet first");
      const deploy=await ensureDeployConfirmed();
      const gate=await holderEligibility(owner);
      const st=await stats();
      return jres({
        ok:true,
        action,
        deploy_status:deploy.status,
        deploy_block_height:Number(deploy.block_height||0),
        eligible:gate.eligible,
        eligibility_token_id:gate.tokenId||null,
        mint_open:!!st?.mint_open,
        stats:st
      })
    }

    if(action==="register"){
      const txid=hx(b.txid,64),pub=hx(b.pubkey),sig=hx(b.anchorSignature);
      if(!txid)throw new Error("Invalid mint TXID");
      if(String(b.message||"")!==MINT_MESSAGE)throw new Error("Canonical mint payload mismatch");
      if(!(/^[0-9a-f]{66}$/.test(pub)||/^[0-9a-f]{130}$/.test(pub)))throw new Error("Invalid derived public key");
      if(!/^[0-9a-f]{130}$/.test(sig))throw new Error("Invalid mint anchor signature");

      const anchorMessage="ZB20:MINT_ANCHOR:v1|T=ZECS|X="+txid+"|M="+MINT_MESSAGE;
      if(!(await vsig(anchorMessage,sig,pub)))throw new Error("Invalid mint anchor signature");
      const owner=await shahex(hb(pub));

      const deploy=await ensureDeployConfirmed();
      const gate=await holderEligibility(owner);
      if(!gate.eligible)throw new Error("ZEC_BLOCKS_HOLDER_REQUIRED");

      const st=await stats();
      if(!st?.mint_open)throw new Error("ZECS_MINT_NOT_OPEN");
      if(Number(st.confirmed_events||0)>=100000)throw new Error("ZECS_MINT_SOLD_OUT");

      const {data:existing,error:xe}=await supabase.from("zecblocks_zb20_mints").select("*").eq("txid",txid).maybeSingle();
      if(xe)throw xe;
      if(existing){
        if(String(existing.owner_commitment)!==owner)throw new Error("Mint TXID already registered to another owner");
        return jres({
          ok:true,txid,status:existing.status,owner_commitment:owner,idempotent:true,
          stats:await stats(),account:await account(owner)
        })
      }

      const now=new Date().toISOString();
      const row={
        txid,tick:"ZECS",deploy_txid:DEPLOY_TXID,mint_message:MINT_MESSAGE,amount:210,
        owner_commitment:owner,pubkey:pub,anchor_signature:sig,anchor_message:anchorMessage,
        eligibility_token_id:gate.tokenId,eligibility_verified_at:now,status:"pending",
        chain_confirmed:null,block_height:null,block_time:null,confirmations:null,reject_reason:null,
        updated_at:now
      };
      const {error:ie}=await supabase.from("zecblocks_zb20_mints").insert(row);
      if(ie)throw ie;

      // Registration must return immediately. Chain confirmation/finalization is
      // a server responsibility and must never make the user's wallet request wait.
      return jres({
        ok:true,txid,status:"pending",owner_commitment:owner,eligibility_token_id:gate.tokenId,
        stats:await stats(),account:await account(owner)
      })
    }

    if(action==="sync"){
      const deploy=await ensureDeployConfirmed();
      const {data:rows,error}=await supabase.from("zecblocks_zb20_mints")
        .select("txid")
        .eq("tick","ZECS")
        .eq("status","pending")
        .order("created_at",{ascending:true})
        .limit(30);
      if(error)throw error;
      let confirmed=0,checked=0;
      const list=(rows||[]).map((row:any)=>hx(row.txid,64)).filter(Boolean);
      for(let i=0;i<list.length;i+=8){
        const batch=list.slice(i,i+8);
        const results=await Promise.allSettled(batch.map(async(txid:string)=>{
          const ci=await txInfo(txid);
          if(ci&&ci.blockHeight>Number(deploy.block_height||0)){
            await finalize(txid,ci);
            return true
          }
          return false
        }));
        checked+=batch.length;
        for(const x of results)if(x.status==="fulfilled"&&x.value===true)confirmed++
      }
      return jres({ok:true,action,checked,confirmed,stats:await stats()})
    }

    throw new Error("Unsupported action");
  }catch(e){
    const msg=String((e as any)?.message||e);
    const status=/HOLDER_REQUIRED|MINT_NOT_OPEN|MINT_SOLD_OUT|DEPLOYMENT_CONFIRMATION_PENDING/.test(msg)?409:400;
    return jres({ok:false,error:msg},status)
  }
});