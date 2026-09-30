(function () {
 'use strict';
 const P=window.RH20Protocol,E=window.ethers,$=id=>document.getElementById(id);
 const requested=(new URLSearchParams(location.search).get('tick')||'VLAD').toUpperCase();
 const selected=/^[A-Z0-9]{2,12}$/.test(requested)?requested:'VLAD';
 document.body.dataset.ticker=selected;
 const fmt=value=>BigInt(value).toLocaleString('en-US');
 const percent=(supply,max)=>Number(BigInt(supply)*10000n/BigInt(max))/100;
 function showSpec(spec){
  $('selectedTicker').textContent=spec.ticker;
  $('selectedAmount').textContent=fmt(spec.mintAmount);
  $('selectedLimit').textContent=spec.maxMintsPerWallet?spec.maxMintsPerWallet+' mints':'Unlimited';
  $('walletMints').textContent='— / '+(spec.maxMintsPerWallet||'Unlimited');
  $('mintedSupply').textContent='— / '+fmt(spec.maxSupply);
  $('supplyProgress').setAttribute('aria-valuemax',spec.maxSupply);
  $('supplyProgress').setAttribute('aria-label',selected+' minted supply');
  $('totalMintEvents').textContent=fmt(BigInt(spec.maxSupply)/BigInt(spec.mintAmount));
  $('payload').textContent=P.forToken(spec.ticker,spec).MINT;
  $('selectedRules').textContent='Each mint creates exactly '+fmt(spec.mintAmount)+' '+selected+'. '+(spec.maxMintsPerWallet?'Each wallet may mint '+spec.maxMintsPerWallet+' times in its lifetime. Transfers do not reset this limit.':'There is no per-wallet mint limit. Minting stops when the fixed supply is exhausted.')+' No premine or privileged mint.';
  $('selectedSource').href='/contracts/RH20.sol';
 }
 if(P.catalog[selected])showSpec(P.catalog[selected]);else $('selectedTicker').textContent=selected;
 window.addEventListener('rh20:token-spec',e=>showSpec(e.detail));
 let offset=0,total=0,filter='all',busy=false,again=false,generation=0,timer,searchTimer;
 let records=[];
 const fetchJSON=async url=>{const response=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(12000)});if(!response.ok)throw Error('Token directory unavailable');return response.json();};
 const settings=Promise.all([fetchJSON('/rh20/mainnet.json'),fetchJSON('/rh20/RH20.json')]);
 const connection=new E.FetchRequest(new URL('/api/rh20',location.origin).href);connection.timeout=12000;
 const reader=new E.JsonRpcProvider(connection,P.CHAIN_ID,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});
 function cell(row,text){const td=document.createElement('td');td.textContent=text;row.append(td);return td;}
 function link(text,href,cls){const a=document.createElement('a');a.textContent=text;a.href=href;if(cls)a.className=cls;return a;}
 function draw(){
  const body=$('tokenRows');body.replaceChildren();let visible=0;
  for(const r of records){
   if(filter==='mintable'&&r.state!=='open'||filter==='complete'&&r.state!=='complete')continue;
   visible++;
   const tr=document.createElement('tr');tr.dataset.token=r.ticker;if(r.ticker===selected)tr.className='selected';
   const num=cell(tr,r.ordinal?'#'+r.ordinal:'—');num.className='token-number';
   const name=cell(tr,''),a=link('','/rh20.html?tick='+r.ticker,'token-name'),avatar=document.createElement('span'),labels=document.createElement('span');
   avatar.className='token-avatar'+(r.ticker==='VLAD'?' vlad':'');avatar.textContent=r.ticker[0];
   const b=document.createElement('b');b.textContent=r.ticker;const small=document.createElement('small');small.textContent=r.ticker==='RHSC'?'First RH-20 token':r.ticker==='VLAD'?'ZEC BLOCKS':'Community token';
   labels.append(b,small);a.append(avatar,labels);if(r.ticker===selected)a.setAttribute('aria-current','true');name.append(a);
   const progress=cell(tr,''),meta=document.createElement('div');meta.className='row-progress-meta';
   const pct=document.createElement('span'),state=document.createElement('span');state.dataset.state='';
   const p=r.supply==null?null:percent(r.supply,r.max_supply);
   pct.textContent=p==null?'—':p.toFixed(2)+'%';state.textContent={pending:'Awaiting registration',open:'Mintable',complete:'Completed',unavailable:'Read unavailable'}[r.state];
   meta.append(pct,state);const bar=document.createElement('div'),fill=document.createElement('i');bar.className='row-progress';fill.style.width=(p||0)+'%';bar.append(fill);
   const amount=document.createElement('small');amount.textContent=(r.supply==null?'—':fmt(r.supply))+' / '+fmt(r.max_supply);amount.className='supply-value';amount.title=amount.textContent;progress.append(meta,bar,amount);
   const perMint=cell(tr,fmt(r.mint_amount));perMint.className='mint-amount';perMint.title=perMint.textContent;
   cell(tr,r.wallet_limit?r.wallet_limit+' mints':'Unlimited');
   const actions=cell(tr,''),group=document.createElement('div');group.className='row-actions';
   group.append(link(r.state==='open'?'Mint':'View','/rh20.html?tick='+r.ticker,'row-action'));
   if(r.ticker==='RHSC')group.append(link('Trade ↗','https://www.zecblocks.xyz/rh20.html','trade-link'));
   if(r.tx_hash){const tx=link('Deploy ↗','https://robin.etherscan.io/tx/'+r.tx_hash,'trade-link');tx.target='_blank';tx.rel='noopener noreferrer';group.append(tx);}
   actions.append(group);body.append(tr);
  }
  $('emptyTokens').hidden=visible>0;
  $('tokenCount').textContent=String(total);
  $('directoryPage').textContent='Page '+(offset/24+1)+' · Deployment order';
  $('previousTokens').disabled=offset===0||busy;$('nextTokens').disabled=offset+24>=total||busy;
 }
 async function refresh(){
  if(busy){again=true;return;}busy=true;$('refreshTokens').disabled=true;
  const version=generation,q=$('tokenSearch').value.trim().toUpperCase();
  try{
   if(!/^[A-Z0-9]{0,12}$/.test(q))throw Error('Search uses 2–12 letters or digits.');
   const [data,[config,artifact]]=await Promise.all([fetchJSON('/api/rh20-tokens?q='+encodeURIComponent(q)+'&offset='+offset),settings]);
   P.validateConfig(config);
   if(artifact.chainId!==4663||E.keccak256(artifact.deployedBytecode)!==artifact.runtimeCodeHash)throw Error('Invalid registry artifact');
   if(!Array.isArray(data.tokens)||data.tokens.length>24||!Number.isSafeInteger(data.total)||data.total<0)throw Error('Invalid directory response');
   const blockTag=Number(BigInt(await reader.send('eth_blockNumber',[])));
   if(E.keccak256(await reader.getCode(config.contractAddress,blockTag))!==artifact.runtimeCodeHash)throw Error('Registry verification failed');
   const core=new E.Contract(config.contractAddress,artifact.abi,reader);
   const next=data.tokens.map(r=>{
    const rules=P.validateRules(r.ticker,r.max_supply,r.mint_amount);
    if(!Number.isSafeInteger(r.ordinal)||r.ordinal<1||!/^0x[0-9a-f]{64}$/i.test(r.tx_hash)||r.wallet_limit!==rules.maxMintsPerWallet)throw Error('Invalid deployment record');
    return {...r,state:'unavailable',supply:null};
   });
   // Show VLAD honestly before registration, without assigning a sequence number.
   if(offset===0&&(!q||'VLAD'.includes(q))&&!next.some(r=>r.ticker==='VLAD')){
    try{const token=await core.getToken('VLAD',{blockTag});P.forToken('VLAD').validateToken(token);next.push({ticker:'VLAD',max_supply:'100000000',mint_amount:'40',wallet_limit:0,state:'open',supply:token.totalSupply});}
    catch(error){if(String(error.data||'').toLowerCase()===E.id('UnknownToken()').slice(0,10))next.push({ticker:'VLAD',max_supply:'100000000',mint_amount:'40',wallet_limit:0,state:'pending',supply:null});}
   }
   let i=0;
   await Promise.all(Array.from({length:Math.min(4,next.length)},async()=>{while(i<next.length){const r=next[i++];if(r.state==='pending')continue;try{const token=await core.getToken(r.ticker,{blockTag});const protocol=P.forToken(r.ticker,{maxSupply:r.max_supply,mintAmount:r.mint_amount});r.supply=protocol.validateToken(token);r.state=r.supply===BigInt(r.max_supply)?'complete':'open';}catch(_){r.state='unavailable';r.supply=null;}}}));
   if(version!==generation)return;
   records=next;total=data.total;draw();
   const partial=next.some(r=>r.state==='unavailable');
   $('directoryStatus').textContent=partial?'Some chain reads are delayed. Refresh to retry.':!data.complete||!data.updatedAt?'Syncing deployment history…':'Ordered by on-chain deployment · refreshes every 20 seconds';
  }catch(error){if(version===generation)$('directoryStatus').textContent=error.message+'. Your selected mint still verifies its contract directly.';}
  finally{busy=false;$('refreshTokens').disabled=false;draw();if(again){again=false;refresh();}}
 }
 $('tokenSearch').addEventListener('input',()=>{clearTimeout(searchTimer);generation++;offset=0;searchTimer=setTimeout(refresh,300);});
 document.querySelectorAll('[data-filter]').forEach(button=>button.onclick=()=>{filter=button.dataset.filter;document.querySelectorAll('[data-filter]').forEach(item=>{item.classList.toggle('active',item===button);item.setAttribute('aria-pressed',String(item===button));});draw();});
 $('previousTokens').onclick=()=>{offset=Math.max(0,offset-24);generation++;refresh();};$('nextTokens').onclick=()=>{offset+=24;generation++;refresh();};
 $('refreshTokens').onclick=refresh;
 window.addEventListener('rh20:mint-state',event=>{const {ticker,token,verified}=event.detail;if(verified&&token){const r=records.find(item=>item.ticker===ticker);if(r){r.supply=BigInt(token.totalSupply);r.state=r.supply===BigInt(r.max_supply)?'complete':'open';draw();}}});
 async function tick(){if(!document.hidden)await refresh();clearTimeout(timer);timer=setTimeout(tick,20000);}
 document.addEventListener('visibilitychange',()=>{if(!document.hidden){clearTimeout(timer);tick();}});tick();
})();
