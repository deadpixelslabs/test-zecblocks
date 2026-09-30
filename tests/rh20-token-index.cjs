'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url'),path=require('node:path');
const {startChain}=require('./helpers/rh20-chain.cjs');
const P=require('../rh20/protocol.js');
test('directory indexes ordered contract events, avoids duplicate passes and rewinds a chain reorganization',async()=>{
 const {synchronizeTokens}=await import(pathToFileURL(path.join(__dirname,'../supabase/functions/zecblocks-rh20-tokens/engine.mjs')));
 const chain=await startChain();
 try{
  const config={address:await chain.core.getAddress(),start:chain.receipt.blockNumber,runtime:chain.artifact.deployedBytecode,topic:chain.core.interface.getEvent('TokenDeployed').topicHash};
  let rows=[],state={cursor:config.start-1,block_hash:null,head:config.start-1,checkpoints:[]},lease=null;
  const db=async(name,args)=>{
   if(name==='rh20_tokens_claim'){if(lease)return null;lease=args.p_lease;return {...state};}
   assert.equal(args.p_lease,lease);
   if(name==='rh20_tokens_apply'){
    assert.equal(args.p_from,state.cursor+1);rows.push(...args.p_events);state={...state,cursor:args.p_to,block_hash:args.p_hash,head:args.p_head,checkpoints:[{block_number:args.p_to,block_hash:args.p_hash},...state.checkpoints]};
   }else if(name==='rh20_tokens_rewind'){
    rows=rows.filter(r=>r.block_number<=args.p_block);state={...state,cursor:args.p_block,block_hash:args.p_hash,checkpoints:state.checkpoints.filter(r=>r.block_number<=args.p_block)};
   }else if(name==='rh20_tokens_finish')lease=null;
   else throw Error(name);
  };
  const decode=log=>{const e=chain.core.interface.parseLog(log).args;return {ticker:e.tick,max_supply:String(e.maxSupply),mint_amount:String(e.mintAmount),wallet_limit:Number(e.maxMintsPerWallet)};};
  const rpc=(method,params)=>chain.provider.send(method,params);
  const snap=await chain.provider.send('evm_snapshot',[]);
  await(await chain.core.inscribe(P.forToken('VLAD').DEPLOY)).wait();
  await(await chain.core.inscribe(P.forToken('CREW',{maxSupply:'1000',mintAmount:'10'}).DEPLOY)).wait();
  await chain.provider.send('anvil_mine',['0x5']);
  await synchronizeTokens({rpc,db,decode,config});
  assert.deepEqual(rows.map(r=>r.ticker),['RHSC','VLAD','CREW']);
  await synchronizeTokens({rpc,db,decode,config});assert.equal(rows.length,3);
  await chain.provider.send('evm_revert',[snap]);
  await(await chain.core.inscribe(P.forToken('AFTER',{maxSupply:'2000',mintAmount:'20'}).DEPLOY)).wait();
  await chain.provider.send('anvil_mine',['0x8']);
  await synchronizeTokens({rpc,db,decode,config});
  assert.deepEqual(rows.map(r=>r.ticker),['RHSC','AFTER']);
  assert.equal(lease,null);
  const saved=rows.length;
  await assert.rejects(synchronizeTokens({rpc:async(m,a)=>m==='eth_chainId'?'0x1':rpc(m,a),db,decode,config}),/Wrong chain/);
  assert.equal(rows.length,saved);assert.equal(lease,null);
 }finally{await chain.close();}
});
