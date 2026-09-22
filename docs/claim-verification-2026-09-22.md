# Mining claim verification, 22 September 2026

## Confirmed findings

- NFT 1131: transaction `71f5336e6e849bcdba333a2f1d50783506b5794d47ef1485e864fe5695986ec6`, Zcash block 3492232.
- NFT 1285: transaction `5733227774ce0241edf059919bbd2dc1463552205dcd42f5d8c5371081ca0647`, Zcash block 3492233.
- Both passed the deployed claim verifier and appear in canonical ownership for the reporting wallet. Both IDs had older invalid attempts; therefore their successful claims do not increase the historical unique-ID counter, Claims seen. Confirmed claims is the separate count of successfully verified NFT IDs.
- The first 50 NFT IDs have 2,007 persisted claim/intent rows. The scanner and exact checker read one unpaginated PostgREST result. Its 1,000-row limit omitted relevant claims. The collection-wide comparison found 31 verified IDs incorrectly marked clear.

## Changes

- Classify all database history in SQL, returning at most one canonical claim, one unresolved claim and one active intent per ID. Fifty IDs produce at most 150 rows, independent of historical row count.
- Guard availability writes against downgrading an NFT with verified evidence. Repair only classifications contradicted by existing verified events; do not create ownership or change historical claims.
- Return the canonical TXID to recovery so it distinguishes a successful saved transaction from a competing transaction. Explain why Claims seen can stay unchanged after success.
- Register each freshly broadcast claim directly, bypassing historical backfill throttling and the first-40-record batch. Retain the exact proof and TXID on timeouts; recovery never resends payment.
- Bound chain caches, do not cache unconfirmed transactions, and expire confirmed responses. Treat provider 404s as unresolved, not proof of failure. Clear stale verification errors on successful audits.
- Respect finalized logical transactions when a later relay duplicate enters token-scoped recovery.

## Verification

The SQL full-collection comparison covers all 5,000 IDs. At the initial check, all 2,962 verified IDs were returned and zero remained falsely clear after repair. The stale-write test runs inside a transaction and rolls back. The new read RPC is executable by service_role, not anon/authenticated. Existing RLS policies are unchanged.

Browser regression tests cover finding/mining, one broadcast despite repeated clicks, busy historical backfill, exact-TXID registration, pending confirmation, late confirmation, competing canonical TXIDs, timeouts, missing wallet history, wallet changes, and counters that refresh independently. Wallets and network services are mocked; these tests send no mainnet transactions. Separate tests exercise chain-cache expiry and 404-to-confirmed recovery.

## Outstanding historical records

The collection-wide audit found 42 distinct unresolved claim transactions, excluding relay duplicates of already verified transactions. Direct chain-provider reads returned 404 for 37, and confirmed transactions for five. Those five remain deferred because the legacy reservation evidence is missing. These are transaction counts, not counts of affected wallets. A provider 404 alone does not prove a transaction never existed; confirmation alone does not replace a missing protocol proof. None are force-marked valid or automatically rebroadcast.

All claims without a TXID in a user's local wallet journal require wallet-history evidence; server-wide checks cannot enumerate journals that never reached the server. The reporting wallet's 3874 recovery remains unresolved for this reason.

## Deployment order

1. Apply `20260922120000_complete_claim_classification.sql`.
2. Run `tests/claim-classification.sql` and verify role permissions.
3. Deploy check-claims, availability-scan and claim-audit Edge Functions from this repository.
4. Run browser/chain-cache checks before publishing the frontend.
5. Verify public live stats, claimed IDs and canonical TXID responses after deployment.

Keep the RPC and availability guard during a frontend rollback. Do not restore a scanner that relies on an unpaginated event list. Protocol anchor proposals are separate from this incident fix.
