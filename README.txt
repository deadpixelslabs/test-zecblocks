ZEC BLOCKS MINING V7 — CLAIM DISCOVERY FIX

This build fixes the false-green availability problem where a ZEC BLOCK could
already be claimed but Find Unclaimed / Load Target only saw an incomplete
relay cache.

Changes:
- Token input is no longer shown green before a real Load Target scan.
- Load Target performs a deeper multi-relay scan.
- Find Unclaimed refreshes discovery first and exact-checks the selected ID.
- Reads both the existing ZB-1 parameterized events and a new fallback Nostr
  kind for future claims.
- New claims are published to ALL configured relays, not only the first relay
  that acknowledges.
- New claims also publish a fallback discovery event for better propagation.
- A proof-bearing CLAIM_INTENT is published for 10 minutes before wallet
  broadcast, reducing two-miners-on-one-token races.
- Connected Noir Wallet history rebuilds valid old claims and periodically
  repairs their public discovery event.
- Mining watcher checks every ~8 seconds and stops when a claim or valid active
  claim intent appears.
- Includes api/zcash.js and vercel.json so the deployment package is complete.
- Genesis TXID, supply, source-block rule, SHA-256 preimage and 26-bit
  difficulty are unchanged.

IMPORTANT:
Public relay discovery is a cache/convenience layer, not Zcash consensus.
A shielded Zcash memo cannot be globally read by an ordinary public explorer
without a viewing-key scanner. V7 therefore removes misleading pre-check green
states and makes the current relay discovery much more redundant/self-healing,
but the canonical protocol result remains the first valid confirmed Zcash
claim under ZB-1 rules.
