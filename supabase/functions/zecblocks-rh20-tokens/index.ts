import { Interface, id } from 'ethers';
import { synchronizeTokens } from './engine.mjs';
import { CONFIG } from './config.mjs';
declare const EdgeRuntime: { waitUntil(promise:Promise<unknown>):void };
const project=Deno.env.get('SUPABASE_URL')!,service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const iface=new Interface(['event TokenDeployed(bytes32 indexed tokenId,string tick,uint256 maxSupply,uint256 mintAmount,uint32 maxMintsPerWallet,address indexed deployer)']);
const headers={'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'GET,POST,OPTIONS'};
async function db(name:string,args:Record<string,unknown>={}){
 const response=await fetch(project+'/rest/v1/rpc/'+name,{method:'POST',headers:{'Content-Type':'application/json',apikey:service,Authorization:'Bearer '+service},body:JSON.stringify(args),signal:AbortSignal.timeout(12000)});
 if(!response.ok)throw Error('Directory database operation failed: '+name);const body=await response.text();return body?JSON.parse(body):null;
}
async function rpc(method:string,params:unknown[]=[]){
 const response=await fetch(Deno.env.get('RH20_RPC_URL')||CONFIG.rpc,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw Error('Registry RPC unavailable');const body=await response.json();if(body.error||body.jsonrpc!=='2.0'||body.id!==1||!('result'in body))throw Error('Registry RPC read failed');return body.result;
}
function decode(log:any){
 const e=iface.parseLog(log)!.args;
 if(!/^[A-Z0-9]{2,12}$/.test(e.tick)||e.tokenId!==id(e.tick)||e.maxSupply<=0n||e.mintAmount<=0n||e.maxSupply%e.mintAmount!==0n||(e.tick==='RHSC'?e.maxMintsPerWallet!==20n:e.maxMintsPerWallet!==0n))throw Error('Invalid token rules');
 return {ticker:e.tick,token_id:e.tokenId,max_supply:String(e.maxSupply),mint_amount:String(e.mintAmount),wallet_limit:Number(e.maxMintsPerWallet)};
}
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(!['GET','POST'].includes(req.method))return new Response(JSON.stringify({error:'Method not allowed'}),{status:405,headers});
 const url=new URL(req.url),query=(url.searchParams.get('q')||'').toUpperCase(),offset=Number(url.searchParams.get('offset')||0);
 if(!/^[A-Z0-9]{0,12}$/.test(query)||!Number.isSafeInteger(offset)||offset<0||offset>1000000)return new Response(JSON.stringify({error:'Invalid directory query'}),{status:400,headers});
 // JWT verified by the platform. Public requests may only trigger bounded,
 // leased discovery of logs from the fixed official registry, never insert rows.
 const work=synchronizeTokens({rpc,db,decode,config:CONFIG}).catch(error=>console.error('RH-20 discovery:',error.message));
 EdgeRuntime.waitUntil(work);
 try{return new Response(JSON.stringify(await db('rh20_tokens_snapshot',{p_query:query,p_offset:offset})),{headers});}
 catch(_){return new Response(JSON.stringify({error:'Token directory temporarily unavailable'}),{status:503,headers});}
});
