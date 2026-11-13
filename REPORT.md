# Seter report (2026-11-09)

**Status:** live on NEAR testnet. A real sealed stop fired when the live NEAR/USD price crossed it, and its Intel TDX attestation passed all six checks.

## What works live
- Vault `mienai-3013a230.testnet` and test token tUSD `mienai-ad65ebef.testnet`.
- Real run (`deployments/real-run-2026-11-09.json`):
  - a stop sealed at 3.5967;
  - the first check read 3.6003 inside the enclave, so nothing fired;
  - the second check read 3.5886 from a Coinbase trade, and the stop fired through the private callback, selling 0.4 NEAR for 1.2725 tUSD on the test pool;
  - a take-profit was cancelled without its level ever being revealed.
- The recorded fire arrived through the private OutLayer callback. The contract also supports a public relay for enclave-signed reports on eligible pending or failed requests. Both paths verify the signature, request, price freshness, commitment and crossing.
- The enclave key is derived by this exact WASM build for this contract only. The build is reproducible (hash `791b4f6c…`, pinned on the contract).

## Tests
See [TESTING.md](TESTING.md) for the recorded enclave, contract, SDK, build and browser checks. Its later browser QA includes the trading terminal and Meteor Wallet pop-up checks. A full browser wallet sign-in and approval remain unverified.

## Weak spots (honest)
- Two price sources (since 14 Nov): Coinbase inside the enclave, plus `price-oracle.testnet`, which must agree within 1% before a fire. The oracle's median includes Coinbase, and an oracle outage blocks fires.
- Each check costs about 0.001 NEAR plus gas, so there is no self-running timer.
- Testnet fills land on a tUSD test pool. Mainnet NEAR Intents execution is not built; funding alone does not enable it.
- The bands report only shows a band once 5 or more orders sit in it.
- A full browser wallet sign-in and approval are not verified in the recorded QA; contract calls were exercised on testnet via scripts.

## Demo
See the README's [Try it](README.md#try-it) section.

## v3 update (13 Nov 2026)

- New screens in the approved look: sealed book, portfolio, activity, how it works, and a "two views" panel on every order (owner view vs the real on-chain record read back over RPC). Landing gains the why-sealed problem section, a live-on-chain section and a FAQ.
- Liveness: Coinbase WebSocket price stream with tick flashes, streamed trades, count-ups, enclave check-age pulse, live TDX quote and on-chain measurement approval for new fires.
- Test pool deepened and re-priced to Coinbase (+5 NEAR, +20.13 tUSD; `deployments/pool-rebalance-2026-11-13.json`).
- Film v3 (final cut 2:28, re-recorded for clean subtitles: seal 8XGosiUZtLN3aNfCdasQoaseEAiEKEuqJ3jZZLDg1Hdk, fire 9KRm7G6dWV6Wutcn9Uy6aEAttV25kXB76T8cXhi6mJNy, cancel 2AUm4jMPnGwse13FTuMi3ptSM3zmTevLNZxeSMraQ9SU). First take: seal 3AsXyWwyrW7EDRfRZbcWUVHvBTCv1qa6jEQGzJSKawtH, check/fire 9Jff4h8JPCZbase4gMgcgK2DoLTYY5uZrv6V2V6Qphbx (attestation 6/6), cancel GbBRFrWsi47ND6PcvHToxdH2gGmpZ4nt78PQpYryZabB. Self-judged 9.0/10 (`videos/seter-near/film-v3/JUDGE-v3.2.md`).
