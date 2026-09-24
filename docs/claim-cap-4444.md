# Current claim phase: 4,444 NFTs

Owner-approved update: current claiming and displayed supply are capped at 4,444 unique NFTs. Original IDs 1–5000 remain valid for artwork, ownership, recovery and trading. The remaining original allocation is reserved for a future ZSA public mint; this change does not activate ZSA, conversion or an admin mint.

The database allocates unique slots under a transaction advisory lock and a unique bounded slot number. Existing canonical ownership and unresolved prior claim history retain admission. Active mining reservations hold expiring slots; verified work with a signed claim intent secures a non-expiring slot before wallet payment. Ambiguous broadcasts are never assumed failed from a timeout. Pending admissions can temporarily pause new selection before the confirmed counter reaches 4,444.

Every canonical event, ownership, token and availability write is guarded. A previously admitted ID can settle, recover or change owner after the cap. The remaining slots are checked atomically by reservation RPCs; gallery statistics are informational. Service-only mutation grants and RLS protect the slot ledger. No holder record, settled trade, token ID, or ZECS rule is rewritten.

The lease endpoint verifies intent work against its canonical Zcash source before converting a temporary lease into a durable slot. The final wallet gate requires `slot_committed: true`. Ordinary page refreshes use the same existing counter/snapshot requests; no extra polling endpoint was introduced.

Validation: the actual migration runs in an isolated PostgreSQL 17 CI service, with 4,443 → 4,444 → rejection, duplicate IDs, higher legacy IDs, all four write guards, lease expiry/release, permissions, recovery at cap, and separate concurrent transactions competing for the last slot. Browser fixtures cover closed NFT controls, higher-ID selection, preserved recovery, an open ZECS mint and refusal before payment without committed capacity. Existing wallet/payment/privacy regressions remain enabled. Tests do not spend user funds.

Deployment order: apply `20260924234025_nft_claim_cap_4444.sql` transactionally, deploy `zecblocks-mining-lease` (including `capacity-proof.ts`) and `zecblocks-live-stats`, then publish the tested frontend. Preserve existing Edge authentication settings and service-role secrets. The marketplace update changes displayed supply and documentation, retaining the 5000-ID validation range and current refresh performance.
