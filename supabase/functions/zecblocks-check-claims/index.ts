import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { verifyEvent } from "npm:nostr-tools@2.17.0";
import { verify as secpVerify } from "npm:@noble/secp256k1@2.2.3";

const RELAYS=[
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.primal.net",
  "wss://relay.nostr.band",
  "wss://relay.snort.social",
  "wss://nostr.mom"
];
const TAG="zb1-mainnet-v1",KIND=30078,SUPPLY=5000;
const GENESIS="ecf6fc3a79885f573d79de70a2de85c34667fc1a4fefe034d3a4015269379f0f",GENESIS_HEIGHT=3488573;
const supabase=createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  {auth:{persistSession:false}}
);
const CORS={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"content-type, apikey, authorization",
  "Access-Control-Allow-Methods":"POST, OPTIONS",
  "Content-Type":"application/json"
};

const clean=(v:any)=>String(v??"").trim();
const hx=(v:any,n?:number)=>{
  const s=clean(v).replace(/^0x/,"").toLowerCase();
  if(!/^[0-9a-f]+$/.test(s))return "";
  if(n&&s.length!==n)return "";
  return s
};
function hb(s:any){const x=hx(s);if(!x||x.length%2)return new Uint8Array();const b=new Uint8Array(x.length/2);for(let i=0;i<b.length;i++)b[i]=parseInt(x.slice(i*2,i*2+2),16);return b}
function cat(...a:Uint8Array[]){let n=0;for(const x of a)n+=x.length;const o=new Uint8Array(n);let p=0;for(const x of a){o.set(x,p);p+=x.length}return o}
function cs(n:number){if(n<=0xfc)return new Uint8Array([n]);if(n<=0xffff)return new Uint8Array([0xfd,n&255,(n>>8)&255]);const b=new Uint8Array(5);b[0]=0xfe;new DataView(b.buffer).setUint32(1,n,true);return b}
async function sha(b:Uint8Array){return new Uint8Array(await crypto.subtle.digest("SHA-256",b))}
async function dbl(b:Uint8Array){return sha(await sha(b))}
async function shahex(b:Uint8Array){return [...await sha(b)].map(x=>x.toString(16).padStart(2,"0")).join("")}
async function vsig(message:string,sig:any,pub:any){try{const s=hx(sig),p=hx(pub);if(!/^[0-9a-f]{130}$/.test(s)||!(/^[0-9a-f]{66}$/.test(p)||/^[0-9a-f]{130}$/.test(p)))return false;const sb=hb(s),prefix="Zcash Signed Message:\n",pb=new TextEncoder().encode(prefix),mb=new TextEncoder().encode(message),hash=await dbl(cat(cs(pb.length),pb,cs(mb.length),mb));return secpVerify(sb.slice(1,65),hash,hb(p),{lowS:false})}catch{return false}}
function parseProtocolEvent(n:any){
  try{
    if(!n?.content||!verifyEvent(n))return null;
    const o=JSON.parse(String(n.content));if(o?.protocol!=="ZB1")return null;
    const type=String(o?.type||"").toUpperCase(),tokenId=Number(o.tokenId);
    if(!Number.isInteger(tokenId)||tokenId<1||tokenId>SUPPLY)return null;
    if(type==="CLAIM"){if(!/^\d+$/.test(String(o.nonce??""))||!hx(o.txid,64))return null;return {nostr:n,payload:o,tokenId,type}}
    if(type==="CLAIM_INTENT"){
      const pub=hx(o.pubkey),sig=hx(o.signature),owner=hx(o.ownerCommitment,64);
      if(!/^\d+$/.test(String(o.nonce??""))||!owner||!(/^[0-9a-f]{66}$/.test(pub)||/^[0-9a-f]{130}$/.test(pub))||!/^[0-9a-f]{130}$/.test(sig))return null;
      return {nostr:n,payload:o,tokenId,type}
    }
    return null
  }catch{return null}
}
async function validActiveIntent(p:any){
  try{
    if(p?.type!=="CLAIM_INTENT")return false;
    const o=p.payload||{},token=Number(p.tokenId),owner=hx(o.ownerCommitment,64),pub=hx(o.pubkey),sig=hx(o.signature);
    const now=Math.floor(Date.now()/1000),ts=Number(o.timestamp||p.nostr?.created_at||0),expires=Number(o.expires||0);
    if(!owner||!Number.isFinite(ts)||!Number.isFinite(expires)||expires<=now||expires>ts+900||ts<now-1800||ts>now+120)return false;
    if(Number(o.sourceHeight)!==GENESIS_HEIGHT-token||!hx(o.sourceHash,64)||!hx(o.proofHash,64))return false;
    if(await shahex(hb(pub))!==owner)return false;
    const msg=`ZB1:CLAIM_INTENT:v3|G=${GENESIS}|T=${token}|N=${String(o.nonce)}|O=${owner}`;
    return await vsig(msg,sig,pub)
  }catch{return false}
}

