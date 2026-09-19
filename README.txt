ZEC BLOCKS — LIVE WEBSITE V1

Upload index.html as the site root.

Live features in this build:
- Noir Wallet mainnet connection via the injected provider.
- Derived wallet identity -> SHA-256 owner commitment.
- Browser SHA-256 miner using ZB-1 26-bit PoW.
- Genesis height + source block resolution through the public Zexplorer API.
- Free-window CLAIM broadcast through Noir Wallet to the public ZB-1 mailbox.
- TRANSFER broadcast through Noir Wallet.
- Portfolio reconstructed from local wallet history + public discovery events.
- P2P signed marketplace listings and offers via public Nostr relays.
- GitBook docs link: https://docs.zecblocks.xyz

IMPORTANT DESIGN BOUNDARIES:
- Nostr relays are discovery/cache only and are NOT protocol authority.
- Marketplace in this build supports signed listings/offers, not automatic fund settlement. No ZEC moves when making an offer.
- Paid claims after canonical claim #500 are deliberately blocked until the 0.0013 ZEC fee + claim two-transaction path is finalized.
- A full independent ZB-1 mailbox scanner/validator is still needed for trust-minimized global reconstruction.
- Never put a seed phrase/private key in this website. Noir Wallet approval handles signing/broadcast.
