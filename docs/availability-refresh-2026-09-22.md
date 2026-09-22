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
