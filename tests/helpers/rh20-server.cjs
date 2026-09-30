'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const config = require('../../rh20/mainnet.json');
const originalConfig = { ...config };
const vlad = require('../../rh20/vlad.json'), originalVLAD = { ...vlad };
const api = require('../../api/rh20.js');
async function serve(chain) {
  let published = true;
  let overrideAddress = null;
  const address = await chain.core.getAddress();
  const oldRPC = process.env.RH20_RPC_URL;
  process.env.RH20_RPC_URL = chain.url;
  const configured = () => ({ ...originalConfig, contractAddress: published ? overrideAddress || address : null, deploymentTxHash: published ? chain.receipt.hash : null, deploymentBlock: published ? chain.receipt.blockNumber : null });
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      res.setHeader('Cache-Control', 'no-store');
      if (url.pathname === '/rh20/vlad.json') { res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({ ...originalVLAD, contractAddress: configured().contractAddress, deploymentTxHash: configured().deploymentTxHash, deploymentBlock: configured().deploymentBlock })); return; }
      if (url.pathname === '/api/rh20-tokens') {
        const logs = await chain.core.queryFilter(chain.core.filters.TokenDeployed());
        const all = logs.sort((a,b)=>a.blockNumber-b.blockNumber||a.index-b.index).map((log,i)=>({ ordinal:i+1,ticker:log.args.tick,max_supply:String(log.args.maxSupply),mint_amount:String(log.args.mintAmount),wallet_limit:Number(log.args.maxMintsPerWallet),block_number:log.blockNumber,tx_hash:log.transactionHash }));
        const q=url.searchParams.get('q')||'',offset=Number(url.searchParams.get('offset')||0),matched=all.filter(item=>item.ticker.includes(q));
        res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({tokens:matched.slice(offset,offset+24),total:matched.length,complete:true,updatedAt:new Date().toISOString()}));return;
      }
      if (url.pathname === '/rh20/mainnet.json') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(configured())); return; }
      if (url.pathname === '/_fixture/rpc' || url.pathname === '/api/rh20') {
        let raw = ''; for await (const part of req) raw += part;
        req.body = JSON.parse(raw);
        if (url.pathname === '/_fixture/rpc') {
          const upstream = await fetch(chain.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: raw });
          res.setHeader('Content-Type', 'application/json'); res.end(await upstream.text()); return;
        }
        Object.assign(config, configured());
        res.status = code => { res.statusCode = code; return res; };
        res.json = data => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)); };
        await api(req, res); return;
      }
      const file = path.resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
      if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
      const mime = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml' };
      res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
      res.end(await fs.promises.readFile(file));
    } catch (error) { res.statusCode = error.code === 'ENOENT' ? 404 : 500; res.end(String(error.message)); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { url: 'http://127.0.0.1:' + server.address().port, setPublished: value => { published = value; }, setAddress: value => { overrideAddress = value; }, close: async () => { Object.assign(config, originalConfig); if (oldRPC === undefined) delete process.env.RH20_RPC_URL; else process.env.RH20_RPC_URL = oldRPC; await new Promise(resolve => server.close(resolve)); } };
}
module.exports = { serve };
