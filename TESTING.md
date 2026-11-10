# Testing

All counts below are from runs on 2026-11-09. No test mocks an external API: prices are real Coinbase responses pinned in `packages/enclave/fixtures/`, chain tests run on a real local nearcore (near-workspaces sandbox), and the end-to-end evidence is real testnet transactions.

| Suite | Command | Tests | Result |
| --- | --- | --- | --- |
| Enclave (native) | `pnpm test:enclave` | 9 | 9 pass |
| Contract unit | `pnpm test:contract` (lib) | 3 | 3 pass |
| Contract sandbox (real local chain, signed transactions) | `pnpm test:contract` (`tests/sandbox.rs`) | 2 | 2 pass |
| SDK | `pnpm test:sdk` | 5 | 5 pass |
| Reproducible enclave build | `bash scripts/build-enclave.sh` from a fresh copy at another path | 1 | hash `791b4f6c…` matches the contract |
| Web build | `pnpm build` (tsc + vite build) | 1 | passes |
| Web render (headless Chrome, `/`, `/app`, `/order/1`, `/order/3` at 1440 / 390 / 375, plus the terminal's bottom tabs and Limit tab at 1440 / 390) | see below | 14 | root rendered, no page errors, no horizontal overflow |
| **Total** | | **35** | **35 pass** |

## What the tests cover (brief item → test)

| Required | Where |
| --- | --- |
| Encryption round-trip | enclave `encryption_round_trip_and_owner_binding` (Rust seal/open, owner AAD, wrong key, flipped bit); sdk `seal to the enclave key…` (JS seal ↔ X25519 open); the probe run on OutLayer opened a JS-sealed order inside TDX |
| Origin check rejects a non-TEE caller | sandbox: direct call to `on_result` → `Method on_result is private`; report signed by another key → `ERR_SIGNATURE`; valid signature over an edited body → `ERR_SIGNATURE` |
| Fire only when the price truly crossed | enclave `fires_only_orders_the_real_price_crossed_and_hides_the_rest` (real Coinbase ticks 3.5892 / 3.5896); sandbox: price above a stop → `ERR_NOT_CROSSED`; testnet: check #1 at 3.6003 did not fire, check #2 at 3.5886 did |
| No double fire | sandbox: two requests include the same order; the second report → `ERR_ALREADY_FIRED` |
| Cancel | sandbox: non-owner → `ERR_NOT_OWNER`; twice → `ERR_NOT_OPEN`; a report revealing a cancelled order executes nothing; testnet cancel tx `HojS7Jjq…` |
| Reproducible WASM hash | fresh-copy rebuild above; the app's enclave panel compares the contract's pinned hash to the recorded build |
| Replayed attestation | sandbox: the same signed report twice → `ERR_REPLAY` |
| Stale price | sandbox: 5-minute-old price → `ERR_STALE_PRICE` |
| Fire with the wrong order | sandbox: plaintext not matching the commitment → `ERR_COMMITMENT`; order outside the request → `ERR_ORDER_NOT_IN_REQUEST`; enclave: ciphertext moved to another owner or with a mismatched commitment never fires |
| Other | sandbox: wrong contract in the body → `ERR_BODY`; wrong price source → `ERR_SOURCE`; ciphertext format and storage deposit checks; only the token can credit tUSD; only owner or issuer can seed; faucet cooldown. sdk: a real report signed inside OutLayer TDX verifies and an edited one does not |

The sandbox replaces exactly one thing: the enclave's public key is written into the contract's `k` storage slot with `patch_state`, a sandbox-only RPC, because OutLayer does not run in a local sandbox. `check()` there really calls the missing `outlayer.testnet` and its callback really receives a failed promise. On testnet the key comes from the attested `keys` run.

## Live testnet evidence

- `deployments/testnet-2026-11-09.json`: deploy, init, enclave `keys` run, pool seed.
- `deployments/real-run-2026-11-09.json`: deposit, two sealed orders, two checks, the fire, the cancel, the audit view, and the TDX attestation verification (all six checks true, TCB UpToDate).
- `deployments/book-2026-11-09.json`: three more sealed orders and the enclave `bands` report.
- `deployments/outlayer-direct-*.json`: the two probe runs.

## Web QA
Headless Chrome (playwright-core, channel chrome) against `vite preview --port 5203` after `tsc -b && vite build`, 10 Nov 2026 (trading-terminal rebuild):

| Route | 1440x900 | 390x844 | 375x812 |
| --- | --- | --- | --- |
| `/` | rendered, 0 page errors, no overflow | rendered, 0 page errors, no overflow | rendered, 0 page errors, no overflow |
| `/app` (terminal) | rendered, 0 page errors, no overflow | rendered, 0 page errors, no overflow | rendered, 0 page errors, no overflow |
| `/order/1` (fired, certificate with live TDX quote hash) | rendered, 0 page errors, no overflow | rendered, 0 page errors, no overflow | rendered, 0 page errors, no overflow |
| `/order/3` (armed) | rendered, 0 page errors, no overflow | rendered, 0 page errors, no overflow | rendered, 0 page errors, no overflow |
| `/app` bottom tabs (Order history, Enclave log, Attestations) and the Limit tab | 0 page errors, no overflow | 0 page errors, no overflow | — |

Live sources in the browser: NEAR testnet RPC (FastNEAR, then dRPC, then `rpc.testnet.near.org` when one answers HTTP 429 without CORS headers, which shows as a console fetch error before the fallback succeeds), Coinbase Exchange `NEAR-USD` ticker, stats and candles (CORS open), and `testnet-api.outlayer.ai` attestations (CORS open; the TDX quote is hashed with WebCrypto). The wallet flow (MyNearWallet) was not clicked through by the agent; see BLOCKED.md.

Token logos (10 Nov 2026): NEAR (`@web3icons/core` 4.0.58, branded), a dollar disc for USD, and the dollar disc with a "test" tag for tUSD, on the market bar pair, the landing terminal preview and proof numbers, the order panel (side chip, field units, available, est. proceeds, storage deposit), the vault box and vault sheet, open orders and history tables, and the order page (market, side, size, fill). Rebuilt with `tsc -b && vite build`, served by `vite preview --port 5341`, and shot with headless Chrome at 1440x900 and 375x812 on `/`, `/app` and `/order/1`: 0 page errors and no horizontal overflow on all six. The vault sheet's balance rows appear only with a connected wallet and were not rendered by the agent.
