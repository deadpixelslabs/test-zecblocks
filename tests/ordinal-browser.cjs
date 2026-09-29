'use strict';
const {test,before,after,beforeEach,afterEach}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const {startChain}=require('./helpers/ordinal-chain.cjs');
const {serve}=require('./helpers/ordinal-server.cjs');
const P=require('../ordinal/protocol.js');
let chain,server,browser,snapshot;
const out=path.resolve(__dirname,'../test-artifacts');
before(async()=>{fs.mkdirSync(out,{recursive:true});chain=await startChain();server=await serve(chain);browser=await chromium.launch({headless:true});});
beforeEach(async()=>{snapshot=await chain.provider.send('evm_snapshot',[]);server.setPublished(true);server.setAddress(null);});
afterEach(async()=>{await chain.provider.send('evm_revert',[snapshot]);});
after(async()=>{if(browser)await browser.close();if(server)await server.close();if(chain)await chain.close();});
async function fixture({route='/ordinal.html',mobile=false,wallet=1}={}){
  const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1100}});
  await context.addInitScript(({account})=>{
    let current=account,chain='0x1237';const listeners={};window.__sendCount=0;window.__walletMode='normal';window.__release=false;
    window.__setAccount=value=>{current=value;for(const f of listeners.accountsChanged||[])f([value]);};
    window.ethereum={isMetaMask:true,on:(name,fn)=>{(listeners[name]||=[]).push(fn);},removeListener:(name,fn)=>{listeners[name]=(listeners[name]||[]).filter(x=>x!==fn);},request:async({method,params=[]})=>{
      if(method==='eth_accounts'||method==='eth_requestAccounts')return[current];if(method==='eth_chainId')return chain;
      if(method==='wallet_switchEthereumChain'){chain=params[0].chainId;for(const f of listeners.chainChanged||[])f(chain);return null;}if(method==='wallet_addEthereumChain')return null;
      if(method==='eth_sendTransaction'){window.__sendCount++;if(window.__walletMode==='reject')throw Object.assign(new Error('User rejected request'),{code:4001});if(window.__walletMode==='hold')while(!window.__release)await new Promise(r=>setTimeout(r,20));}
      const r=await fetch('/_fixture/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:101,method,params})});const json=await r.json();if(json.error)throw Object.assign(new Error(json.error.message),{code:json.error.code,data:json.error.data});
      if(method==='eth_sendTransaction'){window.__lastHash=json.result;if(window.__walletMode==='unresolved')throw new Error('Wallet disconnected after broadcast');}return json.result;
    }};
  },{account:chain.signers[wallet].address});
  const page=await context.newPage(),errors=[];page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
  await page.goto(server.url+route);await page.waitForFunction(()=>!document.querySelector('#status').textContent.startsWith('Loading'));
  return {context,page,errors};
}
async function ready(page){await page.locator('#connectButton').click();await page.waitForFunction(()=>document.querySelector('#mintButton').textContent==='Mint one Ordinal');}
test('unpublished collection shows the fixed fee and honest launch state without asking for funds',async()=>{
  server.setPublished(false);const {page,context,errors}=await fixture();try{assert.match(await page.locator('#status').innerText(),/preparing to launch/);assert(await page.locator('#mintButton').isDisabled());assert.match(await page.locator('.mint-price').innerText(),/0.00019/);assert.equal(await page.evaluate(()=>window.__sendCount),0);assert(await page.locator('#heroArt').evaluate(el=>el.complete&&el.naturalWidth>0));await page.screenshot({path:path.join(out,'ordinal-before-deployment.png'),fullPage:true});assert.deepEqual(errors,[]);}finally{await context.close();}
});
test('a browser mint pays once, receives one NFT and displays its exact on-chain SVG',async()=>{
  const {page,context,errors}=await fixture();try{await ready(page);await page.locator('#mintButton').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Mint confirmed'));assert.equal(await page.locator('#balance').innerText(),'1');assert.equal(await chain.core.ownerOf(1),chain.signers[1].address);assert.equal(await page.evaluate(()=>window.__sendCount),1);const hash=await page.evaluate(()=>window.__lastHash);assert.equal((await chain.provider.getTransaction(hash)).value,P.FEE);await page.waitForFunction(()=>document.querySelector('#ownedGrid img')?.naturalWidth>0);assert.match(await page.locator('#ownedGrid').innerText(),/Robinhood Ordinal #1/);await page.screenshot({path:path.join(out,'ordinal-mint-confirmed.png'),fullPage:true});await page.evaluate(account=>window.__setAccount(account),chain.signers[2].address);await page.waitForFunction(()=>document.querySelector('#balance').textContent==='0');assert.equal(await page.locator('#ownedGrid img').count(),0);assert.deepEqual(errors,[]);}finally{await context.close();}
});
test('an unknown broadcast survives reload and recovers without another protocol fee',async()=>{
  const {page,context,errors}=await fixture();try{await ready(page);await page.evaluate(()=>{window.__walletMode='unresolved';});await page.locator('#mintButton').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('unresolved'));const hash=await page.evaluate(()=>window.__lastHash);assert(await page.locator('#mintButton').isDisabled());assert.equal(await chain.core.totalSupply(),1n);await page.reload();await page.locator('#connectButton').click();await page.locator('#recovery').waitFor({state:'visible'});await page.locator('#transactionHash').fill(hash);await page.locator('#recoverHash').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Mint confirmed'));assert.equal(await page.evaluate(()=>window.__sendCount),0);assert.equal(await chain.core.totalSupply(),1n);assert.deepEqual(errors,[]);}finally{await context.close();}
});
test('wallet rejection clears the unsent intent and retains zero supply',async()=>{
  const {page,context}=await fixture();try{await ready(page);await page.evaluate(()=>{window.__walletMode='reject';});await page.locator('#mintButton').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('cancelled'));assert.equal(await page.locator('#recovery').isVisible(),false);assert.equal(await page.locator('#mintButton').isDisabled(),false);assert.equal(await chain.core.totalSupply(),0n);}finally{await context.close();}
});
test('storage failures prevent a paid wallet request',async()=>{
  const {page,context}=await fixture();try{await ready(page);await page.evaluate(()=>{Storage.prototype.setItem=function(){throw new Error('Storage denied');};});await page.locator('#mintButton').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Storage denied'));assert.equal(await page.evaluate(()=>window.__sendCount),0);assert.equal(await chain.core.totalSupply(),0n);}finally{await context.close();}
});
test('two tabs cannot submit the same wallet concurrently',async()=>{
  const {page,context}=await fixture();try{const other=await context.newPage();await other.goto(server.url+'/ordinal.html');await other.waitForFunction(()=>!document.querySelector('#status').textContent.startsWith('Loading'));await ready(page);await ready(other);await page.evaluate(()=>{window.__walletMode='hold';});await page.locator('#mintButton').click();await page.waitForFunction(()=>window.__sendCount===1);await other.waitForFunction(()=>document.querySelector('#mintButton').disabled);assert.equal(await other.evaluate(()=>window.__sendCount),0);await page.evaluate(()=>{window.__release=true;});await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Mint confirmed'));assert.equal(await chain.core.totalSupply(),1n);}finally{await context.close();}
});
test('wrong collection bytecode or a changed renderer disables minting',async()=>{
  server.setAddress(chain.signers[5].address);let f=await fixture();try{assert.match(await f.page.locator('#status').innerText(),/verification failed/i);assert(await f.page.locator('#mintButton').isDisabled());}finally{await f.context.close();}
  server.setAddress(null);await chain.provider.send('anvil_setCode',[await chain.core.renderer(),'0x00']);f=await fixture();try{assert.match(await f.page.locator('#status').innerText(),/renderer verification failed/i);assert(await f.page.locator('#mintButton').isDisabled());assert.equal(await f.page.evaluate(()=>window.__sendCount),0);}finally{await f.context.close();}
});
test('one deployment transaction creates collection and artwork, and reload does not redeploy',async()=>{
  server.setPublished(false);const {page,context,errors}=await fixture({route:'/ordinal-deploy.html',wallet:0});try{await page.locator('#deployButton').click();await page.locator('#deploymentReceipt').waitFor({state:'visible',timeout:30000});const address=await page.locator('#deployedAddress').innerText(),renderer=await page.locator('#rendererAddress').innerText();assert.match(address,/^0x[0-9a-fA-F]{40}$/);assert.equal(await chain.core.attach(address).renderer(),renderer);assert.equal(await page.evaluate(()=>window.__sendCount),1);await page.screenshot({path:path.join(out,'ordinal-deployment-receipt.png'),fullPage:true});await page.reload();await page.locator('#connectButton').click();await page.locator('#deploymentReceipt').waitFor({state:'visible'});assert.equal(await page.locator('#deployedAddress').innerText(),address);assert(await page.locator('#deployButton').isDisabled());assert.equal(await page.evaluate(()=>window.__sendCount),0);assert.deepEqual(errors,[]);}finally{await context.close();}
});
test('mobile layout, light theme and artwork selection are usable without overflow',async()=>{
  const {page,context,errors}=await fixture({mobile:true});try{assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.locator('[data-art]').nth(2).click();assert.match(await page.locator('#heroArt').getAttribute('src'),/03.svg/);await page.locator('#themeButton').click();assert.equal(await page.locator('html').getAttribute('data-theme'),'light');await page.screenshot({path:path.join(out,'ordinal-mobile-light.png'),fullPage:true});assert.deepEqual(errors,[]);}finally{await context.close();}
});
