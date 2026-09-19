ZEC BLOCKS MINING V11 — LIVE CLAIM DISCOVERY

WHY V11
Paid claim fee flow in V10 is retained unchanged.

The problem fixed here is the "KNOWN CLAIMS" counter and availability discovery
falling far behind while mining activity continues.

ROOT CAUSE
V10 did a global relay fetch on page load and manual actions, but it did not
continuously refresh the global claim feed. The 8-second mining watcher checks
the currently selected Token ID only. Therefore:
- the selected target could still be protected reasonably well;
- but the global Known Claims counter could stay stale for a long time;
- newly claimed tokens were not reflected globally until reload/manual refresh.

V11 LIVE DISCOVERY
1. Opens a live Nostr subscription to all 6 ZB-1 discovery relays.
2. Reads both:
   - kind 30078
   - kind 1 fallback used by claim publishing
3. Newly published claims are merged into runtime state immediately.
4. Known Claims updates after a ~150ms debounce when relay messages arrive.
5. A 10-second incremental backfill catches messages missed by WebSocket.
6. After the first full scan, backfills request only a recent overlap window.
7. Previously discovered events are retained in:
   - runtime S.events
   - session discovery cache
   - local wallet event history
   so incremental refreshes cannot make old claims disappear.
8. Returning to the browser tab triggers an immediate refresh.
9. "Known Claims" now shows a small LIVE / seconds-ago sync indicator.

CLAIM SAFETY
The existing selected-token deep availability check is retained.
The 8-second claim watcher is also retained while mining.

IMPORTANT
Known Claims remains the public ZB-1 discovery count. It is not a claim that a
normal explorer can enumerate every shielded memo globally. Canonical claim
validity still depends on the Zcash transaction and ZB-1 validation.

PAID CLAIM
V10's bound fee-credit / paid-claim logic is retained as-is.

DEPLOY
Upload every file in this ZIP to mine.zecblocks.xyz.
