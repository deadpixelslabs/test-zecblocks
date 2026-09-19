ZEC BLOCKS MINING V9 — RESERVATION-FIRST PAID CLAIMS

IMPORTANT CORRECTION
A confirmed 0.0013 ZEC protocol fee is NOT returned to the user's Noir wallet
and is NOT wallet balance. It is already paid to the treasury.

V9 prevents "pay first, then discover the NFT was taken".

FLOW
1. Find a valid 26-bit proof.
2. Check the Token ID.
3. Broadcast CLAIM_RESERVE v3 to the ZB-1 mailbox.
4. Wait for the reservation to confirm on Zcash.
5. Re-check for a pre-existing confirmed claim.
6. ONLY THEN ask Noir Wallet to send 0.0013 ZEC.
7. Fee goes from shielded funds to:
   t1b9PCdoCncgoc13CWwWz8tzZZLDYfMaTyz
8. Wait for the fee to confirm and verify exactly 130,000 zatoshi.
9. Broadcast final CLAIM v3 referencing both reservation TXID and fee TXID.
10. If finalization is interrupted, Resume Pending Claim uses the same
    reservation and same fee TXID; it never asks for a second protocol fee.

Reservation window: 6 hours.
Reservation confirmation: 1.
Fee confirmation: 1.

Existing V1/V2 claims stay readable/grandfathered.
All new paid claims produced by V9 use CLAIM_RESERVE v3 + CLAIM v3.

ZB-1 remains application-layer consensus, not a smart contract.
Other ZB-1 clients/indexers need to implement the same reservation rules.
The official miner mirrors reservations as CLAIM_INTENT so older official
miners stop competing while the reservation is active.

Deploy ALL files in this ZIP to mine.zecblocks.xyz.
