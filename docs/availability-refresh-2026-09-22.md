# Mining availability refresh

The gallery and claim counters previously shared one response timestamp. A newer counter response could reject a subsequent collection snapshot even though the counter response did not contain any NFT IDs. An exact single-token check also marked the entire collection snapshot as fresh. Together these could delay visible gallery updates.

The public RPC ran as anon. RLS correctly hid private event rows from this role, so its claim-candidate query could not account for those rows. The availability projection now runs through the existing server-side live-stats service with a fixed `view=availability` route. It returns only NFT IDs, counters and scan metadata. No event payloads, wallet information or service credentials are returned; database policies and function execution privileges are unchanged.

The SQL projection includes unresolved client-backfill claims, historical claim/ownership guards and active verified intents. It removes those IDs from clear results at read time, even if a slower scanner still reports clear. This is discovery data, not spending authorization: reservations and exact quorum checks remain mandatory.

The browser tracks gallery and counter freshness independently, retains exact claimed/pending results across delayed snapshots, removes rejected selections, and stops active mining when a claim is discovered. A transient pending ID can become available again after an explicit complete clear check; confirmed IDs remain blocked for the session. A failed fresh check cannot fall back to a cached reservation. A final reservation check after signing blocks payment if the token changed while the wallet prompt was open.

## Verification

- Added browser regressions for response ordering, pending and claimed snapshots, rejected selection, interrupted mining and competition during wallet signing.
- Added proxy/endpoint tests for the public server projection and incomplete reads.
- `tests/availability-snapshot.sql` checks the actual database projection for overlaps with claims, ownership history and active intents, plus omitted pending client submissions. It performs no writes.
- `tests/live-read-check.cjs` verifies the deployed frontend and checks that clear IDs and blocked IDs are disjoint.

At investigation time, NFT #825's claim `826bea9ef3d372fbff565827e006293b293b721c63530c1a470ac0ee78b4cf19` was protocol-audited and confirmed at height 3492486. Its screenshot showed a pending UI state rather than a failed claim. This finding does not establish the outcome of unrelated claims without their transaction evidence. No user transaction was sent as part of this fix.

## Browser freshness and duplicate-payment follow-up

A read-only check of production found #847 and #2427 confirmed for the reporting wallet and excluded from clear IDs. #814 initially had a new transaction awaiting chain-provider visibility and was subsequently confirmed for the same wallet during this investigation. Old invalid-signature attempts for the other displayed IDs do not establish NFT ownership. Claims seen is historical and can remain unchanged when a previously observed ID obtains its first valid claim.

The browser now pauses gallery selection after a failed snapshot or after 30 seconds without a successful refresh. Cached cards say Checking instead of Available until the next fresh snapshot. Refresh waits for an in-flight snapshot instead of returning early.

Confirmed IDs are retained locally per collection and shared across tabs. An exact clear request started before a newer pending/claimed observation cannot erase that observation. The transient pending case can still return to clear after a subsequent complete check. Saving a pre-broadcast recovery record removes its card immediately; other same-origin tabs receive storage updates. Confirmed cache writes never change server ownership or counts.

An origin-wide Web Lock serializes claims for the same NFT across tabs. Immediately before payment, the browser checks the recovery journal again and forces a new lease validation after any earlier lease check finishes. Missing Web Locks support stops claim submission with a browser update message. No signatures, keys, token rules or settlement behavior are changed.

Tests cover stale/failed refreshes, delayed clear replies, confirmed IDs after reload/account changes, storage events between real tabs, competing claim locks, and a stale lease check during signing. Simulations do not send real funds. These guards cannot guarantee that a competing transaction is never broadcast by an unrelated client outside the reservation system, or establish the outcome of a transaction the chain provider has not returned.
