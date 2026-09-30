# Robinhood Ordinal

Owner-approved production rules, 29 September 2026:

- Collection: Robinhood Ordinal; symbol RHO; Robinhood Chain 4663.
- Maximum supply: 5,000 NFTs, numbered 1 through 5,000.
- Protocol fee: exactly 0.00019 ETH (190000000000000 wei) per NFT, plus network gas.
- Fixed protocol treasury: `0x81046ab56f41a78077662624ac4116465fdf00cc`.
- No maximum number of mints per wallet. The only collection limit is the global 5,000 supply.
- One NFT is minted in each transaction. No premine, team allocation, admin mint, burn, pause, upgrades, artwork setters, metadata setters, fee setters or supply setters.
- Mint UI: `https://mine.zecblocks.xyz/ordinal.html`, separate from the RHSC market. The RHSC market has a banner linking to this page.

## Official deployment — 29 September 2026

The owner deployed collection `0x6e049af563A804Ef834b4f6d1c8958a488571b21` with renderer `0x7840794d28Ff52f6fbd378fCee2BF7B2dD594f51` in transaction `0x05748c342ae940d34c7b22a0bf751fe02218f6b098492b0875b5ba6ee65c8f33`, RPC block **75,473,902**. Mainnet verification in CI run **36536455696** matched exact creation/runtime bytecode, the child renderer and approved artwork code, canonical receipt, genesis event, zero premine, supply, fee and treasury before the official manifest was pinned. The 14 isolated contract checks and 9 browser checks also passed.

The official mint page uses this address; the deployment page prevents another official deployment. Do not replace or redeploy the collection for website updates. Future checks use the pinned address and transaction through `scripts/publish-ordinal.cjs --check`; the CI workflow records the verified receipt in `ordinal-deployment.json`. This on-chain verification does not claim explorer source verification.

## Artwork and ownership

This is a contract-validated inscription collection with ERC-721 metadata, transfers and enumeration. It is an application protocol on Robinhood Chain; it does not use Bitcoin satoshi numbering. The contract accepts exactly `{"p":"rh-ordinal","op":"mint","tick":"RHO"}` plus a wallet-generated request ID, and emits an `Inscribed` event binding the minter, token ID, design code, fee, request ID and inscription payload. Reusing the same request ID for the same wallet reverts atomically.

The deployment creates the NFT collection and a dedicated `RobinhoodOrdinalRenderer` in one transaction. The renderer's address is stored during construction and has no setter. Its bytecode hash remains exactly the approved art preview renderer: `0x40bc0f333fb39b3d4ae182051a32078b254382d71b58564fee9ad6fdc17bdda6`.

Each token uses `((tokenId - 1) * 40503 + 23040) mod 65536` as its design code. This is injective for the 5,000 IDs; it does not introduce random allocation or a randomness oracle. Users can calculate upcoming designs. Four palettes, four cores, four crown patterns, four panel layouts and an eight-bit geometric seal keep variations within the approved silhouette. The SVG and JSON metadata are returned directly by the contracts. Static SVG files on the mint page are exact renderer previews, not the NFT metadata source or an image database.

`tokenURI` returns base64-encoded JSON containing a base64 SVG and traits. Ownership transfers preserve the artwork and metadata. Standard ERC-721 safe-receiver checks apply. The `ownedTokens` view is bounded to 24 IDs, and the UI displays six at a time.

## Fees and wallet recovery

The mint requires the exact fee; underpayments and overpayments revert. After safe minting, the treasury receives the fee. A bounded payment rejection leaves a claimable balance that only the fixed treasury may withdraw to its chosen recipient. A rejecting NFT receiver reverts the entire mint and protocol fee. Network gas for reverted transactions is not refunded.

The website records the exact contract, chain, account, value, calldata, nonce and request ID before requesting a wallet transaction. Web Locks and persistent journals block concurrent submissions and retain ambiguous broadcasts. Recovery verifies the exact transaction and a canonical receipt, including the matching inscription event. It never treats a missing RPC response as a failed payment. Confirmed cancellation/replacement at the same account nonce can release the obsolete intent. The public RPC route allows reads only for the published collection/renderer and never signs or broadcasts transactions.

## Deployment and activation

1. Open `https://mine.zecblocks.xyz/ordinal-deploy.html` with the intended deployment wallet.
2. Review the supply, fee, treasury and network. The deployment sends 0 ETH to the contract; the wallet pays deployment gas. Confirm one transaction.
3. Copy the collection address, renderer address and deployment transaction. Do not deploy again after an unresolved wallet response; use receipt recovery.
4. Run `node scripts/publish-ordinal.cjs --address <collection> --hash <transaction> --check` through the official Robinhood RPC. This checks exact creation/runtime bytecode, child renderer address/code, genesis event, zero premine, chain and fee/supply configuration. Arbitrum-style ancestor block numbers are checked against `l1BlockNumber` rather than confused with the RPC receipt block.
5. Only after that verification, pin the receipt in `ordinal/mainnet.json`, update the RHSC banner from Coming soon to Mint open, publish both production repositories, and rerun the affected live read checks. A previously pinned collection cannot be silently replaced.

The public mint page remains disabled until an official verified collection is published. Deploying the contract makes permissionless minting available directly on-chain immediately. No owner-only activation switch exists. No NFT marketplace contract is deployed by this mint build; the RHSC marketplace continues to trade RH-20 tokens with its existing 3% fee.

## Reproducibility and validation

Compile with Solidity 0.8.26, optimizer 200 runs and the Paris EVM target. OpenZeppelin Contracts 5.0.2 is vendored unchanged for Paris-compatible ERC-721, enumeration, reentrancy protection and Base64. The Base64 dirty-memory issue is patched in 5.0.2; see the maintainer advisory https://github.com/OpenZeppelin/openzeppelin-contracts/security/advisories/GHSA-9vx6-7xxf-x967. Latest 5.6.1 was inspected but introduces MCOPY-dependent sources, which are not compatible with this repository's conservative Paris target. Only used dependencies are vendored, with original SPDX notices retained.

`node scripts/build-ordinal.cjs --check` reproduces both artifacts and the Etherscan standard JSON input. Contract checks cover genesis, exact payments, rejected receiver rollback, duplicate intents, unrestricted repeated wallet minting, the final supply race, artwork identity/uniqueness, transfers, treasury fee recovery and public RPC restrictions. Browser checks cover the actual wallet-to-contract paid mint, metadata display, unresolved response recovery without a second fee, rejection, blocked storage, two tabs, wrong bytecode, combined deployment and responsive themes. Live checks compare published bytes and load both pages without a signing wallet.

Contract source and compiler input are supplied for Etherscan verification. This document does not claim that the collection or renderer has already been explorer-verified or independently audited.

Production rechecks after RPC pruning: first publication still requires genesis-block state. An already verified manifest may use current immutable state only when its address, deployment transaction, receipt block and deterministic renderer match the pinned deployment. Exact creation/runtime code, canonical receipt, genesis event and permanent parameters remain mandatory. Isolated regressions cover pruning, changed pins and a replaced renderer.
