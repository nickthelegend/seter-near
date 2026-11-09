# NEAR HACKATHON submission worksheet

The [event instructions](https://nearhackathon.com/HACKATHON.md) require the human to confirm these values before a single final POST. The repo must be public before 2026-11-14 23:59 UTC. Nick publishes the repo and the demo post.

| Field | Value |
| --- | --- |
| Project name (2–80 characters) | TBD by Nick (suggested: Seter) |
| Team lead name (2–80 characters) | TBD by Nick |
| Contact email (max 160 characters) | TBD by Nick |
| Team size (`1`, `2 - 4`, `4 - 6`, `6 - 8`, `8+`) | TBD by Nick |
| Tracks | `privacy` (primary), `defi` (secondary), as in the brief; Nick confirms |
| Mainnet NEAR account for prize payout | TBD by Nick |
| Public repository URL | TBD by Nick |
| Public X demo post URL | TBD by Nick |
| What they built (20–2000 characters) | TBD by Nick. Draft: "Seter hides stop-loss and take-profit levels from stop hunters. Orders are sealed in the browser to an OutLayer TEE program; the NEAR contract stores only ciphertexts and commitments. The enclave reads NEAR/USD from Coinbase inside Intel TDX and reports only crossed orders, signed with a key bound to its WASM hash. The contract accepts the report only through its private OutLayer callback, checks signature, freshness, commitment and crossing, swaps on a test NEP-141 pool, and publishes the trigger for audit. A real stop fired on testnet on a real price crossing, with a verified TDX attestation." |
| Consent | TBD by Nick |
| Other project disclosure under Q-015 | TBD by Nick |

Consent notice to present verbatim: “I agree that the organizers may use these details to review our submission and contact us about this hackathon.”

The demo post must say it was built at NEAR HACKATHON, tag `@NEARProtocol` and `#NEARHackathon`, and attach a video or screenshots. Nothing was submitted from here.
