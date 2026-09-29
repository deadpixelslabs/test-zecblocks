'use strict';
// Read-only verification of the published website. Never inject a signing wallet.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createHash}=require('node:crypto');const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),base='https://mine.zecblocks.xyz',config=require('../ordinal/mainnet.json');
const files=['ordinal.html','ordinal-deploy.html','ordinal/style.css','ordinal/app.js','ordinal/protocol.js','ordinal/mainnet.json','ordinal/RobinhoodOrdinal.json','ordinal/RobinhoodOrdinalRenderer.json','ordinal/compiler-input.json','ordinal/art/robinhood-ordinal-01.svg','contracts/ordinal/RobinhoodOrdinal.sol','contracts/ordinal/RobinhoodOrdinalRenderer.sol'];
const hash=b=>createHash('sha256').update(b).digest('hex');
(async()=>{
  let last;for(let attempt=0;attempt<12;attempt++){try{await Promise.all(files.map(async name=>{const r=await fetch(base+'/'+name+'?release-check='+Date.now(),{signal:AbortSignal.timeout(12000)});assert.equal(r.status,200,name);assert.equal(hash(Buffer.from(await r.arrayBuffer())),hash(fs.readFileSync(path.join(root,name))),'Published source differs: '+name);}));last=null;break;}catch(e){last=e;if(attempt<11)await new Promise(r=>setTimeout(r,10000));}}if(last)throw last;
  const browser=await chromium.launch({headless:true}),errors=[];const out=path.join(root,'test-artifacts');fs.mkdirSync(out,{recursive:true});
  try{const page=await browser.newPage({viewport:{width:1440,height:1100}});page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base+'/ordinal.html',{waitUntil:'networkidle'});await page.waitForFunction(()=>!document.querySelector('#status').textContent.startsWith('Loading'));
    assert.match(await page.locator('.mint-price').innerText(),/0.00019/);assert(await page.locator('#heroArt').evaluate(el=>el.complete&&el.naturalWidth>0));
    if(!config.contractAddress){assert(await page.locator('#mintButton').isDisabled());assert.match(await page.locator('#launchBadge').innerText(),/Coming soon/);}else{await page.waitForFunction(()=>/Mint open|Fully minted/.test(document.querySelector('#launchBadge').textContent));}
    await page.screenshot({path:path.join(out,'ordinal-production-mint.png'),fullPage:true});
    await page.goto(base+'/ordinal-deploy.html',{waitUntil:'networkidle'});await page.waitForFunction(()=>!document.querySelector('#status').textContent.startsWith('Loading'));assert.equal(await page.locator('#deployButton').isDisabled(),!!config.contractAddress);await page.screenshot({path:path.join(out,'ordinal-production-deploy.png'),fullPage:true});assert.deepEqual(errors,[]);
    console.log(JSON.stringify({live:base,verifiedFiles:files.length,contractAddress:config.contractAddress,maxSupply:5000,protocolFeeEth:'0.00019',walletMintLimit:null,readOnly:true,pagesVerified:2,pageErrors:0}));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
