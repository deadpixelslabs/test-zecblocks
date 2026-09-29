(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RH20Protocol = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const CHAIN_ID = 4663;
  const DEPLOY = '{"p":"rh-20","op":"deploy","tick":"RHSC","max":"21000000","lim":"500"}';
  const MINT = '{"p":"rh-20","op":"mint","tick":"RHSC","amt":"500"}';
  function validateConfig(config) {
    if (config.chainId !== CHAIN_ID || config.ticker !== 'RHSC' || config.maxSupply !== '21000000' || config.mintAmount !== '500' || config.maxMintsPerWallet !== 20) throw new Error('The published RHSC settings do not match the protocol.');
    if (config.contractAddress !== null && !/^0x[0-9a-fA-F]{40}$/.test(config.contractAddress)) throw new Error('Invalid published contract address.');
    if (config.contractAddress && (!/^0x[0-9a-fA-F]{64}$/.test(config.deploymentTxHash || '') || !Number.isSafeInteger(config.deploymentBlock) || config.deploymentBlock < 1)) throw new Error('The published deployment receipt is incomplete.');
    if (config.explorerUrl !== 'https://robin.etherscan.io' || config.rpcUrl !== 'https://rpc.mainnet.chain.robinhood.com') throw new Error('Unexpected network settings.');
    return config;
  }
  function validateToken(token) {
    if (token.tick !== 'RHSC' || BigInt(token.maxSupply) !== 21000000n || BigInt(token.mintAmount) !== 500n || BigInt(token.maxMintsPerWallet) !== 20n || !token.exists) throw new Error('The connected contract has different RHSC rules.');
    const supply = BigInt(token.totalSupply);
    if (supply < 0n || supply > 21000000n || supply % 500n !== 0n) throw new Error('The RHSC supply response is invalid.');
    return supply;
  }
  function mintState(supply, count) {
    supply = BigInt(supply); count = BigInt(count);
    if (count < 0n || count > 20n) throw new Error('Invalid wallet mint count.');
    return { soldOut: supply >= 21000000n, walletComplete: count >= 20n, remaining: Number(20n - count), canMint: supply < 21000000n && count < 20n };
  }
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
  function pendingKey(kind, account, contract) { return ['rh20', CHAIN_ID, kind, (contract || 'genesis').toLowerCase(), account.toLowerCase()].join(':'); }
  function message(error) {
    const text = String(error?.shortMessage || error?.message || error || 'Request failed.');
    if (error?.code === 4001 || error?.code === 'ACTION_REJECTED') return 'Request cancelled in your wallet.';
    if (/WalletMintLimitReached/.test(text)) return 'This wallet has completed all 20 mints.';
    if (/SupplyExhausted/.test(text)) return 'All 21,000,000 RHSC have been minted.';
    if (/insufficient funds/i.test(text)) return 'Your wallet needs ETH on Robinhood Chain to pay the network fee.';
    if (/InvalidAmount/.test(text)) return 'Each mint must contain exactly 500 RHSC.';
    if (/user rejected|user denied/i.test(text)) return 'Request cancelled in your wallet.';
    return text.slice(0, 300);
  }
  return Object.freeze({ CHAIN_ID, DEPLOY, MINT, validateConfig, validateToken, mintState, sameAddress, matchesTransaction, pendingKey, message });
});
