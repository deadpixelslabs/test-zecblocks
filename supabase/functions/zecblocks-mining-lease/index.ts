import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { verifyCapacityProof } from "./capacity-proof.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

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
const ownerOf=(x:any)=>String(x||"").replace(/^0x/,"").toLowerCase();
const clampToken=(x:any)=>Math.max(1,Math.min(5000,Number(x)||1));

async function exactCheck(ids:number[]){
  const r=await fetch(URL+"/functions/v1/zecblocks-check-claims",{
    method:"POST",
    headers:{
      "content-type":"application/json",
      "apikey":SERVICE,
      "authorization":"Bearer "+SERVICE
    },
    body:JSON.stringify({tokenIds:ids,deep:true})
  });
  const j=await r.json().catch(()=>null);
  if(!r.ok||!j?.ok)throw new Error(j?.error||("exact claim check HTTP "+r.status));
  return j;
}
function exactStatus(j:any,id:number){
  return String(j?.status_by_token?.[String(id)]??j?.status_by_token?.[id]??"unknown")
}
function hasHardClaimSignal(j:any,ids:number[]){
  return ids.some(id=>["claimed","claimed_pending","submitting"].includes(exactStatus(j,id)))
}
async function exactCheckStable(ids:number[],attempts=2){
  let last:any=null;
  for(let i=0;i<Math.max(1,attempts);i++){
    last=await exactCheck(ids);
    if(hasHardClaimSignal(last,ids))return last;
    if(last?.complete===true&&Number(last?.relays_ok||0)>=4)return last;
    if(i+1<attempts)await new Promise(r=>setTimeout(r,350*(i+1)))
  }
  return last
}
async function release(owner:string,tokenId:number,leaseToken:string){
  if(!leaseToken)return;
  await supabase.rpc("zecblocks_release_reservation",{
    p_owner_commitment:owner,p_token_id:tokenId,p_lease_token:leaseToken
  });
}
async function renew(owner:string,tokenId:number,leaseToken:string,check:any,commit=false){
  const ownIntent=(Array.isArray(check?.events)?check.events:[]).find((e:any)=>
    String(e?._eventType||e?.type||"").toUpperCase()==="CLAIM_INTENT"&&Number(e.tokenId)===tokenId&&ownerOf(e.ownerCommitment)===owner&&Number(e.expires)>Math.floor(Date.now()/1000));
  if(ownIntent)await verifyCapacityProof(ownIntent,owner);
  if(commit&&!ownIntent)return {ok:false,error:"CLAIM_INTENT_NOT_VERIFIED"};
  const {data,error}=await supabase.rpc("zecblocks_renew_reservation",{
    p_owner_commitment:owner,p_token_id:tokenId,p_lease_token:leaseToken,p_ttl_seconds:600
  });
  if(error)throw error;
  return data;
}
async function reserveSpecific(owner:string,tokenId:number){
  const {data,error}=await supabase.rpc("zecblocks_reserve_specific_clear_token",{
    p_owner_commitment:owner,p_token_id:tokenId,p_ttl_seconds:600
  });
  if(error)throw error;
  return data;
}
function isDeepClear(j:any,id:number,owner=""){
  const st=j?.status_by_token?.[String(id)]??j?.status_by_token?.[id];
  if(j?.complete!==true||Number(j?.relays_ok||0)<4)return false;
  if(st==="clear"&&Array.isArray(j?.clear_ids)&&j.clear_ids.map(Number).includes(id))return true;
  if(st==="submitting"&&owner){
    return (Array.isArray(j?.events)?j.events:[]).some((e:any)=>
      String(e?._eventType||e?.type||"").toUpperCase()==="CLAIM_INTENT" &&
      Number(e?.tokenId)===Number(id) &&
      ownerOf(e?.ownerCommitment)===owner &&
      Number(e?.expires||0)>Math.floor(Date.now()/1000)
    )
  }
  return false
}

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:CORS});
  if(req.method!=="POST")return new Response(JSON.stringify({ok:false,error:"POST only"}),{status:405,headers:CORS});
  try{
    const body=await req.json().catch(()=>({}));
    const action=String(body.action||"reserve").toLowerCase();
    const owner=ownerOf(body.ownerCommitment);
    if(!/^[0-9a-f]{64}$/.test(owner))throw new Error("invalid owner commitment");

    if(action==="release"){
      const tokenId=Number(body.tokenId),leaseToken=String(body.leaseToken||"");
      if(!Number.isInteger(tokenId)||tokenId<1||tokenId>5000||!/^[0-9a-f]{48}$/.test(leaseToken))throw new Error("invalid lease");
      const {data,error}=await supabase.rpc("zecblocks_release_reservation",{
        p_owner_commitment:owner,p_token_id:tokenId,p_lease_token:leaseToken
      });
      if(error)throw error;
      return new Response(JSON.stringify(data),{headers:CORS});
    }

    if(action==="renew"||action==="validate"){
      const tokenId=Number(body.tokenId),leaseToken=String(body.leaseToken||"");
      if(!Number.isInteger(tokenId)||tokenId<1||tokenId>5000||!/^[0-9a-f]{48}$/.test(leaseToken))throw new Error("invalid lease");
      const check=await exactCheckStable([tokenId],2);
      if(check?.complete!==true||Number(check?.relays_ok||0)<4){
        return new Response(JSON.stringify({
          ok:false,error:"VERIFICATION_TEMPORARY_UNAVAILABLE",preserve_lease:true,token_id:tokenId,
          relays_ok:Number(check?.relays_ok||0),required_relays:4,
          status:exactStatus(check,tokenId)
        }),{headers:CORS});
      }
      if(!isDeepClear(check,tokenId,owner)){
        await release(owner,tokenId,leaseToken);
        return new Response(JSON.stringify({
          ok:false,error:"TOKEN_NO_LONGER_CLEAR",token_id:tokenId,
          relays_ok:Number(check?.relays_ok||0),
          status:exactStatus(check,tokenId)
        }),{headers:CORS});
      }
      const data=await renew(owner,tokenId,leaseToken,check,body.commit===true);
      return new Response(JSON.stringify({
        ...data,validated:true,token_id:tokenId,relays_ok:Number(check.relays_ok||0),
        verified_at:Math.floor(Date.now()/1000)
      }),{headers:CORS});
    }

    if(action==="reserve_specific"){
      const tokenId=Number(body.tokenId);
      if(!Number.isInteger(tokenId)||tokenId<1||tokenId>5000)throw new Error("invalid token id");
      const check=await exactCheckStable([tokenId],2);
      if(!isDeepClear(check,tokenId,owner)){
        return new Response(JSON.stringify({
          ok:false,error:"TOKEN_NOT_DEEP_CLEAR",token_id:tokenId,
          relays_ok:Number(check?.relays_ok||0),
          status:check?.status_by_token?.[String(tokenId)]||"unknown"
        }),{headers:CORS});
      }
      const data=await reserveSpecific(owner,tokenId);
      if(!data?.ok)return new Response(JSON.stringify(data),{headers:CORS});
      const confirm=await exactCheckStable([tokenId],2);
      if(!isDeepClear(confirm,tokenId,owner)){
        await release(owner,tokenId,String(data.lease_token||""));
        return new Response(JSON.stringify({
          ok:false,error:"TOKEN_CHANGED_DURING_RESERVATION",token_id:tokenId,
          status:confirm?.status_by_token?.[String(tokenId)]||"unknown"
        }),{headers:CORS});
      }
      return new Response(JSON.stringify({
        ...data,deep_verified:true,relays_ok:Number(confirm.relays_ok||0),
        verified_at:Math.floor(Date.now()/1000)
      }),{headers:CORS});
    }

    if(action!=="reserve")throw new Error("unknown action");
    const forceNew=body.forceNew===true;
    const excludeToken=Number.isInteger(Number(body.excludeToken)) ? Number(body.excludeToken) : 0;
    const excludeTokens=new Set<number>(
      (Array.isArray(body.excludeTokens)?body.excludeTokens:[])
        .map(Number).filter((x:number)=>Number.isInteger(x)&&x>=1&&x<=5000).slice(0,120)
    );
    if(excludeToken)excludeTokens.add(excludeToken);

    // Normal reserve calls may reuse an owner's active lease.
    // Find Unclaimed sends forceNew=true so every click releases the old target
    // and searches for another verified-clear Token ID.
    const {data:existing}=await supabase.from("zecblocks_mining_reservations")
      .select("token_id,lease_token,expires_at")
      .eq("owner_commitment",owner).eq("status","active")
      .gt("expires_at",new Date().toISOString())
      .order("expires_at",{ascending:false}).limit(1).maybeSingle();
    if(existing){
      const id=Number(existing.token_id);
      if(forceNew || id===excludeToken){
        await release(owner,id,String(existing.lease_token));
      }else{
        const check=await exactCheckStable([id],2);
        if(isDeepClear(check,id,owner)){
          const rr=await renew(owner,id,String(existing.lease_token),check);
          if(rr?.ok)return new Response(JSON.stringify({
            ...rr,token_id:id,lease_token:String(existing.lease_token),
            reused:true,deep_verified:true,relays_ok:Number(check.relays_ok||0),
            verified_at:Math.floor(Date.now()/1000)
          }),{headers:CORS});
        }
        await release(owner,id,String(existing.lease_token));
      }
    }

    const {data:capacity,error:capacityError}=await supabase.rpc("zecblocks_claim_capacity");
    if(capacityError)throw capacityError;
    if(capacity?.new_claims_open!==true)return new Response(JSON.stringify({ok:false,error:capacity?.claim_open===false?"CLAIM_CAP_REACHED":"CLAIM_SLOTS_PENDING",...capacity}),{headers:CORS});


    const {data:globalStart,error:globalStartErr}=await supabase.rpc("zecblocks_next_global_finder_start");
    if(globalStartErr)throw globalStartErr;
    let start=clampToken(globalStart);
    while(excludeTokens.has(start))start=(start%5000)+1;

    for(let round=0;round<4;round++){
      const {data:ids,error}=await supabase.rpc("zecblocks_mining_candidates",{
        p_start_token:start,p_limit:12
      });
      if(error)throw error;
      const candidates=(Array.isArray(ids)?ids:[]).map(Number).filter((x:number)=>Number.isInteger(x)&&x>=1&&x<=5000&&!excludeTokens.has(x));
      if(!candidates.length){
        start=((start+997-1)%5000)+1;
        continue;
      }
      const check=await exactCheck(candidates);
      if(check?.complete!==true||Number(check?.relays_ok||0)<4){
        start=((start+997-1)%5000)+1;
        continue;
      }
      const clearSet=new Set((check.clear_ids||[]).map(Number));
      for(const id of candidates){
        if(!clearSet.has(id))continue;
        const data=await reserveSpecific(owner,id);
        if(!data?.ok){if(["CLAIM_CAP_REACHED","CLAIM_SLOTS_PENDING"].includes(data?.error))return new Response(JSON.stringify(data),{headers:CORS});continue;}

        // Final single-token recheck after the atomic reservation closes the
        // largest race window between discovery and starting PoW.
        const confirm=await exactCheckStable([id],2);
        if(!isDeepClear(confirm,id,owner)){
          await release(owner,id,String(data.lease_token||""));
          continue;
        }
        return new Response(JSON.stringify({
          ...data,token_id:id,reused:false,deep_verified:true,
          relays_ok:Number(confirm.relays_ok||0),
          verified_at:Math.floor(Date.now()/1000),
          finder:"v15.7-auto-skip-canonical",
          global_start:Number(globalStart||start)
        }),{headers:CORS});
      }
      start=((candidates.at(-1)||start)%5000)+1;
    }

    return new Response(JSON.stringify({
      ok:false,error:"NO_DEEP_VERIFIED_CLEAR_TOKEN_AVAILABLE"
    }),{headers:CORS});
  }catch(e){
    return new Response(JSON.stringify({ok:false,error:String((e as any)?.message||e)}),{status:500,headers:CORS});
  }
});
