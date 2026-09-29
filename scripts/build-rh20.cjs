'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const solc = require('solc');
const { keccak256 } = require('ethers');
const root = path.resolve(__dirname, '..');
if (!solc.version().startsWith('0.8.26+')) throw new Error('Use the pinned compiler solc 0.8.26.');
const source = fs.readFileSync(path.join(root, 'contracts/RH20.sol'), 'utf8');
const input = {
  language: 'Solidity', sources: { 'RH20.sol': { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 200 }, evmVersion: 'paris',
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } }
  }
};
const output = JSON.parse(solc.compile(JSON.stringify(input)));
for (const item of output.errors || []) console.error(item.formattedMessage);
if ((output.errors || []).some(item => item.severity === 'error')) process.exit(1);
const contract = output.contracts['RH20.sol'].RH20;
const artifact = {
  contractName: 'RH20', compiler: solc.version(), chainId: 4663,
  settings: input.settings, sourceSha256: crypto.createHash('sha256').update(source).digest('hex'),
  abi: contract.abi, bytecode: '0x' + contract.evm.bytecode.object,
  deployedBytecode: '0x' + contract.evm.deployedBytecode.object,
  runtimeCodeHash: keccak256('0x' + contract.evm.deployedBytecode.object)
};
const encoded = JSON.stringify(artifact, null, 2) + '\n';
const target = path.join(root, 'rh20/RH20.json');
if (process.argv.includes('--check')) {
  if (fs.readFileSync(target, 'utf8') !== encoded) throw new Error('Contract artifact differs from the reproducible build.');
} else {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, encoded);
  fs.writeFileSync(path.join(root, 'rh20/compiler-input.json'), JSON.stringify(input, null, 2) + '\n');
}
console.log(JSON.stringify({ compiler: artifact.compiler, runtimeBytes: contract.evm.deployedBytecode.object.length / 2, runtimeCodeHash: artifact.runtimeCodeHash, checked: process.argv.includes('--check') }));
