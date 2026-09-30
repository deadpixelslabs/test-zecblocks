'use strict';
// Read-only check of a token registration in the existing RH-20 core.
const { JsonRpcProvider, Contract, FetchRequest, keccak256, id } = require('ethers');
const P = require('../rh20/protocol.js').forToken('VLAD');
const artifact = require('../rh20/RH20.json');
const config = require('../rh20/vlad.json');
async function verifyRegistration(provider, settings, { hash } = {}) {
  P.validateConfig(settings);
  if ((await provider.getNetwork()).chainId !== 4663n) throw new Error('Expected Robinhood Chain (4663).');
  const blockTag = Number(BigInt(await provider.send('eth_blockNumber', [])));
  if (keccak256(await provider.getCode(settings.contractAddress, blockTag)) !== artifact.runtimeCodeHash) throw new Error('Runtime bytecode does not match the official RH-20 core.');
  const core = new Contract(settings.contractAddress, artifact.abi, provider);
  let token;
  try { token = await core.getToken('VLAD', { blockTag }); }
  catch (error) {
    if (!hash && String(error.data || '').toLowerCase() === id('UnknownToken()').slice(0,10)) return { ticker:'VLAD', state:'awaiting-registration', contractAddress:settings.contractAddress };
    throw error;
  }
  const supply = P.validateToken(token);
  const result = { ticker:'VLAD', state: supply === 100000000n ? 'mint-complete' : 'mint-open', contractAddress:settings.contractAddress, maxSupply:'100000000', mintAmount:'40', maxMintsPerWallet:0, totalSupply:String(supply) };
  if (!hash) return result;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error('Invalid registration transaction hash.');
  const [tx,receipt] = await Promise.all([provider.getTransaction(hash),provider.getTransactionReceipt(hash)]);
  if (!tx || !receipt || receipt.status !== 1) throw new Error('Registration has not been successfully confirmed.');
  const expected = {kind:'register',account:token.deployer,contract:settings.contractAddress,data:core.interface.encodeFunctionData('inscribe',[P.DEPLOY])};
  if (!P.matchesTransaction(tx,expected) || tx.chainId !== 4663n) throw new Error('Transaction is not the exact VLAD registration.');
  const block = await provider.getBlock(receipt.blockNumber);
  if (!block || block.hash !== receipt.blockHash || tx.blockHash !== receipt.blockHash) throw new Error('Registration receipt is not canonical.');
  const events = receipt.logs.filter(log=>P.sameAddress(log.address,settings.contractAddress)).map(log=>{try{return core.interface.parseLog(log);}catch(_){return null;}});
  const deployed = events.find(e=>e?.name==='TokenDeployed'), inscription = events.find(e=>e?.name==='Inscription');
  if (!deployed || deployed.args.tokenId !== id('VLAD') || deployed.args.tick !== 'VLAD' || deployed.args.maxSupply !== 100000000n || deployed.args.mintAmount !== 40n || deployed.args.maxMintsPerWallet !== 0n || !P.sameAddress(deployed.args.deployer,tx.from) || !inscription || inscription.args.payload !== P.DEPLOY || inscription.args.tokenId !== id('VLAD') || !P.sameAddress(inscription.args.sender,tx.from)) throw new Error('Registration events do not match VLAD.');
  return {...result,registrationTxHash:hash,registrationBlock:receipt.blockNumber};
}
async function main() {
  const argument = name=>process.argv.includes(name)?process.argv[process.argv.indexOf(name)+1]:undefined;
  const connection = new FetchRequest(process.env.RH20_RPC_URL || config.rpcUrl);connection.timeout=15000;
  const provider = new JsonRpcProvider(connection,undefined,{batchMaxCount:1,cacheTimeout:-1});
  try { console.log(JSON.stringify(await verifyRegistration(provider,config,{hash:argument('--tx')}),null,2)); }
  finally { provider.destroy(); }
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={verifyRegistration};
