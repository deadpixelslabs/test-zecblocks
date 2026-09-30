(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RH20Protocol = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const CHAIN_ID = 4663;
  const catalog = Object.freeze({
    RHSC: Object.freeze({ ticker: 'RHSC', maxSupply: '21000000', mintAmount: '500', maxMintsPerWallet: 20, configPath: '/rh20/mainnet.json', artifactPath: '/rh20/RH20.json', sourcePath: '/contracts/RH20.sol' }),
    VLAD: Object.freeze({ ticker: 'VLAD', maxSupply: '100000000', mintAmount: '40', maxMintsPerWallet: 0, configPath: '/rh20/vlad.json', artifactPath: '/rh20/RH20.json', sourcePath: '/contracts/RH20.sol' })
  });
  function sameAddress(a, b) { return typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase(); }
  function matchesTransaction(tx, expected) {
    if (!tx || !sameAddress(tx.from, expected.account)) return false;
    if (expected.kind === 'deploy' ? tx.to !== null : !sameAddress(tx.to, expected.contract)) return false;
    if (String(tx.data || tx.input || '').toLowerCase() !== expected.data.toLowerCase()) return false;
    if (BigInt(tx.value || 0) !== 0n) return false;
    if (tx.chainId != null && BigInt(tx.chainId) !== BigInt(CHAIN_ID)) return false;
    if (expected.nonce != null && Number(tx.nonce) !== Number(expected.nonce)) return false;
    return true;
  }
  function validateRules(ticker, maxSupply, mintAmount) {
    if (!/^[A-Z0-9]{2,12}$/.test(ticker)) throw new Error('Ticker must contain 2–12 uppercase letters or digits.');
    if (!/^[1-9][0-9]{0,77}$/.test(String(maxSupply)) || !/^[1-9][0-9]{0,77}$/.test(String(mintAmount))) throw new Error('Supply and mint amount must be positive whole numbers.');
    const maximum = BigInt(maxSupply), amount = BigInt(mintAmount);
    if (maximum > (1n << 256n) - 1n || amount > maximum || maximum % amount !== 0n) throw new Error('Supply must fit uint256 and divide exactly by the mint amount.');
    return { ticker, maxSupply: String(maximum), mintAmount: String(amount), maxMintsPerWallet: ticker === 'RHSC' ? 20 : 0 };
  }
  function forToken(ticker, settings) {
    const spec = Object.hasOwn(catalog, ticker) ? catalog[ticker] : settings ? Object.freeze({ ...validateRules(ticker, settings.maxSupply, settings.mintAmount), configPath: '/rh20/mainnet.json', artifactPath: '/rh20/RH20.json', sourcePath: '/contracts/RH20.sol' }) : null;
    if (!spec) throw new Error('Unsupported RH-20 ticker.');
    const maximum = BigInt(spec.maxSupply), amount = BigInt(spec.mintAmount), limit = BigInt(spec.maxMintsPerWallet);
    const DEPLOY = JSON.stringify({ p: 'rh-20', op: 'deploy', tick: ticker, max: spec.maxSupply, lim: spec.mintAmount });
    const MINT = JSON.stringify({ p: 'rh-20', op: 'mint', tick: ticker, amt: spec.mintAmount });
    function validateConfig(config) {
      if (config.chainId !== CHAIN_ID || config.ticker !== ticker || config.maxSupply !== spec.maxSupply || config.mintAmount !== spec.mintAmount || config.maxMintsPerWallet !== spec.maxMintsPerWallet) throw new Error('The published ' + ticker + ' settings do not match the protocol.');
      if (config.contractAddress !== null && (!/^0x[0-9a-fA-F]{40}$/.test(config.contractAddress) || /^0x0{40}$/i.test(config.contractAddress))) throw new Error('Invalid published contract address.');
      if (config.contractAddress && (!/^0x[0-9a-fA-F]{64}$/.test(config.deploymentTxHash || '') || !Number.isSafeInteger(config.deploymentBlock) || config.deploymentBlock < 1)) throw new Error('The published deployment receipt is incomplete.');
      if (config.explorerUrl !== 'https://robin.etherscan.io' || config.rpcUrl !== 'https://rpc.mainnet.chain.robinhood.com') throw new Error('Unexpected network settings.');
      return config;
    }
    function validateToken(token) {
      if (token.tick !== ticker || BigInt(token.maxSupply) !== maximum || BigInt(token.mintAmount) !== amount || BigInt(token.maxMintsPerWallet) !== limit || !token.exists) throw new Error('The connected contract has different ' + ticker + ' rules.');
      const supply = BigInt(token.totalSupply);
      if (supply < 0n || supply > maximum || supply % amount !== 0n) throw new Error('The ' + ticker + ' supply response is invalid.');
      return supply;
    }
    function mintState(supply, count) {
      supply = BigInt(supply); count = BigInt(count);
      if (count < 0n || (limit !== 0n && count > limit)) throw new Error('Invalid wallet mint count.');
      return { soldOut: supply >= maximum, walletComplete: limit !== 0n && count >= limit, remaining: limit === 0n ? null : Number(limit - count), canMint: supply < maximum && (limit === 0n || count < limit) };
    }
    function pendingKey(kind, account, contract) {
      // Preserve RHSC recovery keys. Other tickers share a registry but never a journal.
      const destination = (contract || 'genesis') + (ticker === 'RHSC' ? '' : ':' + ticker);
      return ['rh20', CHAIN_ID, kind, destination.toLowerCase(), account.toLowerCase()].join(':');
    }
    function message(error) {
      const text = String(error?.shortMessage || error?.message || error || 'Request failed.');
      if (error?.code === 4001 || error?.code === 'ACTION_REJECTED') return 'Request cancelled in your wallet.';
      if (/WalletMintLimitReached/.test(text)) return 'This wallet has completed all ' + limit + ' mints.';
      if (/SupplyExhausted/.test(text)) return 'All ' + maximum.toLocaleString('en-US') + ' ' + ticker + ' have been minted.';
      if (/insufficient funds/i.test(text)) return 'Your wallet needs ETH on Robinhood Chain to pay the network fee.';
      if (/InvalidAmount/.test(text)) return 'Each mint must contain exactly ' + amount + ' ' + ticker + '.';
      if (/user rejected|user denied/i.test(text)) return 'Request cancelled in your wallet.';
      return text.slice(0, 300);
    }
    return Object.freeze({ CHAIN_ID, DEPLOY, MINT, spec, validateConfig, validateToken, mintState, sameAddress, matchesTransaction, pendingKey, message });
  }
  return Object.freeze({ ...forToken('RHSC'), forToken, catalog, validateRules });
});
