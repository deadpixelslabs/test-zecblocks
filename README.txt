ZEC BLOCKS MINING V12 — CLAIM INDEX SWEEP

WHAT V12 FIXES
V11 was fast for NEW claims, but historical Known Claims could remain far behind
because broad relay queries can omit old records due to result caps, pagination,
tag-index quirks, pruning, or temporary relay failures.

V12 adds an exact historical index across Token IDs 1..5000.

HOW IT WORKS
Every ZB-1 discovery event is tagged:
  i = zb1-token:<TOKEN_ID>

V12 queries those exact token tags in batches of 50 across all configured relays.
It reads kind 30078 + kind 1 fallback and merges results with live discovery.

The sweep:
- starts automatically after normal startup sync;
- uses two conservative workers;
- resumes from its saved cursor after reload;
- repeats every 6 hours;
- keeps a compact durable set of discovered claim Token IDs;
- prevents Known Claims from decreasing when a relay temporarily omits history.

FUTURE CLAIM RELIABILITY
New CLAIM publication now has a discovery acknowledgement target.
If fewer than 3 relay acknowledgements are received, the CLAIM enters a durable
repair queue and is retried every 30 seconds.

WALLET REPAIR
Existing Noir wallet-history repair remains enabled. When a claimant reconnects,
a valid historical claim can be rebuilt and republished to discovery.

IMPORTANT LIMIT
V12 is substantially more complete and stable, but a browser cannot magically
enumerate a historical shielded memo that was never published to any relay and
is not available from a connected wallet history.

Canonical validity for a specific Token ID still uses the deep target check and
Zcash transaction validation before mining/claiming.

The current bound paid-claim fee flow is unchanged.

DEPLOY
Upload every file in this ZIP to mine.zecblocks.xyz.
Leave the page open until the historical index sweep reaches 100%.
