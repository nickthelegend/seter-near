# Mienai report (2026-11-09)

**Status:** live on NEAR testnet. A real sealed stop fired when the live NEAR/USD price crossed it, and its Intel TDX attestation passed all six checks.

## What works live
- Vault `mienai-3013a230.testnet` and test token tUSD `mienai-ad65ebef.testnet`.
- Real run (`deployments/real-run-2026-11-09.json`):
  - a stop sealed at 3.5967;
  - the first check read 3.6003 inside the enclave, so nothing fired;
  - the second check read 3.5886 from a Coinbase trade, and the stop fired through the private callback, selling 0.4 NEAR for 1.2725 tUSD on the test pool;
  - a take-profit was cancelled without its level ever being revealed.
- Two independent on-chain checks before any fire: the private OutLayer callback, and the enclave's ed25519 report signature.
- The enclave key is derived by this exact WASM build for this contract only. The build is reproducible (hash `791b4f6c…`, pinned on the contract).

## Tests
27 passing: 9 enclave, 3 contract unit, 2 sandbox, 5 SDK, the reproducible hash, the web build and six page renders.

## Weak spots (honest)
- There is one price source (Coinbase, inside the enclave).
- Each check costs about 0.001 NEAR plus gas, so there is no self-running timer.
- Testnet fills land on a tUSD test pool. Mainnet NEAR Intents needs a funded `NEAR_MAINNET_ACCOUNT`.
- The bands report only shows a band once 5 or more orders sit in it.
- The browser wallet flow hasn't been clicked through by a human; every contract call it makes ran on testnet via scripts.

## Demo
See the README's "Run it" section.
