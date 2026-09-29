'use strict';
// Read-only chain verification. This script never signs or broadcasts transactions.
const fs = require('node:fs');
const path = require('node:path');
const { JsonRpcProvider, Contract, keccak256 } = require('ethers');
const P = require('../rh20/protocol.js');
const artifact = require('../rh20/RH20.json');
const target = path.resolve(__dirname, '../rh20/mainnet.json');
async function main() {
  const hash = process.argv[process.argv.indexOf('--tx') + 1];
  if (!process.argv.includes('--tx') || !/^0x[0-9a-fA-F]{64}$/.test(hash || '')) throw new Error('Usage: node scripts/publish-rh20.cjs --tx <confirmed deployment transaction hash>');
  const config = P.validateConfig(JSON.parse(fs.readFileSync(target, 'utf8')));
  const provider = new JsonRpcProvider(process.env.RH20_RPC_URL || config.rpcUrl);
  try {
    if ((await provider.getNetwork()).chainId !== 4663n) throw new Error('Expected Robinhood Chain mainnet (4663).');
    const [tx, receipt] = await Promise.all([provider.getTransaction(hash), provider.getTransactionReceipt(hash)]);
    if (!tx || !receipt || receipt.status !== 1 || !receipt.contractAddress) throw new Error('Deployment has not been successfully confirmed.');
    if (tx.to !== null || tx.data.toLowerCase() !== artifact.bytecode.toLowerCase() || tx.value !== 0n) throw new Error('Transaction is not this exact RH-20 deployment.');
    const address = receipt.contractAddress;
    if (config.contractAddress && !P.sameAddress(config.contractAddress, address)) throw new Error('Refusing to replace the established official contract.');
    if (keccak256(await provider.getCode(address)) !== artifact.runtimeCodeHash) throw new Error('Runtime bytecode does not match the reviewed artifact.');
    const core = new Contract(address, artifact.abi, provider);
    P.validateToken(await core.getToken('RHSC'));
    if (!P.sameAddress(await core.genesisDeployer(), tx.from) || await core.genesisBlock() !== BigInt(receipt.blockNumber)) throw new Error('Genesis receipt mismatch.');
    const next = { ...config, contractAddress: address, deploymentTxHash: hash, deploymentBlock: receipt.blockNumber };
    fs.writeFileSync(target, JSON.stringify(next, null, 2) + '\n');
    console.log(JSON.stringify(next, null, 2));
  } finally { provider.destroy(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
