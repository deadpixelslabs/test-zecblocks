ZEC BLOCKS Mining V15 — Reserved Finder

Upload these files at the root of the mine.zecblocks.xyz project:
- index.html
- vercel.json
- api/zcash.js

V15 changes:
- Find Unclaimed performs a live multi-relay verification.
- The selected Token ID is atomically reserved for the connected Noir owner commitment.
- Reservation is revalidated while mining and before/after the fee step.
- Mining stops automatically if the token is no longer verified clear.
- Existing bound fee-credit / prevout parser fix is included.

IMPORTANT: After deployment the Mining header must visibly show:
V15 · RESERVED FINDER

If that badge is not visible, the old build is still being served.
