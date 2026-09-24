# ZECS foreign-registration recovery

Base: mining repository `deadpixelslabs/test-zecblocks`, remote `main`
`6fd8040869f9d1dbf7157e27c9fd82c1743f3a41`. Marketplace code is unchanged.

## Incident and cause

The reported Continue Pending Mint loop involved an existing mint confirmed on
21 September, registered to a different derived wallet identity than the one
connected in the screenshot. Recovery included every matching history TXID in
its durable queue, but foreign registrations could neither complete that queue
nor be set aside. Repeated checks therefore produced the same ownership error.
The report does not reveal the browser's actual local recovery journal, so both
discovery-only and saved-send cases are handled separately.

## Resolution

- A history-only queue entry with a verified foreign pending/confirmed registration
  is archived locally and removed automatically. It never contributes to this
  wallet's confirmed/pending recovery counts, and remains excluded from fresh
  mint preflight because it is already registered.
- Any pending TXID, saved signature, original send timestamp/history baseline or
  unidentified approval retains its protection against automatic dismissal.
- A known TXID confirmed for another wallet offers **Remove from pending queue**.
  The explicit action checks current registration again, writes the complete
  owner-scoped local evidence before clearing that single item, and permits a
  separate new mint only when no other unresolved entries remain.
- Failed writes/lookups, account switches, unconfirmed/invalid registration and
  unknown broadcasts cannot use the explicit action to bypass recovery.
- Removing one queue entry preserves a different concrete `lock.txid`, its
  signature and pending key. No operation here sends a wallet transaction,
  modifies backend ownership/balances or marks an explorer timeout as failure.

Recovery copies use `zb20_zecs_foreign_mint_v1_<owner>_<txid>`. They are audit
copies in the original browser, not new registrations or transferable balances.

## Validation

The recovery unit suite covers foreign discovery, mixed queues, saved evidence,
explicit conflict archival, storage/network failures and wallet changes.
Browser regressions cover the reported loop, one subsequent mint, refresh
persistence, the mobile conflict action and unidentified-broadcast protection.
Existing mining, claim and backend proxy suites remain required in CI.
All wallet sends/signatures in tests are synthetic; production verification is
read-only. Commit/PR checks record final CI and deployment results.
