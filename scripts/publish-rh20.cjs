'use strict';
// Read-only chain verification. This script never signs or broadcasts transactions.
const fs = require('node:fs');
const path = require('node:path');
const { JsonRpcProvider, Contract, FetchRequest, getAddress, keccak256 } = require('ethers');
const P = require('../rh20/protocol.js');
const artifact = require('../rh20/RH20.json');
const target = path.resolve(__dirname, '../rh20/mainnet.json');
async function verifyDeployment(provider, config, { hash, address } = {}) {
  if ((await provider.getNetwork()).chainId !== 4663n) throw new Error('Expected Robinhood Chain mainnet (4663).');
  const blockTag = Number(BigInt(await provider.send('eth_blockNumber', [])));
  if (address) {
    address = getAddress(address);
    if (!hash && P.sameAddress(config.contractAddress, address)) hash = config.deploymentTxHash;
    if (keccak256(await provider.getCode(address, blockTag)) !== artifact.runtimeCodeHash) throw new Error('Runtime bytecode does not match the reviewed artifact.');
    const core = new Contract(address, artifact.abi, provider);
    P.validateToken(await core.getToken('RHSC', { blockTag }));
    if (!hash) {
      // On Arbitrum, Solidity block.number is an ancestor-chain number. Locate
      // genesis from its event's RPC block instead of using that storage value.
      const topics = [core.interface.getEvent('Genesis').topicHash];
      for (let to = blockTag, windows = 0; to >= 0 && windows < 64 && !hash; ++windows) {
        const from = Math.max(0, to - 999);
        const logs = await provider.getLogs({ address, topics, fromBlock: from, toBlock: to });
        if (logs.length > 1) throw new Error('Ambiguous genesis events.');
        if (logs.length === 1) hash = logs[0].transactionHash;
        to = from - 1;
      }
      if (!hash) throw new Error('Genesis is outside the recent discovery range. Supply its deployment hash with --tx.');
    }
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash || '')) throw new Error('A deployment address or transaction hash is required.');
  const [tx, receipt] = await Promise.all([provider.getTransaction(hash), provider.getTransactionReceipt(hash)]);
  if (!tx || !receipt || receipt.status !== 1 || !receipt.contractAddress) throw new Error('Deployment has not been successfully confirmed.');
  if (tx.to !== null || tx.data.toLowerCase() !== artifact.bytecode.toLowerCase() || tx.value !== 0n) throw new Error('Transaction is not this exact RH-20 deployment.');
  if (address && !P.sameAddress(receipt.contractAddress, address)) throw new Error('Deployment receipt belongs to a different address.');
  address = receipt.contractAddress;
  if (config.contractAddress && !P.sameAddress(config.contractAddress, address)) throw new Error('Refusing to replace the established official contract.');
  if (keccak256(await provider.getCode(address, blockTag)) !== artifact.runtimeCodeHash) throw new Error('Runtime bytecode does not match the reviewed artifact.');
  const core = new Contract(address, artifact.abi, provider);
  P.validateToken(await core.getToken('RHSC', { blockTag }));
  const rawReceipt = await provider.send('eth_getTransactionReceipt', [hash]);
  const genesisBlock = await core.genesisBlock({ blockTag });
  const evmBlock = BigInt(rawReceipt.l1BlockNumber ?? rawReceipt.blockNumber);
  const genesis = receipt.logs.filter(log => P.sameAddress(log.address, address)).map(log => { try { return core.interface.parseLog(log); } catch (_) { return null; } }).find(log => log?.name === 'Genesis');
  if (!P.sameAddress(await core.genesisDeployer({ blockTag }), tx.from) || genesisBlock !== evmBlock || !genesis || !P.sameAddress(genesis.args.deployer, tx.from) || genesis.args.chainId !== 4663n || genesis.args.rhscId !== keccak256(Buffer.from('RHSC'))) throw new Error('Genesis receipt mismatch.');
  return { ...config, contractAddress: address, deploymentTxHash: hash, deploymentBlock: receipt.blockNumber };
}
async function main() {
  const argument = name => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined;
  const hash = argument('--tx'), address = argument('--address');
  if (!hash && !address) throw new Error('Usage: node scripts/publish-rh20.cjs --address <contract> [--check] or --tx <deployment hash> [--check]');
  const config = P.validateConfig(JSON.parse(fs.readFileSync(target, 'utf8')));
  const connection = new FetchRequest(process.env.RH20_RPC_URL || config.rpcUrl); connection.timeout = 15000;
  const provider = new JsonRpcProvider(connection, undefined, { batchMaxCount: 1, cacheTimeout: -1 });
  try {
    const next = await verifyDeployment(provider, config, { hash, address });
    if (!process.argv.includes('--check')) fs.writeFileSync(target, JSON.stringify(next, null, 2) + '\n');
    console.log(JSON.stringify(next, null, 2));
  } finally { provider.destroy(); }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { verifyDeployment };
