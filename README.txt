ZEC BLOCKS — MINING SITE

Deploy this folder as a SEPARATE Vercel project.
Custom domain:
https://mine.zecblocks.xyz

Keep api/zcash.js and vercel.json. The browser miner needs the same-origin /api/zcash proxy.

The site links back to the main marketplace:
https://www.zecblocks.xyz

ZEC BLOCKS MINING V3 — WEBGPU
- WebGPU SHA-256 GPU miner is now the default on supported browsers/devices.
- CPU Web Worker miner remains automatic fallback.
- Genesis TXID, source rule, preimage encoding, 26-bit difficulty, owner commitment, claim memo, treasury and supply are UNCHANGED.
- GPU candidates are re-hashed with WebCrypto on CPU before Submit Claim is enabled.
- GPU search uses low 32 bits of the valid uint64 nonce space; that range is 64x the 26-bit expected work.

Deploy the entire folder to mine.zecblocks.xyz.V4 AVAILABILITY GUARD
- Shows Claim Status for selected Token ID
- Blocks Start Mining when a known claim is detected
- Verifies a target-specific discovered claim's 26-bit PoW and checks its TXID for Zcash confirmation
- Find Unclaimed selects the next Token ID not present in current discovery state
- Shows known claimed / known unclaimed counts
- While mining, refreshes discovery every 12 seconds and stops if a competing claim appears
- Re-checks target immediately before Submit Claim
- Uses 4 independent Nostr relays for discovery redundancy
- Genesis, source rule, 26-bit PoW, and claim format are unchanged

IMPORTANT:
"Known unclaimed" means no claim is currently visible to this public discovery client.
The canonical ZB-1 result is still determined by valid confirmed Zcash protocol events.V5 GPU SELECTOR + DIAGNOSTICS
- Manual engine selector:
  * Auto (GPU preferred, CPU fallback)
  * GPU / WebGPU only
  * CPU Web Workers only
- Detect GPU button
- Visible GPU Status row with exact WebGPU failure reason
- GPU-only mode NEVER silently falls back to CPU
- Auto mode preserves fallback reason in the mining log
- Attempts to show WebGPU adapter/vendor information when browser exposes it
- Engine preference persists in localStorage
- Genesis TXID, source rule, SHA-256 preimage, 26-bit difficulty and claim rules are unchanged.

V6 GPU SHADER FIX
- Fixes Chrome/Edge WebGPU WGSL compile error:
  mixing `<<` and `|` requires parenthesis
- Explicit parentheses added to nonce byte packing.
- Rotate expression made explicit for strict WGSL parsing.
- CPU fallback log-prefix bug fixed.
- GPU-only mode still never silently falls back to CPU.
- GPU-found nonce is still verified with browser SHA-256 before Submit Claim is enabled.
- Genesis, 26-bit difficulty, source rule, availability guard, and claim format are unchanged.
