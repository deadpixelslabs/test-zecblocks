'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { keccak256, id } = require('ethers');
const { startChain } = require('./helpers/rh20-chain.cjs');
const P = require('../rh20/protocol.js');
const api = require('../api/rh20.js');
const { verifyDeployment } = require('../scripts/publish-rh20.cjs');
let chain, core, wallets;
before(async () => { chain = await startChain(); core = chain.core; wallets = chain.signers; });
after(async () => { if (chain) await chain.close(); });
const deploy = (tick, max, lim) => JSON.stringify({ p: 'rh-20', op: 'deploy', tick, max: String(max), lim: String(lim) });
const mint = (tick, amt) => JSON.stringify({ p: 'rh-20', op: 'mint', tick, amt: String(amt) });

test('genesis registers RHSC with immutable 21M / 500 / 20 rules and zero premine', async () => {
  const token = await core.getToken('RHSC');
  assert.equal(P.validateToken(token), 0n);
  assert.equal(await core.balanceOf('RHSC', wallets[0].address), 0n);
  assert.equal(await core.genesisBlock(), BigInt(chain.receipt.blockNumber));
  assert.equal(await core.genesisDeployer(), wallets[0].address);
  assert.equal(keccak256(await chain.provider.getCode(await core.getAddress())), chain.artifact.runtimeCodeHash);
  const inscriptions = chain.receipt.logs.map(log => { try { return core.interface.parseLog(log); } catch (_) { return null; } }).filter(event => event?.name === 'Inscription');
  assert.equal(inscriptions.length, 1); assert.equal(inscriptions[0].args.payload, P.DEPLOY);
});

test('publishing resolves the exact genesis receipt from an address and refuses another official core', async () => {
  const config = { ...require('../rh20/mainnet.json'), contractAddress: null, deploymentTxHash: null, deploymentBlock: null };
  const address = await core.getAddress();
  const result = await verifyDeployment(chain.provider, config, { address });
  assert.equal(result.contractAddress, address);
  assert.equal(result.deploymentTxHash, chain.receipt.hash);
  assert.equal(result.deploymentBlock, chain.receipt.blockNumber);
  assert.equal(config.contractAddress, null);
  await assert.rejects(verifyDeployment(chain.provider, config, { address: wallets[7].address }), /Runtime bytecode/);
  await assert.rejects(verifyDeployment(chain.provider, { ...config, contractAddress: wallets[7].address }, { address }), /Refusing to replace/);
});

test('genesis verification distinguishes Arbitrum ancestor block numbers from RPC receipt blocks', async () => {
  const snapshot = await chain.provider.send('evm_snapshot', []);
  const address = await core.getAddress();
  try {
    await chain.provider.send('anvil_setStorageAt', [address, '0x1', '0x' + (31337n).toString(16).padStart(64, '0')]);
    const rpc = new Proxy(chain.provider, { get(target, key) {
      if (key === 'send') return async (method, params) => { const result = await target.send(method, params); return method === 'eth_getTransactionReceipt' ? { ...result, l1BlockNumber: '0x7a69' } : result; };
      const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
    } });
    const config = { ...require('../rh20/mainnet.json'), contractAddress: null, deploymentTxHash: null, deploymentBlock: null };
    const result = await verifyDeployment(rpc, config, { address });
    assert.equal(result.deploymentBlock, chain.receipt.blockNumber);
    assert.equal(result.deploymentTxHash, chain.receipt.hash);
    await assert.rejects(verifyDeployment(chain.provider, config, { address }), /Genesis receipt mismatch/);
  } finally { await chain.provider.send('evm_revert', [snapshot]); }
});

test('canonical mint credits exactly 500 and emits the same inscription', async () => {
  const receipt = await (await core.connect(wallets[1]).inscribe(P.MINT)).wait();
  assert.equal(await core.balanceOf('RHSC', wallets[1].address), 500n);
  assert.equal(await core.mintCount('RHSC', wallets[1].address), 1n);
  const events = receipt.logs.map(log => core.interface.parseLog(log));
  assert.equal(events.find(event => event.name === 'Inscription').args.payload, P.MINT);
  assert.equal(events.find(event => event.name === 'Mint').args.amount, 500n);
  assert.equal(events.find(event => event.name === 'Mint').args.tokenId, id('RHSC'));
});

test('malformed, ambiguous and noncanonical payloads cannot change supply', async () => {
  const invalid = [P.MINT + ' ', P.MINT.replace('500', '0500'), P.MINT.replace('500', '0'), P.MINT.replace('500', '-500'), P.MINT.replace('500', '500.0'), P.MINT.replace('500', '5e2'), P.MINT.replace('500', '499'), P.MINT.replace('500', '501'), P.MINT.replace('rh-20', 'zb-20'), P.MINT.replace('RHSC', 'rhsc'), P.MINT.replace('"500"', '500'), P.MINT.replace('}', ',"amt":"500"}'), P.MINT.replace('}', ',"from":"attacker"}'), P.MINT.slice(0, -1), '{}', '[]', P.MINT.replace('"mint"', '"transfer"'), P.MINT.replace('500', '9'.repeat(90))];
  const before = (await core.getToken('RHSC')).totalSupply;
  for (const payload of invalid) await assert.rejects(core.inscribe.staticCall(payload), undefined, payload);
  assert.equal((await core.getToken('RHSC')).totalSupply, before);
});

test('minting cannot accept ETH or replace the registered RHSC ticker', async () => {
  await assert.rejects(core.inscribe.staticCall(P.MINT, { value: 1n }));
  await assert.rejects(core.inscribe.staticCall(P.DEPLOY), /TokenAlreadyExists/);
  await assert.rejects(core.inscribe.staticCall(deploy('RHSC', 1000, 500)), /TokenAlreadyExists/);
  assert.equal(await chain.provider.getBalance(await core.getAddress()), 0n);
});

