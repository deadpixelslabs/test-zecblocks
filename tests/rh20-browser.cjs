'use strict';
const { test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { startChain } = require('./helpers/rh20-chain.cjs');
const { serve } = require('./helpers/rh20-server.cjs');
const P = require('../rh20/protocol.js');
let chain, server, browser, snapshot;
const artifacts = path.resolve(__dirname, '../test-artifacts');
before(async () => { fs.mkdirSync(artifacts, { recursive: true }); chain = await startChain(); server = await serve(chain); browser = await chromium.launch({ headless: true }); });
beforeEach(async () => { snapshot = await chain.provider.send('evm_snapshot', []); server.setPublished(true); server.setAddress(null); });
afterEach(async () => { await chain.provider.send('evm_revert', [snapshot]); });
after(async () => { if (browser) await browser.close(); if (server) await server.close(); if (chain) await chain.close(); });
async function pageFixture({ route = '/rhsc.html', wallet = 1, mobile = false } = {}) {
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1050 } });
  await context.addInitScript(({ account }) => {
    let currentAccount = account;
    const listeners = {};
    window.__sendCount = 0;
    window.__walletMode = 'normal';
    window.__setWalletAccount = value => { currentAccount = value; for (const fn of listeners.accountsChanged || []) fn([value]); };
    window.ethereum = {
      isMetaMask: true,
      on: (name, fn) => { (listeners[name] ||= []).push(fn); },
      removeListener: (name, fn) => { listeners[name] = (listeners[name] || []).filter(item => item !== fn); },
      request: async ({ method, params = [] }) => {
        if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [currentAccount];
        if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') return null;
        if (method === 'eth_sendTransaction') {
          window.__sendCount++;
          if (window.__walletMode === 'reject') throw Object.assign(new Error('User rejected the request'), { code: 4001 });
        }
        const response = await fetch('/_fixture/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 101, method, params }) });
        const json = await response.json();
        if (json.error) throw Object.assign(new Error(json.error.message), { code: json.error.code, data: json.error.data });
        if (method === 'eth_sendTransaction') {
          window.__lastHash = json.result;
          if (window.__walletMode === 'unresolved') throw Object.assign(new Error('Wallet connection lost after broadcast'), { code: -32000 });
        }
        return json.result;
      }
    };
  }, { account: chain.signers[wallet].address });
  const page = await context.newPage(); page.setDefaultTimeout(12000); const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(server.url + route);
  await page.waitForFunction(() => !document.querySelector('#status').textContent.startsWith('Loading'));
  return { page, context, errors };
}

