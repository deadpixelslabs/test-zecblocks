ZEC BLOCKS MINING V12.1 — RPC RATE-LIMIT FIX

WHY
CipherScan was returning HTTP 429 Too Many Requests through /api/zcash.
The previous proxy and browser explicitly disabled caching, which multiplied
identical chain-data reads across users.

V12.1 FIXES
- Vercel CDN caching with short safe TTLs
- stale-while-revalidate
- warm-function memory cache
- concurrent request coalescing
- CipherScan 429 circuit breaker / exponential cooldown
- Retry-After support
- stale cached response fallback during temporary provider throttling
- browser request coalescing / short memoization
- browser no longer forces cache:'no-store'
- HTTP 429 is preserved as 429 rather than converted to 502

The V12 historical claim-index sweep, relay repair queue, live discovery and the
current paid-claim fee flow remain unchanged.

DEPLOY
Upload the whole ZIP to mine.zecblocks.xyz.
Do not keep an old Vercel /api/* Cache-Control:no-store override.
