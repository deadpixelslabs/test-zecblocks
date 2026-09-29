'use strict';
// Read-only production verification. No wallet provider or signing account is injected.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { chromium } = require('playwright');
const config = require('../rh20/mainnet.json');
const base = 'https://mine.zecblocks.xyz';
const root = path.resolve(__dirname, '..');
const hash = data => createHash('sha256').update(data).digest('hex');
const files = ['rhsc.html', 'rhsc-deploy.html', 'rh20/mainnet.json', 'rh20/RH20.json', 'rh20/app.js', 'rh20/protocol.js', 'rh20/style.css', 'contracts/RH20.sol', 'rh20/compiler-input.json', 'vendor/ethers-6.13.5.umd.min.js'];
async function deployedFiles() {
  let failure;
  for (let attempt = 0; attempt < 10; ++attempt) {
    try {
      await Promise.all(files.map(async name => {
        const response = await fetch(base + '/' + name + '?release-check=' + Date.now(), { signal: AbortSignal.timeout(12000) });
        assert.equal(response.status, 200, name);
        assert.equal(hash(Buffer.from(await response.arrayBuffer())), hash(fs.readFileSync(path.join(root, name))), 'Deployed source differs: ' + name);
      }));
      return;
    } catch (error) { failure = error; if (attempt < 9) await new Promise(resolve => setTimeout(resolve, 10000)); }
  }
  throw failure;
}
(async () => {
  await deployedFiles();
  const read = await fetch(base + '/api/rh20', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 46, method: 'eth_chainId', params: [] }), signal: AbortSignal.timeout(12000) });
  assert.equal(read.status, 200, 'Production RPC read');
  const network = await read.json(); assert.equal(BigInt(network.result), 4663n);
  const rejected = await fetch(base + '/api/rh20', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 47, method: 'eth_sendRawTransaction', params: [] }), signal: AbortSignal.timeout(12000) });
  assert.equal(rejected.status, 400, 'Production proxy must remain read-only'); await rejected.arrayBuffer();
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + '/rhsc-deploy.html', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => !document.querySelector('#status').textContent.startsWith('Loading'));
    assert.equal(await page.locator('#deployButton').isDisabled(), !!config.contractAddress);
    const out = path.join(root, 'test-artifacts'); fs.mkdirSync(out, { recursive: true });
    await page.screenshot({ path: path.join(out, 'rhsc-production-deploy.png'), fullPage: true });
    await page.goto(base + '/rhsc.html', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => !document.querySelector('#status').textContent.startsWith('Loading'));
    if (!config.contractAddress) {
      assert.match(await page.locator('#status').innerText(), /not been published/);
      assert.equal(await page.locator('#mintButton').isDisabled(), true);
    } else {
      await page.waitForFunction(() => document.querySelector('#launchBadge').textContent !== 'Verifying contract');
      assert.match(await page.locator('#launchBadge').innerText(), /Mint open|Mint complete/);
    }
    await page.screenshot({ path: path.join(out, 'rhsc-production-mint.png'), fullPage: true });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ live: base, verifiedFiles: files.length, chainId: Number(BigInt(network.result)), contractAddress: config.contractAddress, pagesVerified: 2, pageErrors: 0 }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