test('a wallet can mint 20 times, and its 21st submitted transaction reverts', async () => {
  for (let i = 1; i < 20; ++i) await (await core.connect(wallets[1]).inscribe(P.MINT)).wait();
  assert.equal(await core.mintCount('RHSC', wallets[1].address), 20n);
  assert.equal(await core.balanceOf('RHSC', wallets[1].address), 10000n);
  await assert.rejects(core.connect(wallets[1]).inscribe.staticCall(P.MINT), /WalletMintLimitReached/);
  await assert.rejects(async () => { const tx = await core.connect(wallets[1]).inscribe(P.MINT, { gasLimit: 500000 }); await tx.wait(); }, /revert/);
  assert.equal(await core.mintCount('RHSC', wallets[1].address), 20n);
});

test('transfers do not reset lifetime mint limits or consume the receiver mint allowance', async () => {
  await (await core.connect(wallets[1]).transfer('RHSC', wallets[2].address, 10000)).wait();
  assert.equal(await core.balanceOf('RHSC', wallets[1].address), 0n);
  assert.equal(await core.mintCount('RHSC', wallets[1].address), 20n);
  await assert.rejects(core.connect(wallets[1]).inscribe.staticCall(P.MINT), /WalletMintLimitReached/);
  await (await core.connect(wallets[2]).inscribe(P.MINT)).wait();
  assert.equal(await core.balanceOf('RHSC', wallets[2].address), 10500n);
  assert.equal(await core.mintCount('RHSC', wallets[2].address), 1n);
});

test('a spender needs an explicit allowance and cannot exceed it', async () => {
  await assert.rejects(core.connect(wallets[3]).transferFrom.staticCall('RHSC', wallets[2].address, wallets[3].address, 500), /InsufficientAllowance/);
  await (await core.connect(wallets[2]).approve('RHSC', wallets[3].address, 500)).wait();
  await (await core.connect(wallets[3]).transferFrom('RHSC', wallets[2].address, wallets[3].address, 500)).wait();
  assert.equal(await core.allowance('RHSC', wallets[2].address, wallets[3].address), 0n);
  await assert.rejects(core.connect(wallets[3]).transferFrom.staticCall('RHSC', wallets[2].address, wallets[3].address, 1), /InsufficientAllowance/);
  assert.equal(await core.mintCount('RHSC', wallets[2].address), 1n);
  await assert.rejects(core.transfer.staticCall('RHSC', wallets[3].address, 1), /InsufficientBalance/);
});

test('the shared supply guard resolves two transactions competing for the last mint', async () => {
  await (await core.inscribe(deploy('CAP', 1000, 500))).wait();
  await (await core.inscribe(mint('CAP', 500))).wait();
  await chain.provider.send('evm_setAutomine', [false]);
  try {
    const a = await core.connect(wallets[4]).inscribe(mint('CAP', 500), { gasLimit: 500000 });
    const b = await core.connect(wallets[5]).inscribe(mint('CAP', 500), { gasLimit: 500000 });
    await chain.provider.send('evm_mine', []);
    const results = await Promise.all([chain.provider.getTransactionReceipt(a.hash), chain.provider.getTransactionReceipt(b.hash)]);
    assert.equal(results.filter(receipt => receipt.status === 1).length, 1);
    assert.equal(results.filter(receipt => receipt.status === 0).length, 1);
    assert.equal((await core.getToken('CAP')).totalSupply, 1000n);
    await assert.rejects(core.inscribe.staticCall(mint('CAP', 500)), /SupplyExhausted/);
  } finally { await chain.provider.send('evm_setAutomine', [true]); }
});

test('other tickers cannot affect RHSC balances, supply or mint limits', async () => {
  const before = await core.getToken('RHSC');
  await assert.rejects(core.inscribe.staticCall(deploy('BAD', 1001, 500)), /InvalidAmount/);
  await assert.rejects(core.inscribe.staticCall(deploy('$BAD', 1000, 500)), /InvalidTicker/);
  await assert.rejects(core.inscribe.staticCall(mint('MISSING', 500)), /UnknownToken/);
  assert.equal((await core.getToken('RHSC')).totalSupply, before.totalSupply);
  assert.equal((await core.getToken('RHSC')).maxMintsPerWallet, 20n);
});

test('recovery binds the exact wallet, chain, operation, destination, value and nonce', () => {
  const expected = { kind: 'mint', account: wallets[1].address, contract: '0x' + '12'.repeat(20), data: '0x12345678', nonce: 4 };
  const tx = { from: expected.account, to: expected.contract, data: expected.data, nonce: 4, chainId: 4663n, value: 0n };
  assert.equal(P.matchesTransaction(tx, expected), true);
  for (const changed of [{ from: wallets[2].address }, { to: wallets[3].address }, { value: 1n }, { chainId: 1n }, { nonce: 3 }, { data: '0x' }]) assert.equal(P.matchesTransaction({ ...tx, ...changed }, expected), false);
});

test('the public RPC route rejects transaction submission and unpinned contract calls', () => {
  const request = (method, params) => ({ jsonrpc: '2.0', id: 1, method, params });
  assert.equal(api.allowed(request('eth_chainId', [])), true);
  assert.equal(api.allowed(request('eth_sendTransaction', [{}])), false);
  assert.equal(api.allowed(request('eth_sendRawTransaction', ['0x1234'])), false);
  assert.equal(api.allowed(request('eth_call', [{ to: wallets[0].address, data: '0x12345678' }, 'latest'])), false);
  assert.equal(api.allowed([request('eth_chainId', [])]), false);
});