async function queryRelay(url:string,tokenIds:number[]){
  return await new Promise<{url:string,ok:boolean,events:any[]}>((resolve)=>{
    const events:any[]=[];let done=false,opened=false;
    const sub="zb1-"+crypto.randomUUID().slice(0,8);
    const ws=new WebSocket(url);
    const finish=(ok:boolean)=>{
      if(done)return;done=true;clearTimeout(timer);
      try{ws.send(JSON.stringify(["CLOSE",sub]))}catch{}
      try{ws.close()}catch{}
      resolve({url,ok,events});
    };
    const timer=setTimeout(()=>finish(false),5200);
    ws.onopen=()=>{
      opened=true;
      try{
        const lim=Math.min(2400,Math.max(200,tokenIds.length*30));
        ws.send(JSON.stringify([
          "REQ",sub,
          {kinds:[KIND,1],"#t":[TAG],"#i":tokenIds.map(x=>"zb1-token:"+x),limit:lim}
        ]));
      }catch{finish(false)}
    };
    ws.onmessage=(ev)=>{
      try{
        const m=JSON.parse(String(ev.data||""));
        if(m[0]==="EOSE"&&m[1]===sub){finish(opened);return}
        if(m[0]!=="EVENT"||m[1]!==sub)return;
        const p=parseProtocolEvent(m[2]);
        if(p&&tokenIds.includes(p.tokenId))events.push(p);
      }catch{}
    };
    ws.onerror=()=>finish(false);
    ws.onclose=()=>{if(!done)finish(false)};
  });
}

