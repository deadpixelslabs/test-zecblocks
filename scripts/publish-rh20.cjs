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
    if (keccak256(await provider.getCode(address, blockTag)) !== artifact.runtimeCodeHash) throw new Error('Runtime bytecode does not match the reviewed artifact.');
    const core = new Contract(address, artifact.abi, provider);
    const genesisBlock = Number(await core.genesisBlock({ blockTag }));
    const deployer = await core.genesisDeployer({ blockTag });
    P.validateToken(await core.getToken('RHSC', { blockTag }));
    if (!Number.isSafeInteger(genesisBlock) || genesisBlock < 1 || genesisBlock > blockTag) throw new Error('Invalid genesis block.');
    if (!hash) {
      const block = await provider.send('eth_getBlockByNumber', ['0x' + genesisBlock.toString(16), true]);
      if (!block || !Array.isArray(block.transactions)) throw new Error('Genesis block is unavailable.');
      const candidates = block.transactions.filter(tx => tx.to === null && P.sameAddress(tx.from, deployer) && String(tx.input || tx.data).toLowerCase() === artifact.bytecode.toLowerCase());
      for (const candidate of candidates) {
        const receipt = await provider.getTransactionReceipt(candidate.hash);
        if (receipt?.status === 1 && P.sameAddress(receipt.contractAddress, address)) {
          if (hash) throw new Error('Ambiguous deployment receipts.');
          hash = candidate.hash;
        }
      }
      if (!hash) throw new Error('No exact creation transaction found in the genesis block.');
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
  if (!P.sameAddress(await core.genesisDeployer({ blockTag }), tx.from) || await core.genesisBlock({ blockTag }) !== BigInt(receipt.blockNumber)) throw new Error('Genesis receipt mismatch.');
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
