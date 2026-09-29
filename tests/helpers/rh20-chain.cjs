'use strict';
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const fs = require('node:fs');
const { JsonRpcProvider, ContractFactory } = require('ethers');
const artifact = require('../../rh20/RH20.json');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function freePort() {
  const server = net.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
async function startChain() {
  const port = await freePort();
  const local = path.resolve(__dirname, '../../node_modules/.bin/anvil');
  const binary = process.env.RH20_ANVIL || (fs.existsSync(local) ? local : 'anvil');
  const processHandle = spawn(binary, ['--host', '127.0.0.1', '--port', String(port), '--chain-id', '4663', '--silent', '--gas-limit', '30000000'], { stdio: ['ignore', 'ignore', 'pipe'] });
  let failure = null; processHandle.on('error', error => { failure = error; });
  const url = 'http://127.0.0.1:' + port;
  for (let i = 0; i < 100; ++i) {
    if (failure) throw failure;
    try { const response = await fetch(url, { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }), headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(300) }); if ((await response.json()).result === '0x1237') break; } catch (_) {}
    if (i === 99) { processHandle.kill(); throw new Error('Isolated EVM did not start.'); }
    await delay(50);
  }
  const provider = new JsonRpcProvider(url, 4663, { staticNetwork: true, cacheTimeout: -1 }); provider.pollingInterval = 25;
  const signers = await provider.listAccounts();
  const core = await new ContractFactory(artifact.abi, artifact.bytecode, signers[0]).deploy();
  const receipt = await core.deploymentTransaction().wait();
  return { url, provider, signers, core, receipt, artifact, close: async () => { provider.destroy(); processHandle.kill(); await new Promise(resolve => { if (processHandle.exitCode !== null) resolve(); else { processHandle.once('exit', resolve); setTimeout(resolve, 1500).unref(); } }); } };
}
module.exports = { startChain };
