ZEC BLOCKS — Mining

This repository serves mine.zecblocks.xyz. The marketplace is a separate deployment.

ZECS mint recovery
- Continue Pending Mint checks saved TXIDs and signed registrations before querying Noir history. A slow or unavailable history response cannot block a known transaction.
- A registration-only journal also blocks a new payment and can be resumed with its saved signature. Every acknowledgement must match the exact TXID and owner before recovery data is removed.
- Confirmed and registered-pending mints are removed individually from the recovery queue. A failed registration or rejected signature retains the unresolved queue and does not strand other acknowledged mints.
- The button shows progress, individual results link to the existing transaction, and periodic statistics refreshes preserve the recovery error. Pending registration is not presented as blockchain confirmation.
- Automatic checks can reuse an already saved signature; they never open a signing prompt or send money. An explicit recovery click may request a missing registration signature, never a new payment.
- An unidentified broadcast remains protected if Noir provides no TXID. Recovering unrelated older mints does not prove that broadcast failed. Keep the original browser recovery data, unlock/sync Noir, and retry. The application does not unlock a wallet by assuming a payment failed.
- Verification: node --test tests/zecs-recovery.test.cjs plus browser scenarios in tests/mining.test.cjs. Fixtures do not prove a particular user's chain transaction.

Run locally on Vercel's Node runtime or deploy the root directory to Vercel.
Release identifiers are kept internal and are not displayed in the public mining UI.

Pending NFT claims
- Continue Pending Claim checks the whole saved queue, with two independent checks at a time and visible per-NFT results. Known transaction IDs are checked first. Repeated clicks join the current work rather than starting duplicate submissions.
- Recovery checks canonical settlement before reading wallet history or registering an event. An already confirmed NFT resolves even if Noir has not returned its transaction ID. This confirms the NFT has a canonical claim; Portfolio determines ownership.
- Unsettled transactions backfill only their exact saved event, then request an audit and recheck confirmation. Verifier errors and unavailable wallet history are shown explicitly.
- Each claim check has a 60-second deadline. A timeout releases the button and preserves the journal; late responses cannot update a different wallet or finish an expired check. Automatic retries are spaced by at least 60 seconds per claim, and manual retry is available immediately.
- If no matching transaction ID is available, check Noir transaction history. The saved proof is retained, and only that NFT remains protected from duplicate submission. Empty history or an available NFT is not proof that a broadcast failed. Recovery never sends another transaction or asks for another signature.

Claim counts and audit queue
- Claims seen is displayed in the main collection statistics with a progress bar and percentage of the 5,000 NFT IDs encountered. It refreshes from server statistics, including when the user is not connected to a wallet; the count is never hardcoded.
- Confirmed claims is displayed separately below the main statistics and counts canonical NFT IDs after protocol and Zcash confirmation checks. Completing proof search or broadcasting alone does not increase it.
- Mining settings & details explains that Claims seen is a historical count including invalid/unconfirmed attempts. A later valid claim for an already observed ID can increase Confirmed claims without increasing Claims seen.
- The historical counter and ownership validation rules are unchanged. The frontend does not count local mining attempts as successful claims.
- Statistics refresh every 15 seconds while the page is active, and when the tab becomes visible again. Background availability and claim-audit jobs run independently of open browsers.
- Scan progress comes only from the live-stats endpoint. The public mining snapshot cannot read private indexer state under RLS and returns a default cursor of 1; that fallback must not overwrite real progress. Until live scanner state arrives, the UI shows Checking scan progress. A genuine new scan pass may restart at 0% without resetting claim totals.
- supabase/migrations/20260921214901_fair_claim_audit_queue.sql fixes audit starvation: the least recently updated outstanding transaction is selected first. Failed audits update their timestamp and move behind older work. Payload ranking, deduplication, batch limits and existing service-role-only grants are preserved.
- Relay duplicates of an already finalized transaction are excluded from automatic re-auditing. This protects existing confirmed claims without marking any unverified claim valid.

