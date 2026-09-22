import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { verifyEvent } from "npm:nostr-tools@2.17.0";

const RELAYS=[
  "wss://relay.snort.social",
  "wss://nostr.mom",
  "wss://relay.nostr.band",
  "wss://nos.lol",
  "wss://relay.primal.net",
  "wss://relay.damus.io"
];
const TAG="zb1-mainnet-v1",KIND=30078,SUPPLY=5000,BATCH=50,QUORUM=4;
const supabase=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false}});
const hx=(v:any,n?:number)=>{const s=String(v??"").trim().replace(/^0x/,"").toLowerCase();if(!/^[0-9a-f]+$/.test(s))return "";if(n&&s.length!==n)return "";return s};

function parseClaim(n:any){
  try{
    if(!n?.content||!verifyEvent(n))return null;
    const o=JSON.parse(String(n.content));
    if(o?.protocol!=="ZB1"||String(o?.type||"").toUpperCase()!=="CLAIM")return null;
    const tokenId=Number(o.tokenId);
    if(!Number.isInteger(tokenId)||tokenId<1||tokenId>SUPPLY)return null;
    if(!/^\d+$/.test(String(o.nonce??""))||!hx(o.txid,64))return null;
    return {n,o,tokenId};
  }catch{return null}
}
async function queryRelay(url:string,ids:number[]){
  return await new Promise<{ok:boolean,events:any[]}>((resolve)=>{
    const events:any[]=[];let done=false,opened=false;
    const sub="scan-"+crypto.randomUUID().slice(0,8),ws=new WebSocket(url);
    const finish=(ok:boolean)=>{if(done)return;done=true;clearTimeout(timer);try{ws.send(JSON.stringify(["CLOSE",sub]))}catch{};try{ws.close()}catch{};resolve({ok,events})};
    const timer=setTimeout(()=>finish(false),7500);
    ws.onopen=()=>{opened=true;try{
      ws.send(JSON.stringify(["REQ",sub,{kinds:[KIND,1],"#t":[TAG],"#i":ids.map(x=>"zb1-token:"+x),limit:Math.min(1800,Math.max(300,ids.length*30))}]));
    }catch{finish(false)}};
    ws.onmessage=(ev)=>{try{
      const m=JSON.parse(String(ev.data||""));
      if(m[0]==="EOSE"&&m[1]===sub){finish(opened);return}
      if(m[0]!=="EVENT"||m[1]!==sub)return;
      const p=parseClaim(m[2]);if(p&&ids.includes(p.tokenId))events.push(p)
    }catch{}};
    ws.onerror=()=>finish(false);ws.onclose=()=>{if(!done)finish(false)};
  })
}

