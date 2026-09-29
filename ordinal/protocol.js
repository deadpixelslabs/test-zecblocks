(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.OrdinalProtocol=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const CHAIN_ID=4663,MAX_SUPPLY=5000n,FEE=190000000000000n;
  const TREASURY='0x81046ab56f41a78077662624ac4116465fdf00cc';
  const MINT='{"p":"rh-ordinal","op":"mint","tick":"RHO"}';
  const GENESIS='{"p":"rh-ordinal","op":"deploy","tick":"RHO","max":"5000","fee":"190000000000000"}';
  const address=/^0x[0-9a-fA-F]{40}$/,hash=/^0x[0-9a-fA-F]{64}$/;
  function sameAddress(a,b){return typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();}
  function validateConfig(c){
    if(c.chainId!==CHAIN_ID||c.maxSupply!=='5000'||c.protocolFeeWei!==FEE.toString()||!sameAddress(c.treasury,TREASURY)||c.collectionName!=='Robinhood Ordinal'||c.symbol!=='RHO')throw new Error('Published collection settings do not match the agreed rules.');
    if(c.rpcUrl!=='https://rpc.mainnet.chain.robinhood.com'||c.explorerUrl!=='https://robin.etherscan.io')throw new Error('Unexpected network configuration.');
    if(c.contractAddress===null){if(c.rendererAddress!==null||c.deploymentTxHash!==null||c.deploymentBlock!==null)throw new Error('Incomplete deployment configuration.');}
    else if(!address.test(c.contractAddress)||!address.test(c.rendererAddress)||!hash.test(c.deploymentTxHash)||!Number.isSafeInteger(c.deploymentBlock)||c.deploymentBlock<1)throw new Error('Incomplete official deployment receipt.');
    return c;
  }
  function validateState(s,renderer){
    if(BigInt(s.maxSupply)!==MAX_SUPPLY||BigInt(s.protocolFee)!==FEE||!sameAddress(s.treasury,TREASURY)||!sameAddress(s.rendererAddress,renderer))throw new Error('The contract has different collection rules.');
    const minted=BigInt(s.minted),owned=BigInt(s.owned);
    if(minted<0n||minted>MAX_SUPPLY||owned<0n||owned>minted)throw new Error('Invalid collection supply response.');
    return {minted,owned,soldOut:minted===MAX_SUPPLY};
  }
  function pendingKey(kind,account,contract){return ['rh-ordinal',CHAIN_ID,kind,(contract||'genesis').toLowerCase(),account.toLowerCase()].join(':');}
  function matchesTransaction(tx,r){
    if(!tx||!sameAddress(tx.from,r.account))return false;
    if(r.kind==='deploy'?tx.to!==null:!sameAddress(tx.to,r.contract))return false;
    return String(tx.data||tx.input||'').toLowerCase()===r.data.toLowerCase()&&BigInt(tx.value||0)===BigInt(r.value)&&Number(tx.nonce)===r.nonce&&BigInt(tx.chainId)===BigInt(CHAIN_ID);
  }
  function message(error){
    const s=String(error?.shortMessage||error?.message||error||'Request failed.');
    if(error?.code===4001||error?.code==='ACTION_REJECTED')return 'Request cancelled in your wallet.';
    if(/SupplyExhausted/.test(s))return 'All 5,000 Robinhood Ordinals have been minted.';
    if(/IncorrectPayment/.test(s))return 'Each mint requires exactly 0.00019 ETH plus network gas.';
    if(/RequestAlreadyMinted/.test(s))return 'This mint request was already completed. Check your pending transaction.';
    if(/insufficient funds/i.test(s))return 'Your wallet needs 0.00019 ETH plus network gas on Robinhood Chain.';
    if(/server response|timeout|Failed to fetch|temporarily unavailable/i.test(s))return 'The network is temporarily unavailable. Your saved transaction is retained; check again shortly.';
    return s.slice(0,300);
  }
  return Object.freeze({CHAIN_ID,MAX_SUPPLY,FEE,TREASURY,MINT,GENESIS,sameAddress,validateConfig,validateState,pendingKey,matchesTransaction,message});
});
