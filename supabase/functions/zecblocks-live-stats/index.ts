import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const supabase=createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  {auth:{persistSession:false}}
);

const headers={
  "Content-Type":"application/json",
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"content-type, apikey, authorization, cache-control, pragma",
  "Access-Control-Allow-Methods":"GET, POST, OPTIONS",
  "Cache-Control":"no-store, no-cache, must-revalidate, max-age=0",
  "Pragma":"no-cache",
  "Expires":"0"
};

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers});
  try{
    // Public availability projection: evaluate private claim blockers on the
    // server. Only the snapshot's NFT IDs, counters and scan metadata leave it.
    if(new URL(req.url).searchParams.get("view")==="availability"){
      const {data,error}=await supabase.rpc("zecblocks_mining_snapshot");
      if(error)throw error;
      if(!data||!["candidate_ids","verified_ids","clear_ids"].every(k=>Array.isArray(data[k])))throw new Error("Availability snapshot incomplete");
      return new Response(JSON.stringify({ok:true,...data}),{headers});
    }
    const [
      {data:stats,error:se},
      {data:market,error:me},
      {data:scanState,error:sce}
    ]=await Promise.all([
      supabase.rpc("zecblocks_claim_stats"),
      supabase.rpc("zecblocks_market_snapshot"),
      supabase.from("zecblocks_indexer_state").select("cursor").eq("indexer","availability_relay_scan").maybeSingle()
    ]);
    if(se)throw se;
    if(me)throw me;
    if(sce)throw sce;

    const cursor=scanState?.cursor||{};
    return new Response(JSON.stringify({
      ok:true,
      claim_limit:stats?.claim_limit,legacy_id_max:stats?.legacy_id_max,
      allocated_claims:stats?.allocated_claims,slots_available:stats?.slots_available,
      claims_remaining:stats?.claims_remaining,claim_open:stats?.claim_open,new_claims_open:stats?.new_claims_open,
      claims_seen:Number(stats?.claims_seen||0),
      claims_observed:Number(stats?.claims_observed||0),
      canonical_claims:Number(stats?.claims_canonical||0),
      canonical_clear:Number(stats?.claims_clear||0),
      canonical_verifying:Number(stats?.claims_verifying||0),
      canonical_unknown:Number(stats?.claims_unknown||0),
      scan_cursor:Number(cursor?.start_token||1),
      scan_last_start:Number(cursor?.last_start||0),
      scan_last_end:Number(cursor?.last_end||0),
      scan_complete:cursor?.complete===true,
      scan_round:Number(cursor?.round||1),
      relays_ok:Number(cursor?.relays_ok||0),
      usdc_metrics:market?.usdc_metrics||market?.metrics||{},
      generated_at:Math.floor(Date.now()/1000)
    }),{headers});
  }catch(e){
    return new Response(JSON.stringify({ok:false,error:String((e as any)?.message||e)}),{status:500,headers});
  }
});