Mining interface
- Charcoal/champagne and ivory themes; no public release labels.
- NFT mining and ZECS minting use separate accessible tabs. #mining and #zecs remain shareable; changing tabs never restarts mining or sends a transaction.
- The main action follows wallet connection, NFT selection, proof search and claim approval. Pending claims remain visible with recovery controls.
- The six-item gallery renders previews from the same source block hash, height and artwork renderer as the selected NFT. Browsing never reserves an NFT. Selection still uses the canonical live availability and lease checks.
- Gallery search filters the server's available candidates. Surprise Me selects a candidate and checks it before mining. Pending local claims are excluded.
- Artwork reads use a two-worker queue with a bounded memory cache; stale responses cannot paint a new page of candidates. A failed preview does not change availability or block selection.
- Mining settings, source identifiers and diagnostics are collapsed. Proof search uses an indeterminate animation because it has no guaranteed completion time.
- Reduced-motion settings, visible keyboard focus, arrow-key tab navigation and persistent light/dark preferences are supported.

What changed in V16.1.1
- Public page loads no longer start the heavy availability scan. Existing server cron owns that job; exact target checks and recovery ingestion remain active.
- Fixed false ZECS recovery for wallets with more than 50 mint transactions: every lookup is batched to the backend limit, with no history truncation.
- Existing confirmed/pending registrations resolve known-TXID locks without another wallet signature or payment.
- NFT recovery is now scoped to each Token ID. Older pending claims are migrated into a durable queue; a different block can still be mined and claimed.
- Recovery backfills the exact NFT event instead of waiting behind a full historical scan. Confirmation runs in the background.
- Bounded wallet reads/approvals and GPU operations prevent indefinite busy states; late broadcast results are saved for the original wallet.
- Only explicit wallet rejection/funding failure removes a pre-broadcast lock. Ambiguous transport errors retain recovery.

V16 improvements retained
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
NFT recovery queue: zb1_claim_recoveries_v2_<owner>. The old zb1_free_claim_recovery_v1_<owner> record is merged before writing/removing the legacy key; pending records are never evicted.
An unresolved NFT claim still protects that same Token ID. Choose a different ID to continue. A confirmed canonical result releases its recovery record without assuming this wallet won ownership.
A ZECS broadcast with no TXID and no matching history remains protected: empty history does not prove that no payment occurred. Known-TXID/discovery locks are checked against server registration automatically.
Recover Mint registers at most 12 missing transactions per click and retains remaining TXIDs through partial failures.
Wallet history reads time out after 10 seconds; wallet approval responses after 120 seconds. An approval timeout never resends a transaction. Check the Noir prompt before starting another wallet operation.

Current protocol settings
5,000 NFT supply; 26-bit NFT proof; 210 ZECS per mint; 21,000,000 ZECS cap.
Current NFT claimProtocolFeeEnabled=false is preserved: the UI shows zero protocol fee plus the wallet's network fee.
Mainnet wallet approvals, holder eligibility and four-relay availability quorum remain required.

Tests
npm install --no-save --package-lock=false playwright@1.55.1
npx playwright install --with-deps chromium
node --test tests/mining.test.cjs
node _syntax_check.js

Queue regression: node tests/claim-audit-queue.cjs emits a read-only PostgreSQL SELECT built from the migration. Execute it in the SQL editor; all four returned checks must be true. The fixtures reproduce 35 failing retries blocking older claims and cover richer payload selection, batch limits and finalized duplicate protection.

GitHub Actions runs the regression suite and saves desktop/mobile screenshots as mining-ui.
Wallet and API fixtures are synthetic. Tests run real CPU hashing at lower fixture difficulty only; production remains 26 bits.
They do not spend real ZEC or prove a real Noir/mainnet transaction, hardware WebGPU performance, or external relay uptime.

Production check: node tests/live-read-check.cjs performs read-only deployment/API checks. The main workflow runs it after regression tests; it never opens a wallet or reserves a token.
