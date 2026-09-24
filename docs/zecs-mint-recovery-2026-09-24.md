# ZECS mint recovery repair — 24 September 2026

## Verified scope

The mining and minting site is `https://mine.zecblocks.xyz/`, maintained in
`deadpixelslabs/test-zecblocks`. The main site and marketplace remain in
`deadpixelslabs/ZEC-BLOCKS`. This change starts from mining commit
`40c8e084ebcaa692bd8605e9aa3378d86097f82d`, whose HTML matched the live site.

## Reproduced failures

- History discovery treated terminally failed sends and incoming transactions
  containing the canonical mint memo as outstanding mints, blocking fresh minting.
- An unknown broadcast remained locked after history revealed a TXID. Registering
  history alone could not clear the `unidentified` flag, so repeated recovery could
  leave the user with no next step.
- Error handling replaced the original approval time with the later failure time,
  losing context needed to distinguish the attempted mint from historical ones.

## Changes

History discovery ignores explicitly non-send operations and terminal failures.
Saved TXIDs and signatures remain protected and are checked directly, even if
wallet history is unavailable. The initial attempt time and pre-send history
snapshot survive ambiguous results.

For an unidentified broadcast, recovery can suggest a single recent outgoing
pending/mined transaction. The user checks that TXID against the attempted mint
in Noir Activity and clicks **Recover this transaction**. Every mint has the same
memo, so a timestamp match alone does not silently unlock an uncertain send.
An exact TXID can also be pasted for an older recovery journal.

The selected transaction must be an outgoing pending/mined ZECS mint in the
connected wallet's history. Recovery rejects older/pre-existing transactions,
foreign registrations and wallet switches. It saves the concrete TXID before
registration; rejected signatures or interrupted requests retain the recovery
journal. It uses a saved signature when available. No recovery path sends ZEC.

Normal **Continue Pending Mint** remains the first action for saved transactions.
The TXID field only appears when the original broadcast is unidentified.

## Invariants and limits

Canonical memo, holder eligibility, registration signatures, exactly 210 ZECS per
mint, 21,000,000 maximum supply and the 100,000 confirmed-event cap are unchanged.
No database records, balances, backend validation rules or marketplace code change.
An explorer 404, empty history or timeout does not establish that a payment failed.
The repair does not force pending transactions to confirmed or erase unknown sends.

Tests use isolated wallet/backend fixtures and never spend real ZEC. Coverage
includes failed/incoming discovery, empty and ambiguous histories, explicit TXID
recovery, old-history substitution, wallet switches, signature rejection, saved
registrations, duplicate clicks and mobile layout.
