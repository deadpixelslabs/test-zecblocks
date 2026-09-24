# Mint again after a Noir error without a TXID

Base: `deadpixelslabs/test-zecblocks` main
`37eb8a90665a5d4b5bbe0da974aa40fbbf9945ff` (PR #9).

## Report and diagnosis

The user reported a Noir synchronization failure during a new mint. The browser
kept an unknown-broadcast gate, and Continue Pending Mint replayed 59 old confirmed
transactions without identifying the new attempt. The foreign-registration fix
did not address this no-TXID case. Browser-local state is not remotely accessible;
the screenshot and current source establish the gate/recovery behavior, not that
the wallet definitively failed before broadcast.

## Behavior

- Unknown attempts use **Check previous attempt**. Discovery can suggest a recent
  outgoing TXID, but no longer inserts all older mints into that unknown queue.
- The adjacent option explains that the earlier request may still complete and a
  separate mint incurs its own network fee. After checking Noir Activity, closing
  unfinished approvals and acknowledging the choice, the user can select
  **Save attempt & enable new mint**. It durably saves the unknown attempt before
  removing its active unknown marker. It never sends a transaction.
- **Mint 210 ZECS** is a separate deliberate action, still subject to eligibility,
  supply, wallet history, registration checks and Noir approval. Any other known
  unresolved TXID/signature keeps its recovery gate.
- Saved attempts survive reload and are accessible for restoration. Restoring an
  attempt cannot replace an existing active journal. Storage failures preserve
  evidence and do not permit an unprotected new send.
- Each new wallet send captures its own attempt ID before the provider request.
  A delayed response updates that exact active or saved attempt and owner; it
  cannot resolve or replace a newer unknown request. A late TXID can then be
  registered without another send by resuming its saved attempt.

This update changes the dApp recovery flow, not Noir's synchronization engine.
It does not classify a sync timeout/empty history as proof of failed broadcast,
alter token balances, or cancel an on-chain transaction.

## References and validation

Official Noir references checked during investigation:
- https://docs.zknoir.com/developers/provider-api/
- https://docs.zknoir.com/wallet-guide/activity/

The activity guide distinguishes synchronization delays from actual transaction
status and describes local recording after broadcast. Consequently, this change
uses an explicit user choice with retained evidence instead of guessing from a
generic error message.

Regression coverage includes 59 old mints, failed storage, corrupt saved data,
known transaction protection, original timestamps/history, wallet changes,
reload, a separate fresh mint, and a real delayed provider promise resolving
after a second request failed. All wallet fixtures are synthetic. Production
verification uses source checksums and read-only APIs; no real funds are spent.

Data key: `zb20_zecs_deferred_v1_<owner>`. The existing active and foreign-owner
journal keys remain supported. No backend migrations or marketplace changes.
