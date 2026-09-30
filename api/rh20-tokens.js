'use strict';
// Read-only discovery of registrations in the single official RH-20 registry.
const PROJECT=process.env.SUPABASE_URL||'https://tvwvenyomlwvjtwxasca.supabase.co';
const ANON=process.env.SUPABASE_ANON_KEY||'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR2d3ZlbnlvbWx3dmp0d3hhc2NhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg2MjIwMTcsImV4cCI6MjEwNDE5ODAxN30.RLGs8yTBd0JyRdHlv63YzLHJ7t8qPNHqZWN3WRu00VY';
module.exports=async function(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET')return res.status(405).json({error:'GET required'});
 const q=String(req.query?.q||'').toUpperCase(),offset=Number(req.query?.offset||0);
 if(!/^[A-Z0-9]{0,12}$/.test(q)||!Number.isSafeInteger(offset)||offset<0||offset>1000000)return res.status(400).json({error:'Invalid directory page'});
 try{
  const url=PROJECT+'/functions/v1/zecblocks-rh20-tokens?q='+encodeURIComponent(q)+'&offset='+offset;
  const response=await fetch(url,{headers:{apikey:ANON,Authorization:'Bearer '+ANON},signal:AbortSignal.timeout(12000)});
  const data=await response.json();
  if(!response.ok||!Array.isArray(data.tokens)||!Number.isSafeInteger(data.total))throw Error('Directory unavailable');
  res.setHeader('Cache-Control','public,max-age=0,must-revalidate');
  res.setHeader('CDN-Cache-Control','public,s-maxage=5');
  res.setHeader('Vercel-CDN-Cache-Control','public,s-maxage=5');
  return res.status(200).json(data);
 }catch(_){return res.status(503).json({error:'Token discovery is temporarily unavailable. Please refresh.'});}
};
