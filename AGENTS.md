# ZEC BLOCKS — repository routing and update continuity

Owner-confirmed instructions, 24 September 2026. Apply throughout this repository.

## Authoritative production repositories

| Repository | Responsibility | Production branch |
| --- | --- | --- |
| `deadpixelslabs/ZEC-BLOCKS` | Main website and marketplace: NFT/ZECS listings, trading, activity, portfolio, receiving and transfers | `main` |
| `deadpixelslabs/test-zecblocks` | Mining and minting website at `https://mine.zecblocks.xyz/`: NFT mining/claims and ZECS mint/recovery | `main` |

The owner explicitly confirmed that BOTH repositories are production components.
This mapping supersedes older blanket notes that treated `test-zecblocks` as
non-production or routed all changes exclusively to `ZEC-BLOCKS`.
Choose the repository by the affected feature. A ZECS mint fix belongs in
`test-zecblocks`; a ZECS marketplace fix belongs in `ZEC-BLOCKS`.
Shared backend changes require checking the affected flows in both applications.

## Continue from the latest state

1. Read this file, the repository's existing contribution/operations instructions,
   and the latest remote `main` commit and relevant files before editing.
2. Start from that current `main`, preserving later commits and uncommitted work.
   Never rebuild from an old conversation, ZIP, local snapshot or remembered SHA.
3. Use earlier conversations for user decisions and constraints. Verify current
   implementation, deployment and backend state against their live sources.
4. Keep changes focused on the requested feature and preserve previous fixes.
   If remote `main` moves during work, incorporate and review the newer changes
   before merging; do not force-push over them.
5. Run the relevant existing checks and transaction/recovery regressions when
   behavior changes. Use isolated wallet fixtures; tests must not spend user funds.
   After a deployed code change, verify the affected live site and distinguish
   merged, deployed, tested and still-unresolved states in the report.
6. Record the resulting commit and meaningful validation in the commit/PR or
   relevant project documentation so the next conversation can continue.

These are continuity rules, not a freeze on development. The checkpoints below
are historical reference points; **the latest remote main always takes precedence
as the code base for the next authorized update**.

## Last functional checkpoints when this lock was established

- Main site/marketplace:
  `228dd1b82f33f3ce7612bd9e6120715bde4f5dc0` — hide seller identities from
  NFT/ZECS listings on ZEC and USDC. Preserve public activity identity hiding,
  canonical ownership, portfolio consistency, payment recovery and address proofs.
- Mining/minting:
  `847a80718f072eeae369142c71a5fdfb64a852ad` — repair ZECS mint history
  filtering and unidentified broadcast recovery (PR #8). Failed/incoming history
  does not block a fresh mint; saved TXIDs/signatures recover independently of
  wallet history; uncertain broadcasts retain their recovery journal and can be
  resolved using a user-confirmed outgoing TXID without another payment.
  90 CI tests passed and the deployed HTML matched the tested source.
  See `docs/zecs-mint-recovery-2026-09-24.md` in the mining repository.

## Preserve established project rules

- Current ZEC BLOCKS claim limit/displayed supply: 4,444 unique NFTs (owner update, 25 September 2026). Legacy token IDs remain 1–5000; never filter, renumber or remove existing higher IDs. The remaining original allocation is reserved for future ZSA public mint. Preserve canonical ownership/claim verification
  and confirmed settlement finality. Indexer data is derived state, not permission
  to override chain evidence.
- ZECS: exactly 210 per valid mint, maximum 21,000,000 (100,000 successful events),
  whole-token amounts, current verified ZEC BLOCKS holder eligibility, no premine,
  team allocation or admin mint. Mint is free; network transaction costs apply.
- Canonical mint memo:
  `{"p":"zb-20","op":"mint","tick":"ZECS","amt":"210"}`.
  Registration remains separately signed and bound to the exact transaction ID.
- Never treat an explorer 404, unavailable history or timeout as proof that an
  earlier payment failed. Recovery checks/registers existing transactions and
  must not silently send a second payment or clear ambiguous broadcasts.
- Preserve existing marketplace rails: native ZEC NFT/ZECS purchases use 0%
  protocol fee and Base USDC uses 3% protocol fee, unless the owner requests a
  deliberate rule change.
- Retain the latest user-approved privacy changes. Public marketplace listings
  and Activity must not reintroduce seller/participant IDs through UI text,
  tooltips or render attributes.
