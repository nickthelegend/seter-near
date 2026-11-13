# NEAR HACKATHON submission form

Draft for Nick to complete in the [official form](https://nearhackathon.com/#apply), checked against [HACKATHON.md](https://nearhackathon.com/HACKATHON.md) on 2026-11-11. Deadline: 2026-11-14 23:59 UTC. Nothing has been submitted by this docs task.

| Field | Value and rule |
| --- | --- |
| projectName | Seter (5 characters; allowed: 2-80). |
| leadName | TBD Nick (2-80 characters). |
| email | TBD Nick (valid email, max 160 characters; max 2 submissions per email). |
| size | TBD Nick: one of `1`, `2 - 4`, `4 - 6`, `6 - 8`, `8+`. |
| tracks | Proposed, best first: `privacy` - encrypted stop levels opened inside an OutLayer Intel TDX enclave.<br>`defi` - conditional orders settle against a NEAR/tUSD test pool. NEAR Intents and mainnet execution are not built. Nick confirms `["privacy", "defi"]` as the selected IDs. |
| nearAddress | TBD Nick: NEAR MAINNET payout account (2-64 lowercase characters, valid NEAR account syntax). Do not use the testnet contract account. |
| projectUrl | TBD: public GitHub repo URL after push (HTTP(S), max 300 characters; each repository can be submitted once). Nick publishes it. |
| demoUrl | TBD: the public X post URL (HTTP(S), max 300 characters). Nick posts it with a video because this demo runs locally. |
| idea | Public stop-loss levels can expose traders to stop hunting. Seter encrypts stop-loss and take-profit orders in the browser. A NEAR contract stores ciphertexts and commitments, while an OutLayer Intel TDX enclave reads Coinbase NEAR/USD and signs reports revealing only crossed orders. The contract checks the enclave signature, request, price freshness, commitment and crossing before settling on its NEAR/tUSD test pool and publishing the trigger for audit. A recorded testnet stop fired on a real price crossing, with a verified TDX attestation. This is a testnet prototype; tUSD has no value, checks need a paid keeper call, and mainnet Intents execution is not built. |
| consent | Nick ticks after agreeing to the contact notice below. |

Idea character count: **671** (the exact plain text in the `idea` row, including spaces and punctuation).

Scope: This is a testnet prototype; empty public checks have a probing leak that narrows where armed triggers can be, and k-anonymous band reports reveal their distribution.

Contact notice: "I agree that the organizers may use these details to review our submission and contact us about this hackathon."

These are the eleven user-facing form fields. If Nick later chooses the API, it also requires a `requestId`, generated once and reused on retries. No submission payload is prepared here. The form's hidden `website` spam-trap field must stay empty.

Before publishing, Nick must fill the other-project disclosure in [README.md](README.md#other-projects-by-the-same-team-in-this-hackathon) with the actual project name(s), as Q-015 requires. The current line is a placeholder, not a completed disclosure.

## X post draft

```text
stop levels shouldn't be a target. built Seter at NEAR HACKATHON: encrypted stops, OutLayer TEE price checks and settlement on a NEAR testnet pool. watch a sealed stop fire. what would you test next? @NEARProtocol #NEARHackathon
```

Post character count: **228** (limit: 280). The human publishes it.

attach: seter-near-film-share.mp4

The 3:01 demo film (v4, 14 Nov 2026) is available locally in 1080p (`seter-near-film.mp4`) and a 720p share copy (`seter-near-film-share.mp4`, 7.8 MB). It opens on the landing page, shows the trading screen within 15 seconds, approves the seal in the wallet's Approve transaction sheet and shows it on the public explorer, puts the owner's view next to the real on-chain record, and fires the stop live through the scoped keeper key only after OutLayer's price oracle agreed with the enclave (11 bps). The fire's explorer view shows the oracle call; the attestation verifies 6/6. A cancel is approved and shown on the explorer, its level never revealed. Nick still needs to post it on X and fill `demoUrl`.
