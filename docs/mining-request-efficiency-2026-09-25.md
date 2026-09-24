# Mining request efficiency

Base: `deadpixelslabs/test-zecblocks` production main
`794c7ba1e80ad2d1dd5bff6751cbba3f3b18c8f7`.

The owner requested lower Vercel consumption while preserving normal operation
and performance. Only the mining/minting repository is in scope. Marketplace,
shared database functions, protocol rules, fees, mining difficulty and CPU/GPU
hashing are unchanged.

## What changed

- The existing public `GET /api/zb?op=live-stats` and a new public
  `GET /api/zb?op=zecs-stats` use a five-second CDN cache for validated successful
  responses. They return only shared statistics and forward no wallet input.
- Simultaneous public reads of the same counter share an in-flight upstream
  request within a function instance. There is no additional memory-cache TTL.
- `fresh=1` bypasses both public coalescing and the CDN cache. Existing POST RPC
  routes remain compatible and uncached. Errors and incomplete public data are
  not cached. Public responses have no stale-on-error policy.
- All account reads, availability snapshots, exact claim checks, reservations,
  mint preflight, lookups and registration continue to use `no-store`.
- A single 15-second presentation timer refreshes only the current view. NFT
  view reads NFT counters and availability; ZECS view reads NFT counters, ZECS
  counters and the connected account. Initial data is preloaded once.
- Presentation polling pauses while the tab is hidden. View changes and a return
  to the tab trigger immediate relevant fresh reads. Existing overlap guards
  remain in place.
- Pending ZECS recovery has an independent timer when the ZECS panel is hidden.
  It only checks existing TXIDs or signed registrations. Unknown attempts stay
  saved, and no new wallet transaction or signing prompt is started by a timer.
- Active mining lease/conflict checks and NFT recovery retain their existing
  cadence and safety gates. Relay subscriptions and repair remain in place.
- Explicit ZECS refreshes wait for an older public read before performing a
  fresh read. Account changes cannot reuse the previous account's pending read.
  Older timestamped counter responses cannot replace newer registration data.

## Expected request reduction

For a connected, idle tab, excluding startup, actions, recovery and relay repair:

| View | Previous reads per 15 seconds | New reads per 15 seconds |
| --- | ---: | ---: |
| NFT mining | 4 | 2 |
| ZECS | 4 | 3 |
| Hidden tab | 4 scheduled | 0 presentation reads |

This is a reduction in routine reads, not a promised percentage reduction in the
total bill. Browser background throttling, traffic, CDN hits, active miners,
transaction recovery and builds affect measured savings. Vercel settings and
paid observability subscriptions are not changed by this release.

## Validation

The existing CI gate runs syntax and checksum checks plus recovery, browser,
proxy, chain-cache and availability regressions. Added cases cover actual
scheduled callback request counts, tab/focus refreshes, hidden-tab recovery,
hidden-tab lease loss, fresh preflight rejection, cache isolation, upstream
failure retry, fresh-read ordering and account switches.

Production verification checks the deployed release markers, both public GET
counter routes, uncached reads, response cache policy and canonical availability.
Wallet fixtures are synthetic; checks do not spend user funds.

Reference: https://vercel.com/docs/caching/cache-control-headers
