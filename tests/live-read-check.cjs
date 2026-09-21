// Read-only production check. Never connects to a wallet, reserves a token or sends a transaction.
const assert = require('node:assert/strict');
const base = 'https://mine.zecblocks.xyz';
async function json(url, body) {
  const r = await fetch(base + url, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', 'cache-control': 'no-cache' },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(55000)
  });
  const j = await r.json();
  assert.equal(r.ok, true, JSON.stringify(j));
  assert.equal(j.ok, true, JSON.stringify(j));
  return j.data;
}
(async () => {
  let lastError;
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      const page = await fetch(base + '/?release-check=' + Date.now(), { signal: AbortSignal.timeout(15000) }).then(r => r.text());
      assert.match(page, /data-mining-layout="collection"/);
      assert.match(page, /id="confirmedClaimCount"/);
      assert.match(page, /id="claimProgressTrack"/);
      assert.match(page, /unique NFT IDs in claim history/);
      const [snapshot, zecs, live] = await Promise.all([
        json('/api/zb?op=rpc&name=zecblocks_mining_snapshot', {}),
        json('/api/zb?op=rpc&name=zecblocks_zb20_stats', {}),
        json('/api/zb?op=live-stats')
      ]);
      assert.ok(Number.isInteger(Number(snapshot.claims_seen)));
      assert.ok(Number(snapshot.claims_seen) >= 0 && Number(snapshot.claims_seen) <= 5000);
      assert.ok(Number.isInteger(Number(snapshot.verified_indexed)));
      assert.ok(Number(snapshot.verified_indexed) >= 0 && Number(snapshot.verified_indexed) <= 5000);
      assert.ok(Array.isArray(snapshot.clear_ids));
      assert.ok(Number.isFinite(Number(zecs.minted_supply)));
      assert.equal(live.ok, true);
      assert.ok(Number.isInteger(live.scan_cursor) && live.scan_cursor >= 1 && live.scan_cursor <= 5001);
      console.log(JSON.stringify({ live: base, claimsSeen: snapshot.claims_seen, confirmedClaims: snapshot.verified_indexed, clearCandidates: snapshot.clear_ids.length, scanCursor: live.scan_cursor, scanRound: live.scan_round, zecsMinted: zecs.minted_supply, zecsMintOpen: zecs.mint_open }));
      return;
    } catch (e) {
      lastError = e;
      if (attempt < 11) await new Promise(resolve => setTimeout(resolve, 15000));
    }
  }
  throw lastError;
})().catch(e => { console.error(e); process.exitCode = 1; });
