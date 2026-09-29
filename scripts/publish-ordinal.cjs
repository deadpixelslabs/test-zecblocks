'use strict';
const fs=require('node:fs'),path=require('node:path');
const {JsonRpcProvider,Contract,keccak256,getCreateAddress}=require('ethers');
const P=require('../ordinal/protocol.js');
const artifact=require('../ordinal/RobinhoodOrdinal.json'),rendererArtifact=require('../ordinal/RobinhoodOrdinalRenderer.json');
async function verifyDeployment(provider,config,{address,hash}){
  if(!/^0x[0-9a-fA-F]{40}$/.test(address||''))throw new Error('A collection address is required.');
  if(config.contractAddress&&!P.sameAddress(config.contractAddress,address))throw new Error('Refusing to replace the official collection.');
  if(BigInt(await provider.send('eth_chainId',[]))!==4663n)throw new Error('Wrong chain.');
  const code=await provider.getCode(address);if(code==='0x'||keccak256(code)!==artifact.runtimeCodeHash)throw new Error('Runtime bytecode does not match.');
  if(!hash){
    let lo=0,hi=Number(BigInt(await provider.send('eth_blockNumber',[])));
    while(lo<hi){const mid=Math.floor((lo+hi)/2);if(await provider.getCode(address,mid)==='0x')lo=mid+1;else hi=mid;}
    const block=await provider.send('eth_getBlockByNumber',['0x'+lo.toString(16),true]);
    const tx=block.transactions.find(tx=>tx.to===null&&String(tx.input||tx.data).toLowerCase()===artifact.bytecode.toLowerCase()&&P.sameAddress(getCreateAddress({from:tx.from,nonce:tx.nonce}),address));
    if(!tx)throw new Error('No matching direct deployment transaction found. Supply its hash.');hash=tx.hash;
  }
  const [tx,receipt]=await Promise.all([provider.getTransaction(hash),provider.getTransactionReceipt(hash)]);
  if(!tx||!receipt||receipt.status!==1||!P.sameAddress(receipt.contractAddress,address)||tx.to!==null||tx.value!==0n||tx.data.toLowerCase()!==artifact.bytecode.toLowerCase())throw new Error('Deployment transaction mismatch.');
  const block=await provider.getBlock(receipt.blockNumber);if(block?.hash!==receipt.blockHash)throw new Error('Deployment receipt is not canonical.');
  const core=new Contract(address,artifact.abi,provider),rendererAddress=getCreateAddress({from:address,nonce:1});
  const [state,genesisDeployer,genesisBlock,rendererCode]=await Promise.all([core.collectionState(tx.from,{blockTag:receipt.blockNumber}),core.genesisDeployer(),core.genesisBlock(),provider.getCode(rendererAddress,receipt.blockNumber)]);
  P.validateState(state,rendererAddress);
  if(state.minted!==0n||!P.sameAddress(genesisDeployer,tx.from)||keccak256(rendererCode)!==rendererArtifact.runtimeCodeHash)throw new Error('Genesis state or renderer mismatch.');
  const raw=await provider.send('eth_getTransactionReceipt',[hash]);
  if(genesisBlock!==BigInt(raw.l1BlockNumber??receipt.blockNumber))throw new Error('Genesis receipt mismatch.');
  const events=receipt.logs.filter(l=>P.sameAddress(l.address,address)).map(l=>{try{return core.interface.parseLog(l);}catch(_){return null;}});
  const event=events.find(l=>l?.name==='Genesis');
  if(!event||!P.sameAddress(event.args.deployer,tx.from)||!P.sameAddress(event.args.renderer,rendererAddress)||event.args.supply!==5000n||event.args.protocolFee!==P.FEE||!P.sameAddress(event.args.treasury,P.TREASURY)||event.args.payload!==P.GENESIS)throw new Error('Genesis event mismatch.');
  return {...config,contractAddress:address,rendererAddress,deploymentTxHash:hash,deploymentBlock:receipt.blockNumber};
}
if(require.main===module){
  (async()=>{const args=process.argv.slice(2),value=name=>args[args.indexOf(name)+1],file=path.join(__dirname,'../ordinal/mainnet.json'),config=P.validateConfig(JSON.parse(fs.readFileSync(file))),provider=new JsonRpcProvider(process.env.ORDINAL_RPC_URL||config.rpcUrl,4663,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});
    try{const result=await verifyDeployment(provider,config,{address:value('--address'),hash:args.includes('--hash')?value('--hash'):undefined});if(!args.includes('--check'))fs.writeFileSync(file,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));}finally{provider.destroy();}
  })().catch(e=>{console.error(e);process.exitCode=1;});
}
module.exports={verifyDeployment};
