ZEC BLOCKS — Mining Studio V16

This repository serves mine.zecblocks.xyz. The marketplace is a separate deployment.

Run locally on Vercel's Node runtime or deploy the root directory to Vercel.
The visible mining version is V16 · MINING STUDIO.

What changed
- Fixed the malformed public Supabase credential in api/zb.js that caused Invalid API key errors.
- Canonical totals come from the server; browser events never inflate Claims Seen.
- Stats and wallet startup no longer wait for GPU detection or the Nostr CDN.
- Find Unclaimed reserves a live-checked candidate; the new candidate browser supports selection and pagination.
- Mining actions are serialized; changing accounts invalidates the target and stops workers.
- CPU results are checked again with WebCrypto; late CPU/GPU results cannot replace a new run.
- NFT recovery locks and transaction receipts prevent accidental repeat submissions.
- ZECS registration persists the signed request and can retry registration without sending another mint.
- An ambiguous wallet result remains locked even when wallet history is temporarily empty.
- Responsive dark/light themes remember the user's preference.

Components and authentication
- index.html: wallet integration, mining workers/WebGPU, local proof verification, UI, relay discovery, recovery.
- api/zb.js: same-origin allowlisted gateway to canonical Supabase reads and Edge Functions.
- api/zcash.js: allowlisted public Zcash explorer proxy.
- Supabase: canonical availability, reservations, signature checks and confirmed-chain indexing.
- Noir Wallet: derived signing identity and transaction authorization. Seeds/private keys stay in Noir.
- Nostr: public discovery transport; it is not the canonical ownership authority.

Request flow
1. Noir returns a derived public key. SHA-256(public key) becomes the owner commitment.
2. The server checks relay quorum and atomically leases a clear Token ID to that commitment.
3. Browser CPU workers or WebGPU search for the protocol's 26-bit SHA-256 proof.
4. Before claim, the site verifies the proof and rechecks reservation and canonical availability.
5. Noir signs the intent and claim and asks the user to approve the Zcash anchor transaction.
6. The transaction ID is saved for recovery; canonical confirmation updates totals asynchronously.
ZECS uses the existing holder-gated ZB-20 mint protocol: one 210-ZECS mint anchor followed by signed registration.

Credentials and recovery
The bundled Supabase anon key is a public API credential, not a user login or service-role secret.
The gateway forwards it as apikey and Bearer authorization; only named RPC/Edge operations are allowed.
Optional server environment overrides: SUPABASE_URL and SUPABASE_ANON_KEY. Set them as a matching pair.
Never configure a service-role key as SUPABASE_ANON_KEY or put one in browser code.
Owner commitments are identifiers, not proof of identity by themselves. Backend signature and chain verification establish canonical events.
Local storage holds theme/engine preferences, public discovery cache, pending TXIDs, broadcast locks and signed ZECS registration requests scoped to owner commitment.
It also holds the existing Nostr discovery identity, separate from wallet keys.
A signed registration can be replayed for its same TXID; it does not authorize another wallet payment.
Keep recovery data until confirmation. Clearing browser storage during an unresolved broadcast removes that local recovery protection.
Connect the original wallet and use Recover Pending Claim or Recover Pending Mint after an interrupted response.
No site timer sends a wallet transaction automatically.

Current protocol settings
5,000 NFT supply; 26-bit NFT proof; 210 ZECS per mint; 21,000,000 ZECS cap.
Current NFT claimProtocolFeeEnabled=false is preserved: the UI shows zero protocol fee plus the wallet's network fee.
Mainnet wallet approvals, holder eligibility and four-relay availability quorum remain required.

Tests
npm install --no-save --package-lock=false playwright@1.55.1
npx playwright install --with-deps chromium
node --test tests/mining.test.cjs
node _syntax_check.js

GitHub Actions runs the regression suite and saves desktop/mobile screenshots as mining-ui.
Wallet and API fixtures are synthetic. Tests run real CPU hashing at lower fixture difficulty only; production remains 26 bits.
They do not spend real ZEC or prove a real Noir/mainnet transaction, hardware WebGPU performance, or external relay uptime.
