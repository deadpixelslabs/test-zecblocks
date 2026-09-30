export async function synchronizeTokens({rpc,db,decode,config,lease=crypto.randomUUID(),budgetMs=25000,maxRanges=40}) {
 const state=await db('rh20_tokens_claim',{p_lease:lease}); if(!state)return {busy:true};
 const hex=n=>'0x'+n.toString(16),number=v=>{const n=Number(BigInt(v));if(!Number.isSafeInteger(n)||n<0)throw Error('Invalid block number');return n;};
 let cursor=Number(state.cursor),hash=state.block_hash,head=Number(state.head),failure=null,processed=0;
 const block=async n=>{const b=await rpc('eth_getBlockByNumber',[hex(n),false]);if(!b||number(b.number)!==n||!/^0x[0-9a-f]{64}$/i.test(b.hash))throw Error('Canonical block unavailable');return b;};
 try{
  if(BigInt(await rpc('eth_chainId',[]))!==4663n)throw Error('Wrong chain');
  if((await rpc('eth_getCode',[config.address,'latest'])).toLowerCase()!==config.runtime.toLowerCase())throw Error('Wrong registry runtime');
  head=number(await rpc('eth_blockNumber',[]))-2;
  if(head<cursor)throw Error('RPC head is behind the saved directory');
  if(hash&&(await block(cursor)).hash.toLowerCase()!==hash.toLowerCase()){
   let match=null;
   for(const point of state.checkpoints||[])if(point.block_number<=head&&(await block(point.block_number)).hash.toLowerCase()===point.block_hash.toLowerCase()){match=point;break;}
   cursor=match?.block_number??config.start-1;hash=match?.block_hash??null;
   await db('rh20_tokens_rewind',{p_lease:lease,p_block:cursor,p_hash:hash});
  }
  hash ||= (await block(cursor)).hash.toLowerCase();
  const began=Date.now();
  while(cursor<head&&Date.now()-began<budgetMs&&processed<maxRanges){
   const from=cursor+1,to=Math.min(head,cursor+50000),before=await block(to);
   const logs=await rpc('eth_getLogs',[{address:config.address,fromBlock:hex(from),toBlock:hex(to),topics:[config.topic]}]);
   if(!Array.isArray(logs))throw Error('Registry logs unavailable');
   const events=logs.map(log=>{
    const n=number(log.blockNumber),index=number(log.logIndex);
    if(log.removed||log.address.toLowerCase()!==config.address.toLowerCase()||log.topics[0]!==config.topic||n<from||n>to||!/^0x[0-9a-f]{64}$/i.test(log.blockHash)||!/^0x[0-9a-f]{64}$/i.test(log.transactionHash))throw Error('Invalid registry event');
    return {...decode(log),block_number:n,block_hash:log.blockHash.toLowerCase(),log_index:index,tx_hash:log.transactionHash.toLowerCase()};
   }).sort((a,b)=>a.block_number-b.block_number||a.log_index-b.log_index);
   const [after,previous]=await Promise.all([block(to),block(cursor)]);
   if(after.hash!==before.hash||previous.hash.toLowerCase()!==hash.toLowerCase())throw Error('Chain changed during discovery');
   await db('rh20_tokens_apply',{p_lease:lease,p_from:from,p_to:to,p_hash:after.hash.toLowerCase(),p_head:head,p_events:events});
   cursor=to;hash=after.hash.toLowerCase();processed++;
  }
  return {cursor,head,processed};
 }catch(error){failure=String(error.message||error).slice(0,250);throw error;}
 finally{await db('rh20_tokens_finish',{p_lease:lease,p_head:head,p_error:failure});}
}
