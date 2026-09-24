const SUPABASE_URL=process.env.SUPABASE_URL||'https://tvwvenyomlwvjtwxasca.supabase.co';
const SUPABASE_ANON=process.env.SUPABASE_ANON_KEY||'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR2d3ZlbnlvbWx3dmp0d3hhc2NhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg2MjIwMTcsImV4cCI6MjEwNDE5ODAxN30.RLGs8yTBd0JyRdHlv63YzLHJ7t8qPNHqZWN3WRu00VY';

const EDGE = new Set([
  'zecblocks-live-stats',
  'zecblocks-claim-audit',
  'zecblocks-check-claims',
  'zecblocks-mining-lease',
  'zecblocks-availability-scan',
  'zecblocks-backfill-client-claims',
  'zecblocks-zb20-mint'
]);
const RPC = new Set([
  'zecblocks_mining_snapshot',
  'zecblocks_claim_stats',
  'zecblocks_claim_fee_status',
  'zecblocks_zb20_stats',
  'zecblocks_zb20_account'
]);
// Only these two public, parameter-free counters may be shared between visitors.
// Availability, account reads, leases, preflight and registration stay no-store.
const PUBLIC_INFLIGHT = new Map();
function isPublicStats(op,data){
  const counter=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
  if(!data||data.ok===false)return false;
  return op==='live-stats'
    ? data.ok===true&&counter(data.claims_seen)&&counter(data.canonical_claims)
    : data.tick==='ZECS'&&typeof data.mint_open==='boolean'&&counter(data.minted_supply)&&counter(data.confirmed_events);
}
function publicCache(res){
  res.setHeader('Cache-Control','public, max-age=0, must-revalidate');
  res.setHeader('CDN-Cache-Control','public, s-maxage=5');
  res.setHeader('Vercel-CDN-Cache-Control','public, s-maxage=5');
  res.removeHeader('Pragma');res.removeHeader('Expires');
}
async function publicStats(op,{fresh=false}={}){
  const read=()=>op==='live-stats'
    ? upstream(SUPABASE_URL+'/functions/v1/zecblocks-live-stats',{method:'GET',timeoutMs:20000})
    : upstream(SUPABASE_URL+'/rest/v1/rpc/zecblocks_zb20_stats',{body:{},rpc:true});
  if(fresh)return read();
  if(PUBLIC_INFLIGHT.has(op))return PUBLIC_INFLIGHT.get(op);
  const task=read();PUBLIC_INFLIGHT.set(op,task);
  try{return await task}finally{if(PUBLIC_INFLIGHT.get(op)===task)PUBLIC_INFLIGHT.delete(op)}
}

function noStore(res){
  res.setHeader('Cache-Control','no-store, max-age=0, must-revalidate');
  res.setHeader('CDN-Cache-Control','no-store');
  res.setHeader('Vercel-CDN-Cache-Control','no-store');
  res.setHeader('Pragma','no-cache');
  res.setHeader('Expires','0');
}
function jsonBody(req){
  if(req.body==null)return {};
  if(typeof req.body==='object')return req.body;
  try{return JSON.parse(String(req.body||'{}'))}catch{throw new Error('INVALID_JSON')}
}
async function upstream(url,{method='POST',body=null,rpc=false,timeoutMs=12000}={}){
  const headers={
    'accept':'application/json',
    'content-type':'application/json',
    'apikey':SUPABASE_ANON
  };
  headers.authorization='Bearer '+SUPABASE_ANON;
  const ac=new AbortController();
  const timer=setTimeout(()=>ac.abort(),timeoutMs);
  try{
    const r=await fetch(url,{
      method,
      headers,
      ...(method==='GET'?{}:{body:JSON.stringify(body||{})}),
      signal:ac.signal
    });
    const text=await r.text();
    let data=null;try{data=JSON.parse(text)}catch{data={error:text||('HTTP '+r.status)}}
    return {status:r.status,ok:r.ok,data};
  }finally{clearTimeout(timer)}
}

module.exports=async function handler(req,res){
  noStore(res);
  const op=String(req.query.op||'');
  try{
    if(op==='live-stats'||op==='zecs-stats'){
      if(req.method!=='GET')return res.status(405).json({ok:false,error:'GET only'});
      const fresh=req.query.fresh==='1';
      const u=await publicStats(op,{fresh});
      if(!u.ok)return res.status(u.status).json(u.data||{ok:false,error:'Public stats unavailable'});
      if(!isPublicStats(op,u.data))return res.status(503).json({ok:false,error:'Public stats incomplete',retryable:true});
      if(!fresh)publicCache(res);
      return res.status(200).json({ok:true,data:u.data});
    }
    if(op==='rpc'){
      const name=String(req.query.name||'');
      if(!RPC.has(name))return res.status(400).json({ok:false,error:'Unsupported RPC'});
      if(req.method!=='POST')return res.status(405).json({ok:false,error:'POST only'});
      const body=jsonBody(req),availability=name==='zecblocks_mining_snapshot';
      // Private event rows are intentionally hidden from anon by RLS. The
      // server returns a fixed public ID/status projection without exposing them.
      const url=availability?SUPABASE_URL+'/functions/v1/zecblocks-live-stats?view=availability':SUPABASE_URL+'/rest/v1/rpc/'+encodeURIComponent(name);
      const u=await upstream(url,{
        method:availability?'GET':'POST',body:availability?null:body,rpc:!availability
      });
      if(!u.ok)return res.status(u.status).json(u.data||{ok:false,error:'RPC upstream failed'});
      if(availability&&u.data?.ok===false)return res.status(503).json(u.data);
      return res.status(200).json({ok:true,data:u.data});
    }

    const slug = op==='live-stats'?'zecblocks-live-stats':
      op==='claim-audit'?'zecblocks-claim-audit':
      op==='check-claims'?'zecblocks-check-claims':
      op==='mining-lease'?'zecblocks-mining-lease':
      op==='availability-scan'?'zecblocks-availability-scan':
      op==='backfill-client-claims'?'zecblocks-backfill-client-claims':
      op==='zb20-mint'?'zecblocks-zb20-mint':'';

    if(!EDGE.has(slug))return res.status(400).json({ok:false,error:'Unsupported operation'});
    const method=slug==='zecblocks-live-stats'?'GET':'POST';
    if(req.method!==method)return res.status(405).json({ok:false,error:method+' only'});

    const u=await upstream(SUPABASE_URL+'/functions/v1/'+slug,{
      method,body:method==='GET'?null:jsonBody(req),
      timeoutMs:['zecblocks-mining-lease','zecblocks-check-claims','zecblocks-claim-audit','zecblocks-availability-scan'].includes(slug)?50000:20000
    });
    if(!u.ok)return res.status(u.status).json(u.data||{ok:false,error:'Edge upstream failed'});
    return res.status(200).json({ok:true,data:u.data});
  }catch(e){
    const timeout=e&&e.name==='AbortError';
    return res.status(e?.message==='INVALID_JSON'?400:timeout?504:502).json({
      ok:false,
      error:timeout?'Backend upstream timeout':String(e?.message||e),
      retryable:e?.message!=='INVALID_JSON'
    });
  }
};
