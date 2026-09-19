const BASES = [
  'https://api.mainnet.cipherscan.app/api',
  'https://cipherscan.app/api'
];

async function getJson(url, timeoutMs=8500) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      headers: { accept: 'application/json', 'user-agent': 'ZEC-BLOCKS/1.0' },
      signal: ac.signal
    });
    const text = await r.text();
    let data = null;
    try { data = JSON.parse(text); } catch {}
    if (!r.ok) throw new Error((data && data.error) || `HTTP ${r.status}`);
    return data ?? text;
  } finally {
    clearTimeout(t);
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  const kind = String(req.query.kind || 'health');
  const id = req.query.id != null ? String(req.query.id) : '';

  if (!['health','tx','block'].includes(kind)) {
    return res.status(400).json({ error: 'Unsupported kind' });
  }
  if ((kind === 'tx' || kind === 'block') && !id) {
    return res.status(400).json({ error: 'Missing id' });
  }

  const path = kind === 'health'
    ? '/info'
    : kind === 'tx'
      ? '/tx/' + encodeURIComponent(id)
      : '/block/' + encodeURIComponent(id);

  let lastError = null;
  for (const base of BASES) {
    try {
      const data = await getJson(base + path);
      return res.status(200).json({ ok: true, source: base, data });
    } catch (e) {
      lastError = e;
    }
  }
  return res.status(502).json({ error: lastError?.message || 'Chain-data providers unavailable' });
};
