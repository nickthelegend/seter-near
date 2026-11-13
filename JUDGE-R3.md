# Seter — strict R3 self-judge (13 Nov 2026)

Scored against the NEAR HACKATHON guidance in https://nearhackathon.com/HACKATHON.md (machine-readable README with
"do X - see Y" steps, a demo that leads with the user problem and shows one complete moment, NEAR's role stated
concretely, reproducible repo, MIT license). Judged as a strict, non-crypto juror.

| Criterion | Score | Evidence |
| --- | --- | --- |
| Problem is clear in one line | 9 | Landing and film open with "Your stop-loss is public. Seter seals it." and a labelled stop-hunting illustration next to a real order record. |
| One complete moment, real result | 9 | Film: seal stop №16 → two views (owner vs real `place_order` args) → paid check → fired, 0.2 NEAR sold for 0.682980 tUSD → certificate 6/6. Txs in README and `deployments/film-2026-11-13.json`. |
| NEAR's role is concrete | 9 | Contract stores ciphertext + commitment; OutLayer TEE run via `request_execution`; ed25519-verified enclave reports; NEP-141 test pool settlement. |
| Live proof | 9 | Three new FINAL testnet txs from the app UI; TDX attestation verified end to end by `verify-attestation` logic (Intel chain, approved measurements, pinned WASM). |
| UI / screens | 9 | 11 screens in one design language (landing, trade, order, book, portfolio, activity, how it works, explorer-linked records, not-found); live Coinbase stream, count-ups, enclave pulse. FLOW-QA 1440 + 390, 0 overflow. |
| Reproducibility | 8.5 | `pnpm install && pnpm build && pnpm --filter @mienai/web preview`; read-only demo needs no wallet. Human Meteor approval not shown on camera (QA signer used); hosting prepared, not deployed. |
| Honesty / limits | 9 | Testnet only, tUSD no value, paid manual checks, one price source, probing and band-report leaks, mainnet Intents not built — stated in README, How it works and the film. |
| Completeness | 8 | No automatic keeper running; small test pool; one market (NEAR/USD). |

**Overall: 8.9 / 10.** Biggest gaps: no running keeper (needs `SETER_KEEPER_KEY`), no hosted demo URL yet, Meteor approval not filmed.
