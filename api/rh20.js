'use strict';
const config = require('../rh20/mainnet.json');
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const BLOCK = /^(latest|safe|finalized|pending|0x[0-9a-fA-F]+)$/;
function allowed(body) {
  if (!body || Array.isArray(body) || body.jsonrpc !== '2.0' || !Array.isArray(body.params)) return false;
  const { method, params } = body;
  if (['eth_chainId', 'eth_blockNumber'].includes(method)) return params.length === 0;
  if (['eth_getTransactionReceipt', 'eth_getTransactionByHash'].includes(method)) return params.length === 1 && HASH.test(params[0]);
  if (method === 'eth_getCode') return params.length === 2 && ADDRESS.test(params[0]) && params[0].toLowerCase() === config.contractAddress?.toLowerCase() && BLOCK.test(params[1]);
  if (method === 'eth_call') return params.length === 2 && params[0] && ADDRESS.test(params[0].to) && params[0].to.toLowerCase() === config.contractAddress?.toLowerCase() && /^0x[0-9a-fA-F]{8,2048}$/.test(params[0].data) && !params[0].value && !params[0].from && BLOCK.test(params[1]);
  return false;
}
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
  let body = req.body;
  try { if (typeof body === 'string') body = JSON.parse(body); } catch (_) { return res.status(400).json({ error: 'Invalid JSON' }); }
  if (JSON.stringify(body || '').length > 8192 || !allowed(body)) return res.status(400).json({ error: 'Unsupported read request' });
  const upstream = process.env.RH20_RPC_URL || config.rpcUrl;
  try {
    const response = await fetch(upstream, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(9000) });
    if (!response.ok) throw new Error('RPC unavailable');
    const data = await response.json();
    if (data?.jsonrpc !== '2.0' || data.id !== body.id || (!('result' in data) && !data.error)) throw new Error('Invalid RPC response');
    if (body.method === 'eth_chainId' && data.result && BigInt(data.result) !== 4663n) throw new Error('Wrong upstream chain');
    return res.status(200).json(data);
  } catch (_) { return res.status(503).json({ jsonrpc: '2.0', id: body.id ?? null, error: { code: -32005, message: 'Robinhood Chain reads are temporarily unavailable. Try again.' } }); }
};
module.exports.allowed = allowed;
