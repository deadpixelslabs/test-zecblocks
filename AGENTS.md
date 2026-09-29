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

- Robinhood Ordinal (owner update, 29 September 2026): a separate ERC-721-compatible inscription collection, supply 5,000, exactly 0.00019 ETH protocol fee per NFT to `0x81046ab56f41a78077662624ac4116465fdf00cc`, no maximum mints per wallet, no premine or admin mint. Preserve the approved SVG renderer and immutable metadata. Minting belongs at `/ordinal.html`, separate from RHSC trading; the market links with an NFT banner. Never activate an unverified/unpublished collection or conflate this NFT fee with RHSC free minting. See `docs/robinhood-ordinal-production.md`.

- Official RH-20 core (owner deployment, 29 September 2026): `0x4e89Bc6A7A218B338060d428f40d8f551efc8058`, chain 4663. Genesis transaction `0xfcf63d66c24b585f6af2f9b7133bca9fd93aef464a43dada1a10845dd2b997b6`, RPC block 75,340,072. Use Robinhood Etherscan (`https://robin.etherscan.io`) for RH-20 explorer links. Creation/runtime bytecode, receipt, genesis event, and RHSC rules were matched through mainnet RPC before enabling the public mint. Solidity genesisBlock follows Arbitrum ancestor-chain numbering; the manifest deploymentBlock is the RPC receipt block. Do not redeploy or replace this core for frontend updates.

- RH-20 / RHSC (owner update, 29 September 2026): target Robinhood Chain mainnet (4663), contract-validated inscriptions. RHSC maximum supply 21,000,000; exactly 500 per mint; 20 lifetime mints per wallet address (10,000 minted RHSC). Transfers never reset the counter. Mint fee is zero; network gas applies. Keep the minimal JSON with `p`, `op`, `tick`, `max`/`lim` or `amt`, without a public version label. The separate RH-20 marketplace fee is 3%; this does not change existing ZEC/USDC rails. Never treat an unconfigured deployment manifest as a live token, accept an arbitrary query-string contract, or replace the official core. Preserve receipt-based recovery and exact runtime-code verification. See `docs/rh20-production.md`.

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
