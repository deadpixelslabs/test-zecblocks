ZEC BLOCKS LIVE V2 - MINING FETCH FIX

IMPORTANT: Upload the WHOLE folder structure, not index.html alone.

Required files:
  index.html
  api/zcash.js
  vercel.json

Why: public Zcash explorer APIs restrict browser CORS. V2 sends block/tx lookups through a same-origin Vercel Function at /api/zcash, then falls back between CipherScan and Zexplorer. Noir Wallet still signs/sends transactions locally.

After deploy:
1. Open https://YOUR-DOMAIN/api/zcash?kind=health -> should return JSON ok:true.
2. Connect Noir Wallet.
3. Enter token ID.
4. Start Mining directly (Load Target is optional now).
