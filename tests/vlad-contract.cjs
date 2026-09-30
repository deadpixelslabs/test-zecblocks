'use strict';
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {id,keccak256,AbiCoder,toBeHex}=require('ethers');
const {startChain}=require('./helpers/rh20-chain.cjs');
const lib=require('../rh20/protocol.js'),P=lib.forToken('VLAD');
const {verifyRegistration}=require('../scripts/publish-vlad.cjs');
let chain,core,receipt,config;
before(async()=>{chain=await startChain();core=chain.core;config={...require('../rh20/vlad.json'),contractAddress:await core.getAddress()};});
after(async()=>{if(chain)await chain.close();});
test('VLAD registers in the original registry with 100M/40/unlimited and zero premine',async()=>{
 assert.equal((await verifyRegistration(chain.provider,config)).state,'awaiting-registration');
 receipt=await(await core.inscribe(P.DEPLOY)).wait();
 assert.equal(P.validateToken(await core.getToken('VLAD')),0n);
 assert.equal(await core.balanceOf('VLAD',chain.signers[0].address),0n);
 assert.equal(receipt.contractAddress,null);
 assert.equal((await chain.provider.getTransaction(receipt.hash)).to,await core.getAddress());
 assert.equal(lib.validateToken(await core.getToken('RHSC')),0n);
 await assert.rejects(core.inscribe.staticCall(P.DEPLOY),/TokenAlreadyExists/);
 await assert.rejects(core.inscribe.staticCall(P.MINT,{value:1n}));
});
test('VLAD mints past 20 times while the existing RHSC cap stays 20',async()=>{
 for(let i=0;i<21;i++)await(await core.connect(chain.signers[1]).inscribe(P.MINT)).wait();
 assert.equal(await core.balanceOf('VLAD',chain.signers[1].address),840n);
 assert.equal(await core.mintCount('VLAD',chain.signers[1].address),21n);
 assert.equal(P.mintState(840n,21n).canMint,true);
 assert.equal(lib.mintState(10000n,20n).canMint,false);
 assert.equal((await core.getToken('RHSC')).maxMintsPerWallet,20n);
});
test('canonical mint amount and uint256 deployment validation reject malformed inputs',async()=>{
 for(const value of ['0','040','39','41','500','4e1','-40'])await assert.rejects(core.inscribe.staticCall(P.MINT.replace('"40"','"'+value+'"')));
 for(const [tick,max,lim]of[['bad','100','1'],['X','100','1'],['TOKEN','101','40'],['TOKEN','1e8','40'],['TOKEN',String(1n<<256n),'1']])assert.throws(()=>lib.validateRules(tick,max,lim));
 assert.deepEqual(lib.validateRules('COMM','1000','10'),{ticker:'COMM',maxSupply:'1000',mintAmount:'10',maxMintsPerWallet:0});
});
test('two wallets competing for the final 40 VLAD cannot exceed supply',async()=>{
 const snapshot=await chain.provider.send('evm_snapshot',[]);
 try{
  const slot=BigInt(keccak256(AbiCoder.defaultAbiCoder().encode(['bytes32','uint256'],[id('VLAD'),2])))+3n;
  await chain.provider.send('anvil_setStorageAt',[await core.getAddress(),toBeHex(slot,32),toBeHex(99999960n,32)]);
  await chain.provider.send('evm_setAutomine',[false]);
  const a=await core.connect(chain.signers[3]).inscribe(P.MINT,{gasLimit:500000});
  const b=await core.connect(chain.signers[4]).inscribe(P.MINT,{gasLimit:500000});
  await chain.provider.send('evm_mine',[]);
  assert.deepEqual((await Promise.all([chain.provider.getTransactionReceipt(a.hash),chain.provider.getTransactionReceipt(b.hash)])).map(r=>r.status).sort(),[0,1]);
  assert.equal((await core.getToken('VLAD')).totalSupply,100000000n);
 }finally{await chain.provider.send('evm_setAutomine',[true]);await chain.provider.send('evm_revert',[snapshot]);}
});
test('registration verification binds exact data, registry, canonical receipt and token event',async()=>{
 const result=await verifyRegistration(chain.provider,config,{hash:receipt.hash});
 assert.equal(result.registrationTxHash,receipt.hash);assert.equal(result.mintAmount,'40');assert.equal(result.maxMintsPerWallet,0);
 await assert.rejects(verifyRegistration(chain.provider,config,{hash:chain.receipt.hash}),/not the exact/);
 const wrongBlock=new Proxy(chain.provider,{get(target,key){if(key==='getBlock')return async()=>({hash:'0x'+'00'.repeat(32)});const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
 await assert.rejects(verifyRegistration(wrongBlock,config,{hash:receipt.hash}),/not canonical/);
});
test('tickers in the same registry have separate recovery keys and independent mint rules',async()=>{
 const address=await core.getAddress(),account=chain.signers[0].address;
 assert.notEqual(P.pendingKey('mint',account,address),lib.pendingKey('mint',account,address));
 assert.equal(lib.pendingKey('mint',account,address),'rh20:4663:mint:'+address.toLowerCase()+':'+account.toLowerCase());
 const custom=lib.forToken('COMM',{maxSupply:'1000',mintAmount:'10'});
 await(await core.inscribe(custom.DEPLOY)).wait();await(await core.connect(chain.signers[5]).inscribe(custom.MINT)).wait();
 assert.equal(custom.validateToken(await core.getToken('COMM')),10n);
 assert.equal((await core.getToken('VLAD')).totalSupply,840n);
 assert.throws(()=>lib.forToken('ATTACK',{maxSupply:'101',mintAmount:'40'}));
});