Deno.serve(async(req:Request)=>{
  try{
    if(req.method!=="POST")return new Response("POST only",{status:405});
    const now=Date.now();
    const {data:st}=await supabase.from("zecblocks_indexer_state").select("cursor").eq("indexer","availability_relay_scan").maybeSingle();
    let cur:any=st?.cursor||{};
    if(now-Number(cur.last_run_ms||0)<20000)return Response.json({ok:true,throttled:true,cursor:cur});

    let start=Number(cur.start_token||1);
    let round=Number(cur.round||1);
    if(start>SUPPLY){start=1;round++}

    const ids:number[]=[];for(let x=start;x<=Math.min(SUPPLY,start+BATCH-1);x++)ids.push(x);

    // Resource-safe authoritative pass: one relay at a time until 4 succeed.
    // This avoids opening many large Nostr result sets in memory at once.
    const batchNo=Math.floor((start-1)/BATCH);
    const offset=(batchNo+round-1)%RELAYS.length;
    const ordered=RELAYS.map((_,i)=>RELAYS[(offset+i)%RELAYS.length]);
    const good:any[]=[];
    for(const url of ordered){
      if(good.length>=QUORUM)break;
      try{
        const x:any={url,...await queryRelay(url,ids)};
        if(x.ok)good.push(x)
      }catch{}
    }
    const relayNames=good.map((x:any)=>x.url);
    if(good.length<QUORUM){
      const cursor={...cur,start_token:start,round,last_run_ms:now,complete:false,last_error:"relay quorum below 4",relays_ok:good.length};
      await supabase.from("zecblocks_indexer_state").upsert({indexer:"availability_relay_scan",cursor,updated_at:new Date().toISOString()},{onConflict:"indexer"});
      return Response.json({ok:false,retry:true,start,relays_ok:good.length,cursor})
    }

    const eventRows:any[]=[];
    for(const g of good){
      for(const p of g.events||[]){
        eventRows.push({
          event_key:"nostr:"+String(p.n.id),event_type:"CLAIM",token_id:p.tokenId,
          txid:hx(p.o.txid,64)||null,
          block_height:Number.isInteger(Number(p.o.blockHeight))?Number(p.o.blockHeight):null,
          tx_index:Number.isInteger(Number(p.o.txIndex))?Number(p.o.txIndex):null,
          event_timestamp:Number(p.o.blockTime||p.o.timestamp||p.n.created_at||0)||0,
          source:"nostr-authoritative-scan",payload:p.o,relay_event_id:String(p.n.id),
          verification_status:"pending",updated_at:new Date().toISOString()
        })
      }
    }
    // Deduplicate same relay event ID inside this batch.
    const uniq=[...new Map(eventRows.map((x:any)=>[x.event_key,x])).values()];
    for(let i=0;i<uniq.length;i+=200){
      const {error}=await supabase.from("zecblocks_events").upsert(uniq.slice(i,i+200),{onConflict:"event_key",ignoreDuplicates:true});
      if(error)throw error
    }

    // Canonical classification comes from audited DB state, never raw relay presence.
    const {data:db,error:dbe}=await supabase.rpc("zecblocks_claim_state_rows",{p_token_ids:ids});
    if(dbe)throw dbe;
    const by=new Map<number,any[]>();
    for(const x of db||[]){const id=Number(x.token_id);if(!by.has(id))by.set(id,[]);by.get(id)!.push(x)}

    const updates:any[]=[],nowIso=new Date().toISOString(),nowSec=Math.floor(Date.now()/1000);
    let claimed=0,verifying=0,submitting=0,clear=0;
    for(const id of ids){
      const rows=by.get(id)||[];
      const claims=rows.filter((x:any)=>x.event_type==="CLAIM"),intents=rows.filter((x:any)=>x.event_type==="CLAIM_INTENT");
      const valid=claims.filter((x:any)=>x.protocol_audited===true&&x.chain_confirmed===true&&x.verification_status==="verified");
      const waiting=claims.filter((x:any)=>x.protocol_audited!==true&&["pending","deferred","verified"].includes(String(x.verification_status||"")));
      const activeIntents=intents.filter((x:any)=>x.protocol_audited===true&&x.valid_signature===true&&x.verification_status==="verified"&&Number(x.payload?.expires||0)>nowSec);
      let status="clear",winner:any=null;
      if(valid.length){status="claimed";winner=valid[0];claimed++}
      else if(waiting.length){status="claimed_pending";winner=waiting[0];verifying++}
      else if(activeIntents.length){status="submitting";winner=activeIntents.sort((a:any,b:any)=>Number(b.event_timestamp||0)-Number(a.event_timestamp||0))[0];submitting++}
      else clear++;
      updates.push({
        token_id:id,status,checked_relays:Object.fromEntries(relayNames.map(x=>[x,true])),
        relay_quorum:good.length,claim_event_key:winner?.event_key||null,claim_txid:(status==="claimed"||status==="claimed_pending")?(winner?.txid||null):null,
        last_checked_at:nowIso,updated_at:nowIso
      })
    }
    for(let i=0;i<updates.length;i+=250){
      const {error}=await supabase.from("zecblocks_claim_availability").upsert(updates.slice(i,i+250),{onConflict:"token_id"});
      if(error)throw error
    }

    const nextStart=start+BATCH,finished=nextStart>SUPPLY;
    const cursor:any={
      start_token:finished?SUPPLY+1:nextStart,round,last_start:start,last_end:ids.at(-1)||start,
      last_run_ms:now,relays_ok:good.length,relays:relayNames,events_found:uniq.length,
      complete:finished,last_error:null
    };
    if(finished){cursor.completed_at=nowIso;cursor.completed_at_ms=now}
    await supabase.from("zecblocks_indexer_state").upsert({indexer:"availability_relay_scan",cursor,updated_at:nowIso},{onConflict:"indexer"});

    return Response.json({ok:true,authoritative:true,round,start,end:ids.at(-1),relays_ok:good.length,events_found:uniq.length,claimed,verifying,submitting,clear,cursor})
  }catch(e){return Response.json({ok:false,error:String(e?.message||e)},{status:500})}
});
