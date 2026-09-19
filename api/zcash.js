const UPSTREAMS = [
  {
    name: 'cipherscan',
    tx: id => `https://api.mainnet.cipherscan.app/api/tx/${id}`,
    block: id => `https://api.mainnet.cipherscan.app/api/block/${id}`,
  },
  {
    name: 'zexplorer',
    tx: id => `https://zexplorer.app/api/v1/mainnet/transactions/${id}`,
    block: id => `https://zexplorer.app/api/v1/mainnet/blocks/${id}`,
  },
];

function validTxid(v){ return /^[0-9a-fA-F]{64}$/.test(v || ''); }
function validHeight(v){ return /^\d{1,8}$/.test(v || '') && Number(v) > 0; }

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const kind = String(req.query.kind || '');
  const id = String(req.query.id || '');
  if (kind === 'health') return res.status(200).json({ ok: true, network: 'zcash-mainnet' });
  if (kind === 'tx' && !validTxid(id)) return res.status(400).json({ error: 'Invalid txid' });
  if (kind === 'block' && !validHeight(id)) return res.status(400).json({ error: 'Invalid block height' });
  if (kind !== 'tx' && kind !== 'block') return res.status(400).json({ error: 'kind must be tx or block' });

  const errors = [];
  for (const upstream of UPSTREAMS) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 9000);
      const url = upstream[kind](id);
      const r = await fetch(url, {
        headers: { 'accept': 'application/json', 'user-agent': 'ZEC-BLOCKS-ZB1/1.0' },
        signal: controller.signal,
      });
      clearTimeout(timer);
      const text = await r.text();
      if (!r.ok) { errors.push(`${upstream.name}:${r.status}`); continue; }
      let data;
      try { data = JSON.parse(text); } catch { errors.push(`${upstream.name}:bad-json`); continue; }
      return res.status(200).json({ ok: true, source: upstream.name, data });
    } catch (e) {
      errors.push(`${upstream.name}:${e?.name || 'fetch-failed'}`);
    }
  }
  return res.status(502).json({ error: 'All public Zcash data sources failed', details: errors });
}