async function persistRelayEvents(found:Map<number,any[]>){
  const claimRows:any[]=[],intentRows:any[]=[];
  for(const arr of found.values())for(const p of arr){
    if(!p.nostr)continue;
    const n=p.nostr,o=p.payload,type=String(p.type||"CLAIM");
    const base={event_key:"nostr:"+String(n.id),event_type:type,token_id:Number(o.tokenId),txid:type==="CLAIM"?(hx(o.txid,64)||null):null,block_height:Number.isInteger(Number(o.blockHeight))?Number(o.blockHeight):null,tx_index:Number.isInteger(Number(o.txIndex))?Number(o.txIndex):null,event_timestamp:Number(o.blockTime||o.timestamp||n.created_at||0)||0,source:"nostr-exact",payload:o,relay_event_id:String(n.id||""),updated_at:new Date().toISOString()};
    if(type==="CLAIM_INTENT")intentRows.push({...base,verification_status:"verified",verified_level:"signature",valid_signature:true,protocol_audited:true,chain_confirmed:null});
    else claimRows.push({...base,verification_status:"pending"});
  }
  for(let i=0;i<claimRows.length;i+=200){const {error}=await supabase.from("zecblocks_events").upsert(claimRows.slice(i,i+200),{onConflict:"event_key",ignoreDuplicates:true});if(error)throw error}
  for(let i=0;i<intentRows.length;i+=200){const {error}=await supabase.from("zecblocks_events").upsert(intentRows.slice(i,i+200),{onConflict:"event_key"});if(error)throw error}
  return claimRows.length+intentRows.length
}

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:CORS});
  if(req.method!=="POST")return new Response(JSON.stringify({ok:false,error:"POST only"}),{status:405,headers:CORS});
  try{
    const body=await req.json().catch(()=>({}));
    let tokenIds=(Array.isArray(body.tokenIds)?body.tokenIds:[])
      .map(Number).filter((x:number)=>Number.isInteger(x)&&x>=1&&x<=SUPPLY);
    tokenIds=[...new Set(tokenIds)].slice(0,50);
    if(!tokenIds.length)throw new Error("tokenIds required");

    let relaysOk=0;
    const relayNames:string[]=[];
    const relayFound=new Map<number,any[]>();

    const relayResults=await Promise.all(RELAYS.map(async url=>{
      try{return await queryRelay(url,tokenIds)}catch{return null}
    }));
    for(const rr of relayResults){
      if(!rr)continue;
      if(rr.ok){relaysOk++;relayNames.push(rr.url)}
      for(const p of rr.events||[]){
        if(p.type==="CLAIM_INTENT"&&!(await validActiveIntent(p)))continue;
        if(!relayFound.has(p.tokenId))relayFound.set(p.tokenId,[]);
        const a=relayFound.get(p.tokenId)!;
        const key=String(p.nostr?.id||p.payload?.txid||"");
        if(!a.some((x:any)=>String(x.nostr?.id||x.payload?.txid||"")===key))a.push(p)
      }
    }

    const inserted=await persistRelayEvents(relayFound);

    const {data:db,error:dbe}=await supabase.rpc("zecblocks_claim_state_rows",{p_token_ids:tokenIds});
    if(dbe)throw dbe;

    const byToken=new Map<number,any[]>();
    for(const row of db||[]){
      const id=Number(row.token_id);
      if(!byToken.has(id))byToken.set(id,[]);
      byToken.get(id)!.push(row)
    }

    const complete=relaysOk>=4,nowSec=Math.floor(Date.now()/1000);
    const claimedIds:number[]=[],pendingIds:number[]=[],submittingIds:number[]=[],clearIds:number[]=[];
    const statusByToken:any={},canonicalClaims:any={},events:any[]=[];
    const availabilityRows:any[]=[];
    const nowIso=new Date().toISOString();

    for(const id of tokenIds){
      const rows=byToken.get(id)||[];
      const claims=rows.filter((x:any)=>x.event_type==="CLAIM"),intents=rows.filter((x:any)=>x.event_type==="CLAIM_INTENT");
      const valid=claims.filter((x:any)=>x.protocol_audited===true&&x.chain_confirmed===true&&x.verification_status==="verified");
      const waiting=claims.filter((x:any)=>x.protocol_audited!==true&&["pending","deferred","verified"].includes(String(x.verification_status||"")));
      const activeIntents=intents.filter((x:any)=>x.protocol_audited===true&&x.valid_signature===true&&x.verification_status==="verified"&&Number(x.payload?.expires||0)>nowSec);

      let status="unknown",winner:any=null;
      if(valid.length){status="claimed";winner=valid[0];claimedIds.push(id)}
      else if(waiting.length){status="claimed_pending";winner=waiting[0];pendingIds.push(id)}
      else if(activeIntents.length){status="submitting";winner=activeIntents.sort((a:any,b:any)=>Number(b.event_timestamp||0)-Number(a.event_timestamp||0))[0];submittingIds.push(id)}
      else if(complete){status="clear";clearIds.push(id)}

      statusByToken[id]=status;
      if(status==="claimed")canonicalClaims[id]={txid:winner.txid,ownerCommitment:winner.payload?.ownerCommitment||winner.payload?._auditedOwner||null};
      availabilityRows.push({token_id:id,status,relay_quorum:relaysOk,checked_relays:Object.fromEntries(relayNames.map(x=>[x,true])),claim_event_key:winner?.event_key||null,claim_txid:(status==="claimed"||status==="claimed_pending")?(winner?.txid||null):null,last_checked_at:nowIso,updated_at:nowIso});
      for(const x of [...valid,...waiting,...activeIntents].slice(0,4))events.push({...x.payload,tokenId:id,_eventType:x.event_type,_verificationStatus:x.verification_status,_protocolAudited:x.protocol_audited,_chainConfirmed:x.chain_confirmed})
    }

    if(availabilityRows.length){
      const {error}=await supabase.from("zecblocks_claim_availability").upsert(availabilityRows,{onConflict:"token_id"});
      if(error)throw error;
    }

    return new Response(JSON.stringify({
      ok:true,complete,relays_ok:relaysOk,relays:relayNames,requested:tokenIds,
      claimed_ids:claimedIds,pending_ids:pendingIds,submitting_ids:submittingIds,clear_ids:clearIds,
      status_by_token:statusByToken,canonical_claims:canonicalClaims,events,inserted
    }),{headers:CORS})
  }catch(e){
    return new Response(JSON.stringify({ok:false,error:String(e?.message||e)}),{status:500,headers:CORS})
  }
});
