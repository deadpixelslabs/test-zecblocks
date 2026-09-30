'use strict';
const {test,before,after,beforeEach,afterEach}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {ContractFactory,id,keccak256,toBeHex,getCreateAddress}=require('ethers');
const solc=require('solc');
const {startChain}=require('./helpers/ordinal-chain.cjs');
const P=require('../ordinal/protocol.js'),api=require('../api/ordinal.js');
const {verifyDeployment}=require('../scripts/publish-ordinal.cjs');
// Isolated deployments must never inherit the official production address.
const unpublishedConfig={...require('../ordinal/mainnet.json'),contractAddress:null,rendererAddress:null,deploymentTxHash:null,deploymentBlock:null};
let chain,core,wallets,snapshot;
const rid=n=>id('ordinal-intent-'+n),mint=(who=1,n='a',extra={})=>core.connect(wallets[who]).inscribe(P.MINT,rid(n),{value:P.FEE,...extra});
before(async()=>{chain=await startChain();core=chain.core;wallets=chain.signers;});
beforeEach(async()=>{snapshot=await chain.provider.send('evm_snapshot',[]);});
afterEach(async()=>{await chain.provider.send('evm_revert',[snapshot]);});
after(async()=>{if(chain)await chain.close();});

test('one deployment creates the fixed collection and exact approved renderer with zero premine',async()=>{
  assert.equal(await core.name(),'Robinhood Ordinal');assert.equal(await core.symbol(),'RHO');
  const renderer=getCreateAddress({from:await core.getAddress(),nonce:1});
  assert.equal(await core.renderer(),renderer);assert.equal(keccak256(await chain.provider.getCode(renderer)),chain.rendererArtifact.runtimeCodeHash);
  assert.equal(keccak256(await chain.provider.getCode(await core.getAddress())),chain.artifact.runtimeCodeHash);
  assert.deepEqual(P.validateState(await core.collectionState(wallets[0].address),renderer),{minted:0n,owned:0n,soldOut:false});
  for(const interfaceId of ['0x01ffc9a7','0x80ac58cd','0x5b5e139f','0x780e9d63'])assert.equal(await core.supportsInterface(interfaceId),true);
  assert.equal(await core.supportsInterface('0xffffffff'),false);
  assert(chain.artifact.runtimeBytes<=24576&&chain.artifact.initBytes<=49152&&chain.rendererArtifact.runtimeBytes<=24576);
  const names=chain.artifact.abi.filter(x=>x.type==='function').map(x=>x.name);for(const forbidden of ['owner','setFee','setRenderer','setTokenURI','mint','burn','pause','upgradeTo'])assert(!names.includes(forbidden));
});
test('each mint receives exactly one NFT and forwards exactly 0.00019 ETH',async()=>{
  const before=await chain.provider.getBalance(P.TREASURY),receipt=await(await mint()).wait();
  assert.equal(await core.totalSupply(),1n);assert.equal(await core.ownerOf(1),wallets[1].address);assert.equal(await core.balanceOf(wallets[1].address),1n);
  assert.equal(await core.mintByRequest(wallets[1].address,rid('a')),1n);
  assert.equal(await chain.provider.getBalance(P.TREASURY)-before,P.FEE);assert.equal(await core.claimableProtocolFees(),0n);
  const event=receipt.logs.map(l=>{try{return core.interface.parseLog(l);}catch(_){return null;}}).find(e=>e?.name==='Inscribed');
  assert.equal(event.args.payload,P.MINT);assert.equal(event.args.protocolFee,P.FEE);assert.equal(event.args.designCode,23040n);
});
test('zero, short or excessive payments and malformed inscriptions revert without minting',async()=>{
  for(const value of [0n,P.FEE-1n,P.FEE+1n])await assert.rejects(core.inscribe.staticCall(P.MINT,rid('pay'),{value}),/IncorrectPayment/);
  for(const payload of ['{}',P.MINT+' ',P.MINT.replace('RHO','rho'),P.GENESIS])await assert.rejects(core.inscribe.staticCall(payload,rid('bad'),{value:P.FEE}),/InvalidPayload/);
  await assert.rejects(core.inscribe.staticCall(P.MINT,toBeHex(0,32),{value:P.FEE}),/InvalidRequest/);assert.equal(await core.totalSupply(),0n);
});
test('a duplicate request cannot mint or pay twice, while another wallet may use its own request',async()=>{
  await(await mint()).wait();const before=await chain.provider.getBalance(P.TREASURY);
  await assert.rejects(core.connect(wallets[1]).inscribe.staticCall(P.MINT,rid('a'),{value:P.FEE}),/RequestAlreadyMinted/);
  assert.equal(await core.totalSupply(),1n);assert.equal(await chain.provider.getBalance(P.TREASURY),before);
  await(await mint(2)).wait();assert.equal(await core.totalSupply(),2n);
});
test('there is no wallet mint cap: one wallet can mint more than 20 times',async()=>{
  for(let i=0;i<21;i++)await(await mint(1,'unlimited-'+i)).wait();
  assert.equal(await core.totalSupply(),21n);assert.equal(await core.balanceOf(wallets[1].address),21n);
  await(await core.connect(wallets[1]).transferFrom(wallets[1].address,wallets[2].address,1)).wait();
  await(await mint(1,'unlimited-after-transfer')).wait();assert.equal(await core.totalSupply(),22n);
});
test('all 5,000 token IDs map injectively to fixed designs and match approved SVG samples',async()=>{
  const codes=new Set();for(let token=1;token<=5000;token++)codes.add(((token-1)*40503+23040)&65535);assert.equal(codes.size,5000);
  for(const token of [1,2,99,1000,4999,5000])assert.equal(await core.designCode(token),BigInt(((token-1)*40503+23040)&65535));
  await assert.rejects(core.designCode(0),/InvalidTokenId/);await assert.rejects(core.designCode(5001),/InvalidTokenId/);
  const codesForSamples=[0x5a00,0x9614,0x3c28,0xa53c];
  for(let i=0;i<4;i++)assert.equal(await chain.renderer.renderSVG(codesForSamples[i]),fs.readFileSync(path.join(__dirname,`../ordinal/art/robinhood-ordinal-${String(i+1).padStart(2,'0')}.svg`),'utf8'));
});
test('metadata contains the exact SVG and stays identical after approved ownership transfers',async()=>{
  await(await mint()).wait();const uri=await core.tokenURI(1),data=JSON.parse(Buffer.from(uri.split(',')[1],'base64').toString()),svg=Buffer.from(data.image.split(',')[1],'base64').toString();
  assert.equal(data.name,'Robinhood Ordinal #1');assert.equal(data.attributes.length,5);assert.equal(svg,await core.tokenSVG(1));assert.equal(svg,fs.readFileSync(path.join(__dirname,'../ordinal/art/robinhood-ordinal-01.svg'),'utf8'));
  await assert.rejects(core.connect(wallets[2]).transferFrom.staticCall(wallets[1].address,wallets[2].address,1));
  await(await core.connect(wallets[1]).approve(wallets[2].address,1)).wait();await(await core.connect(wallets[2]).transferFrom(wallets[1].address,wallets[3].address,1)).wait();
  assert.equal(await core.ownerOf(1),wallets[3].address);assert.equal(await core.tokenURI(1),uri);assert.equal(await core.getApproved(1),toBeHex(0,20));
  assert.deepEqual(Array.from((await core.ownedTokens(wallets[1].address,0,6))[0]),[]);assert.deepEqual(Array.from((await core.ownedTokens(wallets[3].address,0,6))[0]),[1n]);
  await assert.rejects(core.tokenURI(2));await assert.rejects(core.ownedTokens(wallets[3].address,0,25),/InvalidPage/);
});
test('two transactions competing for the last NFT cannot exceed 5,000',async()=>{
  const slot=chain.artifact.storageLayout.storage.find(x=>x.label==='_allTokens').slot;
  await chain.provider.send('anvil_setStorageAt',[await core.getAddress(),toBeHex(BigInt(slot)),toBeHex(4999n,32)]);
  await chain.provider.send('evm_setAutomine',[false]);
  try{const a=await mint(1,'last-a',{gasLimit:600000}),b=await mint(2,'last-b',{gasLimit:600000});await chain.provider.send('evm_mine',[]);const receipts=await Promise.all([chain.provider.getTransactionReceipt(a.hash),chain.provider.getTransactionReceipt(b.hash)]);assert.equal(receipts.filter(r=>r.status===1).length,1);assert.equal(receipts.filter(r=>r.status===0).length,1);assert.equal(await core.totalSupply(),5000n);await assert.rejects(core.inscribe.staticCall(P.MINT,rid('excess'),{value:P.FEE}),/SupplyExhausted/);}finally{await chain.provider.send('evm_setAutomine',[true]);}
});
test('a rejecting treasury cannot block minting and only the treasury can withdraw deferred fees',async()=>{
  await chain.provider.send('anvil_setCode',[P.TREASURY,'0x60006000fd']);await(await mint()).wait();assert.equal(await core.claimableProtocolFees(),P.FEE);assert.equal(await core.totalSupply(),1n);
  await assert.rejects(core.withdrawProtocolFees.staticCall(wallets[2].address),/OnlyTreasury/);
  await chain.provider.send('anvil_impersonateAccount',[P.TREASURY]);await chain.provider.send('anvil_setBalance',[P.TREASURY,toBeHex(10n**18n)]);
  try{const signer=await chain.provider.getSigner(P.TREASURY),before=await chain.provider.getBalance(wallets[2].address);await(await core.connect(signer).withdrawProtocolFees(wallets[2].address)).wait();assert.equal(await chain.provider.getBalance(wallets[2].address)-before,P.FEE);assert.equal(await core.claimableProtocolFees(),0n);}finally{await chain.provider.send('anvil_stopImpersonatingAccount',[P.TREASURY]);}
});
test('safe receiver rejection rolls back the fee; receiver reentrancy cannot mint another NFT',async()=>{
  const source=`pragma solidity 0.8.26; interface I{function inscribe(string calldata,bytes32) external payable returns(uint256);} contract Receiver {I public core;bool public reject;bool public reentered;constructor(address c,bool r){core=I(c);reject=r;}function run() external payable {core.inscribe{value:190000000000000}('${P.MINT}',keccak256('first'));}function onERC721Received(address,address,uint256,bytes calldata) external returns(bytes4){if(reject)revert();try core.inscribe{value:190000000000000}('${P.MINT}',keccak256('second')){reentered=true;}catch{}return 0x150b7a02;}}`;
  const result=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:{'Receiver.sol':{content:source}},settings:{evmVersion:'paris',outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}})));const a=result.contracts['Receiver.sol'].Receiver;
  for(const reject of [true,false]){const receiver=await new ContractFactory(a.abi,a.evm.bytecode.object,wallets[0]).deploy(await core.getAddress(),reject);await receiver.waitForDeployment();const before=await chain.provider.getBalance(P.TREASURY);if(reject){await assert.rejects(receiver.run({value:P.FEE*2n,gasLimit:800000}).then(tx=>tx.wait()));assert.equal(await core.totalSupply(),0n);assert.equal(await chain.provider.getBalance(P.TREASURY),before);}else{await(await receiver.run({value:P.FEE*2n})).wait();assert.equal(await core.totalSupply(),1n);assert.equal(await receiver.reentered(),false);}}
});
test('publication verifies creation transaction, renderer, genesis and permanent parameters',async()=>{
  const c=unpublishedConfig;const result=await verifyDeployment(chain.provider,c,{address:await core.getAddress(),hash:chain.receipt.hash});assert.equal(result.deploymentTxHash,chain.receipt.hash);assert.equal(result.rendererAddress,await core.renderer());
  await assert.rejects(verifyDeployment(chain.provider,{...c,contractAddress:wallets[5].address},{address:await core.getAddress(),hash:chain.receipt.hash}),/Refusing to replace/);
  await assert.rejects(verifyDeployment(chain.provider,c,{address:wallets[5].address,hash:chain.receipt.hash}),/Runtime bytecode/);
});
test('publication remains valid when a public mint follows deployment in the same block',async()=>{
  await chain.provider.send('evm_setAutomine',[false]);
  try{
    const fresh=await new ContractFactory(chain.artifact.abi,chain.artifact.bytecode,wallets[0]).deploy({gasLimit:10000000});
    const mintTx=await fresh.connect(wallets[1]).inscribe(P.MINT,rid('same-block'),{value:P.FEE,gasLimit:600000});
    await chain.provider.send('evm_mine',[]);
    const deployReceipt=await chain.provider.getTransactionReceipt(fresh.deploymentTransaction().hash),mintReceipt=await chain.provider.getTransactionReceipt(mintTx.hash);
    assert.equal(deployReceipt.status,1);assert.equal(mintReceipt.status,1);assert.equal(mintReceipt.blockNumber,deployReceipt.blockNumber);assert.equal(await fresh.totalSupply(),1n);
    const result=await verifyDeployment(chain.provider,unpublishedConfig,{address:await fresh.getAddress(),hash:deployReceipt.hash});assert.equal(result.deploymentBlock,deployReceipt.blockNumber);
  }finally{await chain.provider.send('evm_setAutomine',[true]);}
});
test('pinned genesis verification survives pruning without weakening first publication or its pins',async()=>{
  const address=await core.getAddress(),hash=chain.receipt.hash;
  const pinned=await verifyDeployment(chain.provider,unpublishedConfig,{address,hash});
  const provider=new Proxy(chain.provider,{get(target,key){
    if(key==='getCode')return async(address,block)=>{if(block!==undefined&&block!=='latest')throw new Error('historical state unavailable');return target.getCode(address,block);};
    if(key==='call')return async(tx)=>{if(tx.blockTag!==undefined&&tx.blockTag!=='latest')throw new Error('historical state unavailable');return target.call(tx);};
    const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
  }});
  assert.equal((await verifyDeployment(provider,pinned,{address})).deploymentTxHash,hash);
  await assert.rejects(verifyDeployment(provider,unpublishedConfig,{address,hash}),/historical state unavailable/);
  await assert.rejects(verifyDeployment(provider,pinned,{address,hash:toBeHex(1,32)}),/Pinned deployment transaction mismatch/);
  for(const change of [{deploymentBlock:pinned.deploymentBlock+1},{rendererAddress:wallets[5].address}])await assert.rejects(verifyDeployment(provider,{...pinned,...change},{address}),/Pinned deployment block or renderer mismatch/);
  await chain.provider.send('anvil_setCode',[pinned.rendererAddress,'0x60006000fd']);
  await assert.rejects(verifyDeployment(provider,pinned,{address}),/Genesis state or renderer mismatch/);
});
test('paid recovery binds the exact amount, wallet, nonce, contract and calldata',()=>{
  const r={kind:'mint',account:wallets[1].address,contract:wallets[2].address,data:'0x12345678',value:P.FEE.toString(),nonce:4};
  const tx={from:r.account,to:r.contract,data:r.data,value:P.FEE,nonce:4,chainId:4663n};assert(P.matchesTransaction(tx,r));
  for(const change of [{from:wallets[0].address},{to:wallets[0].address},{value:0n},{value:P.FEE+1n},{nonce:5},{data:'0x'},{chainId:1n}])assert.equal(P.matchesTransaction({...tx,...change},r),false);
});
test('the public endpoint never sends transactions or accepts an arbitrary contract',()=>{
  const request=(method,params)=>({jsonrpc:'2.0',id:1,method,params});assert(api.allowed(request('eth_chainId',[])));assert(!api.allowed(request('eth_sendRawTransaction',['0x1234'])));assert(!api.allowed(request('eth_sendTransaction',[{}])));assert(!api.allowed(request('eth_call',[{to:wallets[0].address,data:'0x12345678'},'latest'])));
});
