'use strict';
const {test,before,after,beforeEach,afterEach}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const {startChain}=require('./helpers/rh20-chain.cjs'),{serve}=require('./helpers/rh20-server.cjs'),{pageFixture}=require('./helpers/rh20-wallet.cjs');
const P=require('../rh20/protocol.js'),V=P.forToken('VLAD');
let chain,server,browser,snapshot;const out=path.resolve(__dirname,'../test-artifacts');
before(async()=>{fs.mkdirSync(out,{recursive:true});chain=await startChain();server=await serve(chain);browser=await chromium.launch({headless:true});});
beforeEach(async()=>{snapshot=await chain.provider.send('evm_snapshot',[]);server.setPublished(true);server.setAddress(null);});
afterEach(async()=>{await chain.provider.send('evm_revert',[snapshot]);});
after(async()=>{if(browser)await browser.close();if(server)await server.close();if(chain)await chain.close();});
const fixture=opts=>pageFixture({chain,server,browser},opts);
async function registered(){await(await chain.core.inscribe(V.DEPLOY)).wait();}
async function fill(page,tick='CREW',max='1000',lim='10'){
 await page.locator('#deployTicker').fill(tick);await page.locator('#deploySupply').fill(max);await page.locator('#deployAmount').fill(lim);
 await page.waitForFunction(()=>!document.querySelector('#deployButton').disabled);
}
test('directory shows honest pending VLAD, deployment numbers, search and mobile theme',async()=>{
 const {page,context,errors}=await fixture({route:'/rh20.html',mobile:true});
 try{
  await page.waitForSelector('[data-token="RHSC"]');
  assert.equal(await page.locator('[data-token="RHSC"] .token-number').innerText(),'#1');
  assert.equal(await page.locator('[data-token="VLAD"] .token-number').innerText(),'—');
  assert.match(await page.locator('#launchBadge').innerText(),/Awaiting registration/);
  assert.equal(await page.locator('#mintButton').isDisabled(),true);
  assert.equal(await page.locator('#selectedAmount').innerText(),'40');
  assert.equal(await page.locator('#selectedLimit').innerText(),'Unlimited');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.locator('#themeButton').click();
  await page.screenshot({path:path.join(out,'rh20-directory-mobile.png'),fullPage:true});
  await page.locator('#tokenSearch').fill('RHSC');
  await page.waitForFunction(()=>document.querySelectorAll('#tokenRows tr').length===1);
  assert.deepEqual(errors,[]);
 }finally{await context.close();}
});
test('owner registers VLAD once in the original core and public mint opens at #2',async()=>{
 const {page,context,errors}=await fixture({route:'/vlad-deploy.html',wallet:0});
 try{
  await page.waitForFunction(()=>!document.querySelector('#deployButton').disabled);await page.locator('#deployButton').click();
  await page.locator('#deploymentReceipt').waitFor({state:'visible'});
  assert.equal(await page.locator('#deployedAddress').innerText(),await chain.core.getAddress());
  assert.equal((await chain.core.getToken('VLAD')).maxMintsPerWallet,0n);
  const hash=await page.locator('#deploymentTxLink').innerText();assert.equal((await chain.provider.getTransaction(hash)).to,await chain.core.getAddress());
  await page.reload();await page.locator('#connectButton').click();await page.locator('#deploymentReceipt').waitFor({state:'visible'});
  assert.equal(await page.locator('#deployButton').isDisabled(),true);assert.equal(await page.evaluate(()=>window.__sendCount),0);
  await page.goto(server.url+'/rh20.html?tick=VLAD');await page.waitForSelector('[data-token="VLAD"]');
  assert.equal(await page.locator('[data-token="VLAD"] .token-number').innerText(),'#2');
  await page.locator('#connectButton').click();await page.waitForFunction(()=>document.querySelector('#mintButton').textContent==='Mint 40 VLAD');
  await page.locator('#mintButton').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Mint confirmed'));
  assert.equal(await page.locator('#balance').innerText(),'40');assert.equal(await page.locator('#walletMints').innerText(),'1 / Unlimited');
  await page.screenshot({path:path.join(out,'rh20-vlad-mint-confirmed.png'),fullPage:true});assert.deepEqual(errors,[]);
 }finally{await context.close();}
});
test('community deployment opens after VLAD and a new ticker appears and mints with its own rules',async()=>{
 const {page,context,errors}=await fixture({route:'/rh20-deploy.html'});
 try{
  await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Community deployment opens'));
  assert.equal(await page.locator('#deployButton').isDisabled(),true);await registered();await page.reload();
  await page.waitForFunction(()=>!document.querySelector('#deployTicker').disabled);await fill(page);
  assert.equal(await page.locator('#payload').innerText(),JSON.stringify({p:'rh-20',op:'deploy',tick:'CREW',max:'1000',lim:'10'}));
  await page.locator('#deployButton').click();await page.locator('#deploymentReceipt').waitFor({state:'visible'});
  await page.screenshot({path:path.join(out,'rh20-community-deploy.png'),fullPage:true});
  await page.goto(server.url+'/rh20.html?tick=CREW');await page.waitForSelector('[data-token="CREW"]');
  assert.equal(await page.locator('[data-token="CREW"] .token-number').innerText(),'#3');
  assert.equal(await page.locator('#selectedAmount').innerText(),'10');
  await page.locator('#connectButton').click();await page.waitForFunction(()=>document.querySelector('#mintButton').textContent==='Mint 10 CREW');
  await page.locator('#mintButton').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Mint confirmed'));
  assert.equal(await chain.core.balanceOf('CREW',chain.signers[1].address),10n);assert.deepEqual(errors,[]);
 }finally{await context.close();}
});
test('ambiguous community registration survives reload and recovers without another transaction',async()=>{
 await registered();const {page,context}=await fixture({route:'/rh20-deploy.html'});
 try{
  await page.waitForFunction(()=>!document.querySelector('#deployTicker').disabled);await fill(page,'RECOVER','400','40');
  await page.evaluate(()=>window.__walletMode='unresolved');await page.locator('#deployButton').click();
  await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('unresolved'));const hash=await page.evaluate(()=>window.__lastHash);
  assert.equal(await page.locator('#deployTicker').isDisabled(),true);
  await page.reload();await page.locator('#connectButton').click();await page.locator('#recovery').waitFor({state:'visible'});
  assert.equal(await page.locator('#deployTicker').inputValue(),'RECOVER');
  await page.locator('#transactionHash').fill(hash);await page.locator('#recoverHash').click();await page.locator('#deploymentReceipt').waitFor({state:'visible'});
  assert.equal(await page.evaluate(()=>window.__sendCount),0);assert.equal((await chain.core.getToken('RECOVER')).totalSupply,0n);
 }finally{await context.close();}
});
test('invalid settings and duplicate ticker block deployment before a wallet send',async()=>{
 await registered();const {page,context}=await fixture({route:'/rh20-deploy.html'});
 try{
  await page.waitForFunction(()=>!document.querySelector('#deployTicker').disabled);
  await page.locator('#deployTicker').fill('BAD');await page.locator('#deploySupply').fill('101');await page.locator('#deployAmount').fill('40');
  assert.equal(await page.locator('#deployButton').isDisabled(),true);assert.match(await page.locator('#status').innerText(),/divide exactly/);
  await page.locator('#deployTicker').fill('VLAD');await page.locator('#deploySupply').fill('100000000');await page.locator('#deployAmount').fill('40');
  await page.waitForFunction(()=>document.querySelector('#deployButton').textContent==='VLAD registered');
  assert.equal(await page.locator('#deployButton').isDisabled(),true);assert.equal(await page.evaluate(()=>window.__sendCount),0);
 }finally{await context.close();}
});
test('unresolved VLAD mint cannot collide with an RHSC journal in the same registry',async()=>{
 await registered();const {page,context}=await fixture({route:'/rh20.html?tick=VLAD'});
 try{
  await page.locator('#connectButton').click();await page.waitForFunction(()=>document.querySelector('#mintButton').textContent==='Mint 40 VLAD');
  await page.evaluate(()=>window.__walletMode='unresolved');await page.locator('#mintButton').click();
  await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('unresolved'));const hash=await page.evaluate(()=>window.__lastHash);
  await page.goto(server.url+'/rhsc.html');await page.locator('#connectButton').click();await page.waitForFunction(()=>document.querySelector('#mintButton').textContent==='Mint 500 RHSC');
  assert.equal(await page.locator('#recovery').isVisible(),false);
  await page.goto(server.url+'/rh20.html?tick=VLAD');await page.locator('#connectButton').click();await page.locator('#recovery').waitFor({state:'visible'});
  await page.locator('#transactionHash').fill(hash);await page.locator('#recoverHash').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Mint confirmed'));
  assert.equal(await chain.core.mintCount('VLAD',chain.signers[1].address),1n);assert.equal(await page.evaluate(()=>window.__sendCount),0);
 }finally{await context.close();}
});
