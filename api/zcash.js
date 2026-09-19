const BASES = [
  { id: 'cipherscan-api', base: 'https://api.mainnet.cipherscan.app/api' },
  { id: 'cipherscan-web', base: 'https://cipherscan.app/api' }
];

// Warm-function request coalescing / stale cache.
// Vercel may create multiple isolates, so the CDN cache headers below remain
// the primary cross-user protection. These maps still remove duplicate calls
// inside each warm isolate.
const G = globalThis;
const MEM = G.__ZEC_BLOCKS_CHAIN_CACHE__ || (G.__ZEC_BLOCKS_CHAIN_CACHE__ = new Map());
const INFLIGHT = G.__ZEC_BLOCKS_CHAIN_INFLIGHT__ || (G.__ZEC_BLOCKS_CHAIN_INFLIGHT__ = new Map());
const PROVIDER = G.__ZEC_BLOCKS_PROVIDER_STATE__ || (G.__ZEC_BLOCKS_PROVIDER_STATE__ = new Map());

const MAX_MEM_ENTRIES = 1200;

function now() { return Date.now(); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function providerState(id) {
  let s = PROVIDER.get(id);
  if (!s) {
    s = { cooldownUntil: 0, strikes: 0, lastStatus: 0 };
    PROVIDER.set(id, s);
  }
  return s;
}

function retryAfterMs(r) {
  const h = r.headers.get('retry-after');
  if (!h) return 0;
  if (/^\d+$/.test(h)) return Math.max(1000, Number(h) * 1000);
  const t = Date.parse(h);
  return Number.isFinite(t) ? Math.max(1000, t - now()) : 0;
}

function markFailure(provider, status) {
  const s = providerState(provider.id);
  s.lastStatus = Number(status || 0);
  if (status === 429) {
    s.strikes = Math.min(6, s.strikes + 1);
    // 15s, 30s, 60s, 120s... capped at 5 min.
    const backoff = Math.min(300000, 15000 * (2 ** (s.strikes - 1)));
    s.cooldownUntil = Math.max(s.cooldownUntil, now() + backoff);
  } else if (status >= 500 || status === 0) {
    s.strikes = Math.min(4, s.strikes + 1);
    s.cooldownUntil = Math.max(s.cooldownUntil, now() + Math.min(30000, 2500 * s.strikes));
  }
}

function markSuccess(provider) {
  const s = providerState(provider.id);
  s.strikes = 0;
  s.cooldownUntil = 0;
  s.lastStatus = 200;
}

function cachePolicy(kind, data) {
  // edge = Vercel CDN freshness; stale = CDN SWR + in-memory stale fallback.
  if (kind === 'health') return { edge: 12, stale: 90, mem: 8000 };
  if (kind === 'address') return { edge: 15, stale: 90, mem: 10000 };

  if (kind === 'tx') {
    const mined = !!deepFind(data, ['blockHeight','block_height','blockheight','height','mined']);
    return mined
      ? { edge: 15, stale: 180, mem: 12000 }
      : { edge: 5, stale: 30, mem: 3500 };
  }

  if (kind === 'block') return { edge: 30, stale: 600, mem: 25000 };
  return { edge: 10, stale: 60, mem: 7000 };
}

function setSuccessCacheHeaders(res, policy) {
  // Browser always revalidates; Vercel's CDN serves the shared cached copy.
  res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
  const v = `public, s-maxage=${policy.edge}, stale-while-revalidate=${policy.stale}`;
  res.setHeader('CDN-Cache-Control', v);
  res.setHeader('Vercel-CDN-Cache-Control', v);
}

function setErrorHeaders(res, seconds=5) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Retry-After', String(seconds));
}

function deepFind(obj, keys) {
  if (!obj || typeof obj !== 'object') return null;
  for (const k of keys) if (obj[k] != null) return obj[k];
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object') {
      const x = deepFind(v, keys);
      if (x != null) return x;
    }
  }
  return null;
}

function pruneMem() {
  if (MEM.size <= MAX_MEM_ENTRIES) return;
  const arr = [...MEM.entries()].sort((a,b)=>(a[1].usedAt||0)-(b[1].usedAt||0));
  for (const [k] of arr.slice(0, Math.ceil(arr.length * 0.2))) MEM.delete(k);
}

