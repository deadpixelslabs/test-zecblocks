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

Deploy the entire folder to mine.zecblocks.xyz.
