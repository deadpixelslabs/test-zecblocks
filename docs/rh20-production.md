# RH-20 and RHSC production integration

Owner-approved RHSC rules, 29 September 2026:

| Parameter | Value |
| --- | --- |
| Network | Robinhood Chain mainnet, chain ID 4663 |
| Protocol | `rh-20` |
| Ticker | `RHSC` |
| Maximum supply | 21,000,000 whole tokens |
| Amount per mint | Exactly 500 whole tokens |
| Public mint events | 42,000 |
| Lifetime mints per wallet address | 20 |
| Maximum received by minting per wallet | 10,000 RHSC |
| Mint fee | Zero; the sender pays ETH network gas |
| Premine / privileged mint | None |
| Future marketplace trading fee | 3%, implemented by the separate marketplace contract |

RHSC is a contract-validated RH-20 token, with canonical JSON inscriptions recorded by contract events. The registry is the authoritative balance ledger. It is not an ERC-20 token and does not automatically appear in ERC-20 wallets or DEXs. Its whole-token amounts have zero decimal places. The public mint does not require holding a ZEC BLOCKS NFT; the existing ZECS holder rule is unchanged.

## Deployment and launch

`/rhsc-deploy.html` prepares one mainnet wallet transaction that deploys `RH20` and registers RHSC in the constructor. That transaction is the protocol's genesis anchor and emits the canonical deploy inscription. RHSC starts with zero circulating supply. The constructor registration prevents another account from front-running the RHSC ticker in the official registry.

```json
{"p":"rh-20","op":"deploy","tick":"RHSC","max":"21000000","lim":"500"}
```

The 20-mint limit is fixed in the RHSC contract rules and the `TokenDeployed` event. It does not require an extra field in the user's minimal JSON format. Deploying the contract opens public minting on-chain. The public website opens its mint button only after the official deployment is pinned and verified.

The deploying wallet must approve its own transaction and pay ETH gas. The page never requests seed phrases or private keys. A successful deployment is saved in local recovery storage and displays its contract address, transaction hash and block. A reload must not cause another deployment.

`rh20/mainnet.json` initially has a null contract address. This is intentional: no mainnet deployment is claimed and the mint button remains disabled. Do not publish an arbitrary wallet-supplied contract URL or accept a query-string override. After the owner returns a confirmed deployment transaction, run the read-only verifier:

```sh
node scripts/publish-rh20.cjs --tx <deployment-transaction-hash>
```

It checks the mainnet chain ID, successful receipt, exact creation bytecode, deployed runtime hash, genesis metadata and RHSC parameters before writing the canonical manifest. Publish that manifest and its updated checksum. It refuses to replace an already configured official contract with another address.

The build uses Solidity 0.8.26, optimizer 200 runs, and the Paris EVM target. `rh20/compiler-input.json` contains the complete standard JSON input for explorer verification. `rh20/RH20.json` includes ABI, creation bytecode, runtime bytecode and the expected runtime hash. Reproduce or check it with `node scripts/build-rh20.cjs` or `node scripts/build-rh20.cjs --check` using `solc@0.8.26` and `ethers@6.13.5`.

## Mint and transfer behavior

```json
{"p":"rh-20","op":"mint","tick":"RHSC","amt":"500"}
```

The wallet calls `inscribe(string)` with the exact canonical JSON. The Solidity parser rejects extra fields, reordered fields, whitespace, duplicate keys, numeric JSON values, fractional/scientific notation, leading zeroes, invalid tickers and trailing data. This intentionally small format avoids two parsers interpreting the same instruction differently. Every mint must equal the registered mint amount.

The recipient is the contract caller (`msg.sender`). The contract increments the caller's lifetime counter on every successful mint. Incoming or outgoing transfers do not reset it. This is a limit per wallet address, not proof that an individual controls only one wallet. A failed mint does not increase the counter or supply, but its network gas can still be charged.

The registry supports future independent tickers through the same deploy JSON. Each has its own immutable supply and fixed mint amount. The specific 20-mint wallet cap is an RHSC rule; other tickers do not inherit it. Tickers use 2–12 uppercase ASCII letters/digits and are unique within this registry.

`transfer`, `approve`, and `transferFrom` expose explicit, per-ticker balance and allowance operations for a future marketplace. There is no privileged market operator, owner mint, balance override, upgrade, pause or token fee. A marketplace must obtain the seller's explicit approval and manage escrow using its own contract. This release does not claim that RHSC trading is deployed.

## Wallet and transaction recovery

The public mint page verifies runtime bytecode and RHSC parameters before enabling mint. Supply, wallet balance and mint count are read from the same block. Reads do not optimistically credit tokens. A transaction is reported successful only after a successful receipt and a matching `Mint` event from the official contract.

Before opening a transaction request, the page saves the wallet, chain, target, calldata and nonce. A returned hash is saved immediately. Ambiguous responses and missing receipts are retained; neither is treated as failure or permission to resend. Hash recovery checks the exact sender, chain, target, value, calldata and nonce. A confirmed reverted transaction or an explicit wallet rejection can clear the pending request. Cross-tab locks prevent overlapping wallet submissions where supported.

Public reads use `/api/rh20`, a read-only proxy restricted to the configured contract and a small RPC method allowlist. It cannot submit transactions. Set `RH20_RPC_URL` to a production Robinhood Chain RPC endpoint in the hosting environment; the documented public endpoint is the fallback. Provider credentials stay server-side. Connected wallets perform transaction preflight and submission through their own provider.

## Verification

Run the focused checks without spending user funds:

```sh
node scripts/build-rh20.cjs --check
node --test tests/rh20-contract.cjs
node --test tests/rh20-browser.cjs
```

They use an isolated local EVM with the mainnet chain ID, and browser wallet fixtures. They cover canonical inscriptions, malformed payload rejection, 20 successful mints and a rejected 21st, mint limits after transfers, allowance isolation, last-supply transaction competition, frontend bytecode verification, mainnet deployment receipts, rejection, ambiguous broadcast recovery, wallet changes, mobile layout and theme controls. They are not an independent security audit or proof of a completed mainnet deployment.

Existing NFT and ZECS mining, recovery, claim limits, eligibility and fees are preserved. Navigation links are the only edits to their existing interface.