async function getJson(provider, path, timeoutMs=4200) {
  const state = providerState(provider.id);
  if (state.cooldownUntil > now()) {
    const e = new Error('provider cooling down after rate limit');
    e.code = 'COOLDOWN';
    e.status = state.lastStatus || 429;
    throw e;
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(provider.base + path, {
      headers: {
        accept: 'application/json',
        'user-agent': 'ZEC-BLOCKS/2.0'
      },
      signal: ac.signal
    });

    const text = await r.text();
    let data = null;
    try { data = JSON.parse(text); } catch {}

    if (!r.ok) {
      const err = new Error((data && (data.error || data.message)) || `HTTP ${r.status}`);
      err.status = r.status;
      err.retryAfter = retryAfterMs(r);
      if (r.status === 429 && err.retryAfter) {
        const s = providerState(provider.id);
        s.cooldownUntil = Math.max(s.cooldownUntil, now() + err.retryAfter);
      }
      markFailure(provider, r.status);
      throw err;
    }

    markSuccess(provider);
    return data ?? text;
  } catch (e) {
    if (e && e.name === 'AbortError') {
      const err = new Error('provider timeout');
      err.status = 0;
      markFailure(provider, 0);
      throw err;
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchUpstream(path) {
  let last = null;
  let saw429 = false;

  for (const provider of BASES) {
    const s = providerState(provider.id);
    if (s.cooldownUntil > now()) {
      if (s.lastStatus === 429) saw429 = true;
      continue;
    }
    try {
      const data = await getJson(provider, path);
      return { data, source: provider.base };
    } catch (e) {
      last = e;
      if (Number(e.status) === 429 || e.code === 'COOLDOWN') saw429 = true;
      // Do not retry the same provider immediately. Move to the next source.
    }
  }

  const e = last || new Error(saw429 ? 'Chain-data provider rate limited' : 'Chain-data providers unavailable');
  e.allRateLimited = saw429;
  throw e;
}

function cacheKey(kind, id, page, limit) {
  return [kind, id || '', page || '', limit || ''].join('|');
}

async function coalesced(key, path) {
  if (INFLIGHT.has(key)) return INFLIGHT.get(key);
  const job = fetchUpstream(path).finally(() => INFLIGHT.delete(key));
  INFLIGHT.set(key, job);
  return job;
}

module.exports = async function handler(req, res) {
  const kind = String(req.query.kind || 'health');
  const id = req.query.id != null ? String(req.query.id) : '';
  if (!['health','tx','block','address'].includes(kind)) {
    setErrorHeaders(res);
    return res.status(400).json({ error: 'Unsupported kind' });
  }
  if ((kind === 'tx' || kind === 'block' || kind === 'address') && !id) {
    setErrorHeaders(res);
    return res.status(400).json({ error: 'Missing id' });
  }

  const page = Math.max(1, Math.min(1000, Number(req.query.page || 1)));
  const limit = Math.max(1, Math.min(100, Number(req.query.limit || 100)));

  const path = kind === 'health' ? '/info'
    : kind === 'tx' ? '/tx/' + encodeURIComponent(id)
    : kind === 'block' ? '/block/' + encodeURIComponent(id)
    : '/address/' + encodeURIComponent(id) + '?page=' + page + '&limit=' + limit;

  const key = cacheKey(kind, id, page, limit);
  const cached = MEM.get(key);
  if (cached) cached.usedAt = now();

  // Warm-isolate fresh cache. Most cross-user hits should be handled earlier by
  // Vercel's CDN, but this also coalesces hot calls inside one function instance.
  if (cached && cached.freshUntil > now()) {
    setSuccessCacheHeaders(res, cached.policy);
    res.setHeader('X-ZEC-Cache', 'memory-hit');
    return res.status(200).json({
      ok: true,
      cached: true,
      source: cached.source,
      data: cached.data
    });
  }

  try {
    const result = await coalesced(key, path);
    const policy = cachePolicy(kind, result.data);
    MEM.set(key, {
      data: result.data,
      source: result.source,
      policy,
      freshUntil: now() + policy.mem,
      staleUntil: now() + policy.stale * 1000,
      usedAt: now()
    });
    pruneMem();

    setSuccessCacheHeaders(res, policy);
    res.setHeader('X-ZEC-Cache', cached ? 'refresh' : 'miss');
    return res.status(200).json({
      ok: true,
      cached: false,
      source: result.source,
      data: result.data
    });
  } catch (e) {
    // If CipherScan rate-limits us, a slightly old confirmed block/tx/address
    // response is much safer than generating thousands of 502s.
    if (cached && cached.staleUntil > now()) {
      setSuccessCacheHeaders(res, { edge: 5, stale: 30, mem: 3000 });
      res.setHeader('X-ZEC-Cache', 'stale-fallback');
      res.setHeader('Warning', '110 - "stale chain-data response served during upstream rate limit"');
      return res.status(200).json({
        ok: true,
        cached: true,
        stale: true,
        source: cached.source,
        warning: e?.message || 'upstream unavailable',
        data: cached.data
      });
    }

    const rateLimited = !!e?.allRateLimited || Number(e?.status) === 429;
    if (rateLimited) {
      setErrorHeaders(res, 15);
      return res.status(429).json({
        error: 'Chain-data provider is rate limited. Please retry shortly.',
        retryable: true
      });
    }

    setErrorHeaders(res, 5);
    return res.status(503).json({
      error: e?.message || 'Chain-data providers temporarily unavailable',
      retryable: true
    });
  }
};
