(function(){
  'use strict';
  const E=window.ethers,P=window.OrdinalProtocol,$=id=>document.getElementById(id),mode=document.body.dataset.mode;
  const S={config:null,artifact:null,rendererArtifact:null,iface:null,publicReader:null,wallet:null,provider:null,account:null,chain:null,wallets:[],generation:0,busy:false,refreshing:false,checking:false,verified:false,minted:null,balance:0n,pending:null,receipt:null,timer:null,offset:0,inventoryKey:'',images:new Map()};
  const short=a=>a.slice(0,6)+'…'+a.slice(-4),fmt=n=>BigInt(n).toLocaleString('en-US');
  const deadline=(promise,ms=12000)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Connection delayed. Your saved request is retained.')),ms);promise.then(v=>{clearTimeout(timer);resolve(v);},e=>{clearTimeout(timer);reject(e);});});
  function status(text,kind=''){ $('status').textContent=text;$('status').className='status'+(kind?' '+kind:''); }
  function toast(text){$('toast').textContent=text;$('toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>{$('toast').hidden=true;},2500);}
  function theme(value){document.documentElement.dataset.theme=value;$('themeButton').textContent=value==='dark'?'☀':'☾';$('themeButton').setAttribute('aria-label','Switch to '+(value==='dark'?'light':'dark')+' mode');try{localStorage.setItem('ordinal-theme',value);}catch(_){}}
  try{theme(localStorage.getItem('ordinal-theme')==='light'?'light':'dark');}catch(_){theme('dark');}
  $('themeButton').onclick=()=>theme(document.documentElement.dataset.theme==='dark'?'light':'dark');
  document.querySelectorAll('[data-copy]').forEach(b=>b.onclick=async()=>{try{await navigator.clipboard.writeText($(b.dataset.copy).textContent);toast('Copied');}catch(_){toast('Select the text to copy it.');}});
  function addWallet(provider,name){if(!provider||typeof provider.request!=='function'||S.wallets.some(w=>w.provider===provider))return;S.wallets.push({provider,name:String(name||'Browser wallet').slice(0,40)});const option=document.createElement('option');option.value=String(S.wallets.length-1);option.textContent=S.wallets.at(-1).name;$('walletSelect').append(option);$('walletSelect').hidden=S.wallets.length<2;}
  window.addEventListener('eip6963:announceProvider',e=>addWallet(e.detail?.provider,e.detail?.info?.name));window.dispatchEvent(new Event('eip6963:requestProvider'));
  function legacy(){for(const p of window.ethereum?.providers||(window.ethereum?[window.ethereum]:[]))addWallet(p,p.isRabby?'Rabby':p.isMetaMask?'MetaMask':'Browser wallet');}legacy();
  function reader(){return S.provider&&S.chain===P.CHAIN_ID?S.provider:S.publicReader;}
  function key(account=S.account){return P.pendingKey(mode,account,mode==='mint'?S.config.contractAddress:null);}
  function readJournal(account=S.account){
    if(!account||!S.config||!S.artifact)return null;
    let r;try{r=JSON.parse(localStorage.getItem(key(account))||'null');}catch(_){throw new Error('Enable site storage before submitting a paid transaction.');}
    if(!r)return null;
    if(!P.sameAddress(r.account,account)||r.chainId!==P.CHAIN_ID||r.kind!==mode||!Number.isSafeInteger(r.nonce)||r.nonce<0||r.value!==(mode==='mint'?P.FEE.toString():'0'))throw new Error('The saved transaction record is invalid.');
    if(mode==='mint'&&(!/^0x[0-9a-f]{64}$/i.test(r.requestId||'')||!P.sameAddress(r.contract,S.config.contractAddress)))throw new Error('The pending mint belongs to another collection.');
    const data=mode==='deploy'?S.artifact.bytecode:S.iface.encodeFunctionData('inscribe',[P.MINT,r.requestId]);
    if(r.data!==data)throw new Error('The saved transaction differs from the published contract.');
    return r;
  }
  function saveJournal(r){localStorage.setItem(key(r.account),JSON.stringify(r));if(P.sameAddress(r.account,S.account))S.pending=r.completed?null:r;}
  function clearJournal(r){const current=readJournal(r.account);if(!current||current.data!==r.data||current.nonce!==r.nonce)return;localStorage.removeItem(key(r.account));if(P.sameAddress(r.account,S.account))S.pending=null;}
  function loadJournal(){const r=readJournal();S.pending=r&&!r.completed?r:null;S.receipt=r?.completed?r:null;if(mode==='deploy'&&S.receipt)showDeployment(S.receipt);renderRecovery();}
  function renderRecovery(){
    const r=S.pending;$('recovery').hidden=!r;if(!r)return;
    $('recoveryTitle').textContent=mode==='deploy'?'Pending deployment':'Pending mint';
    $('recoveryText').textContent=r.hash?'The transaction is saved. Checking it will not submit another payment.':'A wallet request is unresolved. Check wallet activity and paste its transaction hash. Do not send a second payment.';
    $('checkPending').hidden=!r.hash;$('pendingLink').hidden=!r.hash;
    if(r.hash){$('pendingLink').href=S.config.explorerUrl+'/tx/'+r.hash;$('pendingLink').textContent='View transaction ↗';}
  }
  function render(){
    $('connectButton').textContent=S.account?short(S.account):'Connect wallet';$('connectButton').disabled=S.busy;$('walletSelect').disabled=S.busy;
    if(mode==='deploy'){
      const deployed=!!S.config?.contractAddress||!!S.receipt?.contractAddress;
      $('deployButton').disabled=!S.artifact||S.busy||!!S.pending||deployed;
      $('deployButton').textContent=S.busy?'Check your wallet…':deployed?'Collection deployed':S.pending?'Deployment pending':S.account?'Deploy collection + artwork':'Connect wallet to deploy';return;
    }
    if(S.minted!==null){$('mintedSupply').textContent=fmt(S.minted)+' / 5,000';$('mintPercent').textContent=(Number(S.minted)/50).toFixed(2)+'%';$('progressFill').style.width=Number(S.minted)/50+'%';$('supplyProgress').setAttribute('aria-valuenow',String(S.minted));}
    $('balance').textContent=S.account&&S.verified?fmt(S.balance):'—';
    const soldOut=S.minted===P.MAX_SUPPLY;
    $('launchBadge').textContent=!S.config?.contractAddress?'Coming soon':!S.verified?'Checking chain':soldOut?'Fully minted':'Mint open';
    $('mintButton').disabled=S.busy||!S.config?.contractAddress||!S.verified||!!S.pending||soldOut;
    $('mintButton').textContent=S.busy?'Check your wallet…':!S.config?.contractAddress?'Mint opens after deployment':S.pending?'Mint transaction pending':!S.verified?'Checking mint availability':soldOut?'All 5,000 minted':!S.account?'Connect wallet to mint':S.chain!==P.CHAIN_ID?'Switch to Robinhood Chain':'Mint one Ordinal';
    if($('inventory'))$('inventory').hidden=!S.account;
  }
  function showContract(address){$('contractLink').hidden=false;$('contractLink').replaceChildren();const a=document.createElement('a');a.href=S.config.explorerUrl+'/address/'+address;a.target='_blank';a.rel='noopener noreferrer';a.textContent='Collection contract · '+short(address)+' ↗';$('contractLink').append(a);}
  function showDeployment(r){if(mode!=='deploy'||!r.contractAddress)return;$('deploymentReceipt').hidden=false;$('deployedAddress').textContent=r.contractAddress;$('rendererAddress').textContent=r.rendererAddress;$('deploymentTxLink').textContent=r.hash;$('deploymentTxLink').href=S.config.explorerUrl+'/tx/'+r.hash;showContract(r.contractAddress);}
  async function verifyContract(provider,address,blockTag,account=E.ZeroAddress){
    const [chain,code]=await deadline(Promise.all([provider.send('eth_chainId',[]),provider.getCode(address,blockTag)]));
    if(BigInt(chain)!==4663n||code==='0x'||E.keccak256(code)!==S.artifact.runtimeCodeHash)throw new Error('Contract verification failed. Minting is disabled.');
    const contract=new E.Contract(address,S.artifact.abi,provider);
    const state=await deadline(contract.collectionState(account,{blockTag}));
    const expectedRenderer=E.getCreateAddress({from:address,nonce:1});
    if(S.config.contractAddress&&(!P.sameAddress(address,S.config.contractAddress)||!P.sameAddress(expectedRenderer,S.config.rendererAddress)))throw new Error('This is not the official collection.');
    const validated=P.validateState(state,expectedRenderer);
    const rendererCode=await deadline(provider.getCode(expectedRenderer,blockTag));
    if(rendererCode==='0x'||E.keccak256(rendererCode)!==S.rendererArtifact.runtimeCodeHash)throw new Error('Artwork renderer verification failed. Minting is disabled.');
    return {contract,state:validated,rendererAddress:expectedRenderer};
  }
  function decodeMetadata(uri){
    if(!uri.startsWith('data:application/json;base64,'))throw new Error('Unexpected metadata format.');
    const data=JSON.parse(new TextDecoder().decode(E.decodeBase64(uri.slice(29))));
    if(typeof data.name!=='string'||typeof data.image!=='string'||!data.image.startsWith('data:image/svg+xml;base64,'))throw new Error('Unexpected on-chain artwork.');
    return data;
  }
  async function inventory(contract,blockTag,generation,account){
    if(mode!=='mint'||!account)return;
    if(S.offset>=Number(S.balance)&&S.offset!==0)S.offset=0;
    const [ids,total]=await deadline(contract.ownedTokens(account,S.offset,6,{blockTag}));
    const cacheKey=[account,S.offset,ids.join(',')].join(':');
    if(S.inventoryKey===cacheKey)return;
    const cards=[];
    for(const id of ids){
      let data=S.images.get(String(id));if(!data){data=decodeMetadata(await deadline(contract.tokenURI(id,{blockTag})));S.images.set(String(id),data);}
      if(generation!==S.generation||!P.sameAddress(account,S.account))return;
      const article=document.createElement('article'),img=document.createElement('img'),caption=document.createElement('div');
      img.src=data.image;img.alt=data.name;img.width=420;img.height=420;caption.textContent=data.name;article.append(img,caption);cards.push(article);
    }
    if(generation!==S.generation||!P.sameAddress(account,S.account))return;
    $('ownedGrid').replaceChildren(...cards);$('inventoryHint').textContent=total===0n?'Your minted or received Ordinals will appear here.':`${S.offset+1}–${S.offset+ids.length} of ${fmt(total)} owned`;
    $('previousOwned').disabled=S.offset===0;$('nextOwned').disabled=S.offset+ids.length>=Number(total);S.inventoryKey=cacheKey;
  }
  async function refresh(){
    if(!S.config||!S.artifact)return;
    if(S.refreshing){S.refreshAgain=true;return;}
    if(!S.config.contractAddress){S.verified=false;if(mode==='mint'&&!S.pending)status('Robinhood Ordinal is preparing to launch. The official mint opens here after deployment.');render();return;}
    S.refreshing=true;const generation=S.generation,account=S.account;
    try{
      const provider=reader(),blockTag=Number(BigInt(await deadline(provider.send('eth_blockNumber',[]))));
      const result=await verifyContract(provider,S.config.contractAddress,blockTag,account||E.ZeroAddress);
      if(generation!==S.generation)return;
      S.minted=result.state.minted;S.balance=result.state.owned;S.verified=true;showContract(S.config.contractAddress);render();
      if(!S.pending&&!S.busy)status(mode==='deploy'?'The official collection is already deployed.':result.state.soldOut?'All 5,000 Robinhood Ordinals have been minted.':account?'Ready to mint. Protocol fee: 0.00019 ETH plus network gas.':'Connect your wallet to mint one Robinhood Ordinal.');
      try{await inventory(result.contract,blockTag,generation,account);}catch(_){if(generation===S.generation&&$('inventoryHint'))$('inventoryHint').textContent='Your artwork is syncing. It will refresh automatically.';}
    }catch(error){if(generation===S.generation){S.verified=false;if(!S.pending&&!S.busy)status(P.message(error),'error');}}
    finally{S.refreshing=false;render();if(S.refreshAgain){S.refreshAgain=false;void refresh();}}
  }
  async function updateAccount(){
    if(!S.wallet)return;const generation=++S.generation,wallet=S.wallet;
    const [accounts,chain]=await Promise.all([wallet.request({method:'eth_accounts'}),wallet.request({method:'eth_chainId'})]);if(generation!==S.generation)return;
    S.account=accounts[0]?E.getAddress(accounts[0]):null;S.chain=Number(BigInt(chain));S.provider=new E.BrowserProvider(wallet,'any');S.verified=false;S.balance=0n;S.pending=null;S.receipt=null;S.offset=0;S.inventoryKey='';
    if($('ownedGrid'))$('ownedGrid').replaceChildren();if(mode==='deploy')$('deploymentReceipt').hidden=true;
    loadJournal();render();await refresh();if(S.pending?.hash&&S.chain===P.CHAIN_ID)await checkPending();
  }
  function walletChanged(){updateAccount().catch(e=>{status(P.message(e),'error');render();});}
  async function connect(){
    legacy();const selected=S.wallets[Number($('walletSelect').value||0)];if(!selected)throw new Error('Open this page with MetaMask, Rabby, or another EVM wallet.');
    if(S.wallet?.removeListener){S.wallet.removeListener('accountsChanged',walletChanged);S.wallet.removeListener('chainChanged',walletChanged);}
    S.wallet=selected.provider;S.wallet.on?.('accountsChanged',walletChanged);S.wallet.on?.('chainChanged',walletChanged);
    await S.wallet.request({method:'eth_requestAccounts'});await updateAccount();
  }
  async function ensureMainnet(){
    if(!S.account)await connect();
    if(Number(BigInt(await S.wallet.request({method:'eth_chainId'})))!==P.CHAIN_ID){
      try{await S.wallet.request({method:'wallet_switchEthereumChain',params:[{chainId:'0x1237'}]});}
      catch(e){if(e?.code!==4902&&e?.data?.originalError?.code!==4902)throw e;await S.wallet.request({method:'wallet_addEthereumChain',params:[{chainId:'0x1237',chainName:'Robinhood Chain',nativeCurrency:{name:'Ether',symbol:'ETH',decimals:18},rpcUrls:[S.config.rpcUrl],blockExplorerUrls:[S.config.explorerUrl]}]});await S.wallet.request({method:'wallet_switchEthereumChain',params:[{chainId:'0x1237'}]});}
    }
    await updateAccount();if(!S.account||S.chain!==P.CHAIN_ID)throw new Error('Select Robinhood Chain in your wallet.');
  }
  async function locked(account,fn){if(!navigator.locks)throw new Error('Use a current browser with secure transaction locking enabled.');return navigator.locks.request(key(account),{ifAvailable:true},lock=>{if(!lock)throw new Error('This wallet has an active request in another tab.');return fn();});}
  async function checkPending(hashOverride){
    if(S.checking||!S.pending||!S.account||S.chain!==P.CHAIN_ID)return;
    const r=S.pending,provider=S.provider,generation=S.generation,hash=typeof hashOverride==='string'?hashOverride.trim():r.hash;
    if(!/^0x[0-9a-fA-F]{64}$/.test(hash||'')){status('Paste the full transaction hash from your wallet.');return;}
    S.checking=true;
    try{await locked(r.account,async()=>{
      const current=readJournal(r.account);if(!current||current.data!==r.data||current.nonce!==r.nonce)return;
      const tx=await deadline(provider.getTransaction(hash));if(!tx){if(generation===S.generation)status('The RPC has not returned this transaction. Your saved request is retained.');return;}
      const receipt=await deadline(provider.getTransactionReceipt(hash));
      if(!P.matchesTransaction(tx,r)){
        const sameNonce=P.sameAddress(tx.from,r.account)&&Number(tx.nonce)===r.nonce&&BigInt(tx.chainId)===4663n;
        if(!sameNonce||!receipt)throw new Error('This transaction does not match the saved wallet, nonce, payment and operation.');
        const block=await deadline(provider.getBlock(receipt.blockNumber));if(block?.hash!==receipt.blockHash)throw new Error('Waiting for a canonical replacement receipt.');
        // A different confirmed transaction consumed this exact nonce. The original can no longer execute.
        clearJournal(r);if(generation===S.generation)status('The original request was replaced or cancelled in your wallet. You can submit a new request.');return;
      }
      saveJournal({...r,hash});if(!receipt){if(generation===S.generation)status('Transaction submitted. Waiting for confirmation.');return;}
      const block=await deadline(provider.getBlock(receipt.blockNumber));if(block?.hash!==receipt.blockHash)throw new Error('Waiting for a canonical transaction receipt.');
      if(receipt.status!==1){clearJournal(r);if(generation===S.generation)status('Transaction reverted. No mint fee was retained; network gas may have been charged.','error');return;}
      if(r.kind==='deploy'){
        if(!receipt.contractAddress)throw new Error('The receipt has no collection address.');
        const verified=await verifyContract(provider,receipt.contractAddress,receipt.blockNumber);
        const event=receipt.logs.filter(l=>P.sameAddress(l.address,receipt.contractAddress)).map(l=>{try{return S.iface.parseLog(l);}catch(_){return null;}}).find(l=>l?.name==='Genesis');
        if(!event||!P.sameAddress(event.args.deployer,r.account)||!P.sameAddress(event.args.renderer,verified.rendererAddress)||event.args.supply!==P.MAX_SUPPLY||event.args.protocolFee!==P.FEE||event.args.payload!==P.GENESIS)throw new Error('The deployment receipt has no matching genesis.');
        const done={...r,hash,completed:true,contractAddress:receipt.contractAddress,rendererAddress:verified.rendererAddress,deploymentBlock:receipt.blockNumber};saveJournal(done);
        if(generation===S.generation){S.receipt=done;showDeployment(done);status('Collection and on-chain artwork deployed. Copy the deployment details to activate the official mint page.','success');}
      }else{
        await verifyContract(provider,r.contract,receipt.blockNumber,r.account);
        const event=receipt.logs.filter(l=>P.sameAddress(l.address,r.contract)).map(l=>{try{return S.iface.parseLog(l);}catch(_){return null;}}).find(l=>l?.name==='Inscribed'&&P.sameAddress(l.args.account,r.account)&&l.args.requestId.toLowerCase()===r.requestId.toLowerCase()&&l.args.protocolFee===P.FEE&&l.args.payload===P.MINT);
        if(!event)throw new Error('No matching inscription was found. Your request is retained.');
        clearJournal(r);if(generation===S.generation){S.inventoryKey='';await refresh();status('Mint confirmed: Robinhood Ordinal #'+event.args.tokenId.toString()+'.','success');const a=document.createElement('a');a.href=S.config.explorerUrl+'/tx/'+hash;a.target='_blank';a.rel='noopener noreferrer';a.textContent=' View transaction ↗';$('status').append(a);}
      }
    });}catch(e){if(generation===S.generation)status(P.message(e),'error');}
    finally{S.checking=false;renderRecovery();render();}
  }
  async function submit(){
    if(S.busy||!S.artifact||!S.config)return;S.busy=true;render();let intent=null,sent=false;
    try{
      if(mode==='mint'&&!S.config.contractAddress)throw new Error('The official mint is not open yet.');
      if(mode==='deploy'&&S.config.contractAddress)throw new Error('The official collection is already deployed.');
      await ensureMainnet();const account=S.account,wallet=S.wallet,provider=S.provider,generation=S.generation;
      await locked(account,async()=>{
        if(readJournal(account))throw new Error('A saved transaction already exists. Recover it before continuing.');
        if(mode==='mint'){
          const blockTag=Number(BigInt(await deadline(provider.send('eth_blockNumber',[]))));
          const result=await verifyContract(provider,S.config.contractAddress,blockTag,account);if(result.state.soldOut)throw new Error('All 5,000 Robinhood Ordinals have been minted.');
        }
        const nonce=Number(BigInt(await deadline(provider.send('eth_getTransactionCount',[account,'pending']))));
        const requestId=mode==='mint'?E.hexlify(crypto.getRandomValues(new Uint8Array(32))):null;
        const data=mode==='deploy'?S.artifact.bytecode:S.iface.encodeFunctionData('inscribe',[P.MINT,requestId]);
        const value=mode==='mint'?P.FEE:0n,request={from:account,data,value,chainId:P.CHAIN_ID,nonce};if(mode==='mint')request.to=S.config.contractAddress;
        const gas=await deadline(provider.estimateGas(request),20000);
        const [accounts,chain]=await Promise.all([wallet.request({method:'eth_accounts'}),wallet.request({method:'eth_chainId'})]);
        if(generation!==S.generation||wallet!==S.wallet||!P.sameAddress(accounts[0],account)||BigInt(chain)!==4663n)throw new Error('Wallet or network changed. Review your wallet and try again.');
        intent={kind:mode,account,chainId:P.CHAIN_ID,contract:mode==='mint'?S.config.contractAddress:null,requestId,data,value:value.toString(),nonce,hash:null,completed:false,createdAt:Date.now()};
        saveJournal(intent);renderRecovery();status(mode==='mint'?'Confirm one NFT mint: 0.00019 ETH protocol fee plus network gas.':'Confirm deployment of the collection and SVG renderer. Your wallet shows the network gas fee.');
        const signer=await provider.getSigner(account),tx=await signer.sendTransaction({...request,gasLimit:(gas*120n+99n)/100n});sent=true;
        intent={...intent,hash:tx.hash};saveJournal(intent);if(generation===S.generation)status('Transaction submitted. Its hash is saved.');
      });
    }catch(e){if(intent&&!sent&&(e?.code===4001||e?.code==='ACTION_REJECTED'))clearJournal(intent);status(intent&&!sent&&S.pending?'Wallet response unresolved. Check wallet activity before paying again. '+P.message(e):P.message(e),'error');}
    finally{S.busy=false;renderRecovery();render();if(S.pending?.hash)await checkPending();}
  }
  $('connectButton').onclick=()=>{if(!S.busy)connect().catch(e=>status(P.message(e),'error'));};$('walletSelect').onchange=()=>{if(!S.busy&&S.account)connect().catch(e=>status(P.message(e),'error'));};
  if($('mintButton'))$('mintButton').onclick=submit;if($('deployButton'))$('deployButton').onclick=submit;
  $('checkPending').onclick=()=>checkPending();$('recoverHash').onclick=()=>checkPending($('transactionHash').value);
  if($('copyDeployment'))$('copyDeployment').onclick=async()=>{if(!S.receipt)return;const r=S.receipt,details={chainId:4663,contractAddress:r.contractAddress,rendererAddress:r.rendererAddress,deploymentTxHash:r.hash,deploymentBlock:r.deploymentBlock,maxSupply:'5000',protocolFeeWei:P.FEE.toString(),treasury:P.TREASURY};try{await navigator.clipboard.writeText(JSON.stringify(details,null,2));toast('Deployment details copied');}catch(_){toast('Copy the addresses and transaction shown above.');}};
  if($('previousOwned'))$('previousOwned').onclick=()=>{S.offset=Math.max(0,S.offset-6);S.inventoryKey='';void refresh();};if($('nextOwned'))$('nextOwned').onclick=()=>{S.offset+=6;S.inventoryKey='';void refresh();};
  document.querySelectorAll('[data-art]').forEach(button=>button.onclick=()=>{$('heroArt').src=button.dataset.art;document.querySelectorAll('[data-art]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));});
  window.addEventListener('storage',event=>{if(S.account&&S.config&&event.key===key()){try{loadJournal();render();}catch(e){status(P.message(e),'error');}}});
  async function tick(){if(!document.hidden&&!S.busy){if(S.pending?.hash)await checkPending();else await refresh();}clearTimeout(S.timer);S.timer=setTimeout(tick,20000);}
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){clearTimeout(S.timer);void tick();}});
  async function init(){
    if(!P||!E)throw new Error('Wallet library failed to load. Refresh this page.');
    const json=async url=>{const r=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(12000)});if(!r.ok)throw new Error('Unable to load official collection settings.');return r.json();};
    const [config,artifact,renderer]=await Promise.all([json('/ordinal/mainnet.json'),json('/ordinal/RobinhoodOrdinal.json'),json('/ordinal/RobinhoodOrdinalRenderer.json')]);S.config=P.validateConfig(config);
    for(const a of [artifact,renderer])if(a.chainId!==4663||!/^0x[0-9a-f]+$/i.test(a.bytecode)||E.keccak256(a.deployedBytecode)!==a.runtimeCodeHash)throw new Error('Invalid published contract artifact.');
    S.artifact=artifact;S.rendererArtifact=renderer;S.iface=new E.Interface(artifact.abi);
    const connection=new E.FetchRequest(new URL('/api/ordinal',location.origin).href);connection.timeout=12000;S.publicReader=new E.JsonRpcProvider(connection,4663,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});
    if(mode==='deploy')status(config.contractAddress?'The official collection is already published.':'Connect the deployment wallet to create the collection and artwork on Robinhood Chain.');
    render();await refresh();void tick();
  }
  init().catch(e=>{status(P.message(e),'error');$('connectButton').disabled=true;});
})();