test('unpublished deployment shows honest status and cannot mint', async () => {
  server.setPublished(false);
  const { page, context, errors } = await pageFixture();
  try {
    assert.match(await page.locator('#status').innerText(), /not been published/);
    assert.equal(await page.locator('#mintButton').isDisabled(), true);
    assert.equal(await page.evaluate(() => window.__sendCount), 0);
    await page.screenshot({ path: path.join(artifacts, 'rhsc-before-deployment.png'), fullPage: true });
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('browser wallet mint reaches the real contract and renders confirmed balances', async () => {
  const { page, context, errors } = await pageFixture();
  try {
    await page.locator('#connectButton').click();
    await page.waitForFunction(() => document.querySelector('#mintButton').textContent === 'Mint 500 RHSC');
    await page.locator('#mintButton').click();
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('Mint confirmed'), { timeout: 15000 });
    assert.equal(await page.locator('#balance').innerText(), '500');
    assert.equal(await page.locator('#walletMints').innerText(), '1 / 20');
    assert.equal(await chain.core.mintCount('RHSC', chain.signers[1].address), 1n);
    assert.equal(await page.evaluate(() => window.__sendCount), 1);
    await page.screenshot({ path: path.join(artifacts, 'rhsc-mint-confirmed.png'), fullPage: true });
    await page.evaluate(address => window.__setWalletAccount(address), chain.signers[2].address);
    await page.waitForFunction(() => document.querySelector('#walletMints').textContent === '0 / 20');
    assert.equal(await page.locator('#balance').innerText(), '0');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('an unresolved broadcast survives reload and recovers the original mint without resending', async () => {
  const { page, context, errors } = await pageFixture();
  try {
    await page.locator('#connectButton').click();
    await page.waitForFunction(() => document.querySelector('#mintButton').textContent === 'Mint 500 RHSC');
    await page.evaluate(() => { window.__walletMode = 'unresolved'; });
    await page.locator('#mintButton').click();
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('unresolved'));
    const hash = await page.evaluate(() => window.__lastHash);
    assert.equal(await page.locator('#mintButton').isDisabled(), true);
    assert.equal(await chain.core.mintCount('RHSC', chain.signers[1].address), 1n);
    await page.reload(); await page.locator('#connectButton').click();
    await page.locator('#recovery').waitFor({ state: 'visible' });
    await page.locator('#transactionHash').fill(hash); await page.locator('#recoverHash').click();
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('Mint confirmed'));
    assert.equal(await page.evaluate(() => window.__sendCount), 0);
    assert.equal(await chain.core.mintCount('RHSC', chain.signers[1].address), 1n);
    assert.equal(await page.locator('#walletMints').innerText(), '1 / 20');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('wallet rejection does not leave a false pending mint', async () => {
  const { page, context } = await pageFixture();
  try {
    await page.locator('#connectButton').click();
    await page.waitForFunction(() => document.querySelector('#mintButton').textContent === 'Mint 500 RHSC');
    await page.evaluate(() => { window.__walletMode = 'reject'; });
    await page.locator('#mintButton').click();
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('cancelled'));
    assert.equal(await page.locator('#recovery').isVisible(), false);
    assert.equal(await page.locator('#mintButton').isDisabled(), false);
    assert.equal(await chain.core.mintCount('RHSC', chain.signers[1].address), 0n);
  } finally { await context.close(); }
});

test('the wallet cap is shown before opening another wallet transaction', async () => {
  for (let i = 0; i < 20; ++i) await (await chain.core.connect(chain.signers[1]).inscribe(P.MINT)).wait();
  const { page, context } = await pageFixture();
  try {
    await page.locator('#connectButton').click();
    await page.waitForFunction(() => document.querySelector('#walletMints').textContent === '20 / 20');
    assert.equal(await page.locator('#mintButton').isDisabled(), true);
    assert.equal(await page.locator('#balance').innerText(), '10,000');
    assert.equal(await page.evaluate(() => window.__sendCount), 0);
  } finally { await context.close(); }
});

test('an incorrect deployed bytecode disables the mint button', async () => {
  server.setAddress(chain.signers[5].address);
  const { page, context } = await pageFixture();
  try {
    assert.match(await page.locator('#status').innerText(), /verification failed/);
    assert.equal(await page.locator('#mintButton').isDisabled(), true);
    assert.equal(await page.evaluate(() => window.__sendCount), 0);
  } finally { await context.close(); }
});

test('deployment page creates RH20 and RHSC in one transaction and preserves its receipt', async () => {
  server.setPublished(false);
  const { page, context, errors } = await pageFixture({ route: '/rhsc-deploy.html', wallet: 0 });
  try {
    await page.locator('#deployButton').click();
    await page.locator('#deploymentReceipt').waitFor({ state: 'visible', timeout: 15000 });
    const address = await page.locator('#deployedAddress').innerText();
    assert.match(address, /^0x[0-9a-fA-F]{40}$/);
    const token = await chain.core.attach(address).getToken('RHSC');
    assert.equal(P.validateToken(token), 0n);
    assert.equal(await page.evaluate(() => window.__sendCount), 1);
    await page.screenshot({ path: path.join(artifacts, 'rhsc-deploy-receipt.png'), fullPage: true });
    await page.reload(); await page.locator('#connectButton').click();
    await page.locator('#deploymentReceipt').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#deployedAddress').innerText(), address);
    assert.equal(await page.locator('#deployButton').isDisabled(), true);
    assert.equal(await page.evaluate(() => window.__sendCount), 0);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('mobile layout, theme control and canonical payload render without overflow', async () => {
  const { page, context, errors } = await pageFixture({ mobile: true });
  try {
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.locator('summary').click();
    assert.equal(await page.locator('#payload').innerText(), P.MINT);
    await page.locator('#themeButton').click();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
    await page.screenshot({ path: path.join(artifacts, 'rhsc-mobile-light.png'), fullPage: true });
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});
