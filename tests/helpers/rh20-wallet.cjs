'use strict';
async function pageFixture({ chain, server, browser }, { route = '/rhsc.html', wallet = 1, mobile = false } = {}) {
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

module.exports = { pageFixture };
