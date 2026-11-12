# Testing

Latest: [11 Nov full-flow QA](FLOW-QA.md), including live script transactions, production Chrome at 1440/375, connected-state fixtures and the remaining human Meteor approval boundary. The results below remain historical.

The suite results below were recorded on 2026-11-09; web QA was updated on 2026-11-10. Prices use real Coinbase responses pinned in `packages/enclave/fixtures/`, chain tests run on a real local nearcore (near-workspaces sandbox), and the end-to-end evidence is recorded testnet transactions. These historical results were not rerun for the submission-docs update.

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

Live sources in the browser: NEAR testnet RPC (FastNEAR, then dRPC, then `rpc.testnet.near.org` when one answers HTTP 429 without CORS headers, which shows as a console fetch error before the fallback succeeds), Coinbase Exchange `NEAR-USD` ticker, stats and candles (CORS open), and `testnet-api.outlayer.ai` attestations (CORS open; the TDX quote is hashed with WebCrypto). Meteor Wallet replaced MyNearWallet after this render pass; its separate pop-up checks and remaining approval gap are described below.

Token logos (10 Nov 2026): NEAR (`@web3icons/core` 4.0.58, branded), a dollar disc for USD, and the dollar disc with a "test" tag for tUSD, on the market bar pair, the landing terminal preview and proof numbers, the order panel (side chip, field units, available, est. proceeds, storage deposit), the vault box and vault sheet, open orders and history tables, and the order page (market, side, size, fill). Rebuilt with `tsc -b && vite build`, served by `vite preview --port 5341`, and shot with headless Chrome at 1440x900 and 375x812 on `/`, `/app` and `/order/1`: 0 page errors and no horizontal overflow on all six. The vault sheet's balance rows appear only with a connected wallet and were not rendered by the agent.

## Wallet: Meteor Wallet replaces MyNearWallet (10 Nov 2026)

MyNearWallet's testnet pop-up now refuses every app ("MyNearWallet can't connect to apps anymore … no longer accepts new app connections"), so the old **Connect** dead-ended. The web app now uses `@near-wallet-selector/core` 10.1.4 with `@near-wallet-selector/meteor-wallet` 10.1.4; MyNearWallet is removed. `pnpm-workspace.yaml` gives the wallet packages their own near-api-js 6.2.5 (Meteor's SDK peer) and `@near-js/utils` 2.5.1 (the `@near-js` 2.x peer); the app's own reads stay on near-api-js 5.0.0.

Checked against `vite build && vite preview` in headless Chrome at 1440×900 and 375×812:

- `/app` → **Connect wallet** opens a pop-up at `https://wallet.meteorwallet.app/connect/testnet/login?…`. The request the app posts into it reads `actionType: login`, `network: testnet`, `contract_id: mienai-3013a230.testnet`, `type: ALL_METHODS` with a fresh public key.
- Closing the pop-up shows the banner "The wallet closed before you signed in." With pop-ups blocked (`window.open` returning null) the banner reads "Your browser blocked the wallet window. Allow pop-ups for this site, then try again."
- 0 console errors, no horizontal overflow at 375. The vault sheet's empty state offers **Connect with Meteor Wallet**.

Not done: a full Meteor sign-in and approval. Meteor's site sits behind Cloudflare, which shows headless Chrome "Sorry, you have been blocked", and signing in needs a person with a Meteor testnet account.


## Real browser transactions with the QA signer (11 Nov 2026)

`pnpm test:e2e` builds the normal app and asserts that every production artifact excludes `qa-signer`, `SETER_QA_SIGNER_TESTNET_ONLY`, `__SETER_QA_SIGNER__` and `QA signer`. It then builds a separate `--mode qa` artifact with `VITE_QA_SIGNER=1`. Setting the flag alone in a normal production build does not enable the signer.

Prerequisites: Node 22+, pnpm 10, system Google Chrome (`channel: 'chrome'`), macOS `sysctl`/`lsof`, the shared `withChromeLock` helper, internet access, and this repo's existing funded `.near-credentials/trader.json`. The test reads that file in Node and passes the signing key through `page.addInitScript` directly into browser memory. It never prints the key, saves a credential copy, enables browser tracing/HAR/video, or uses a persistent browser profile.

```bash
pnpm install --frozen-lockfile
pnpm test:e2e
```

The runner checks spendable funds before starting. The signer rejects non-`.testnet` accounts, mainnet RPCs, other contracts, non-demo methods, concurrent transactions and excess attachments. The runner counts the prior SDK QA debit and other browser QA ledgers toward the combined 0.3 testnet NEAR cap. It stops if funds or remaining budget are low.

The browser connects through the same wallet interface, deposits NEAR and tUSD, seals a crossed stop and a distant take-profit, verifies local owner-view decryption, pays for the real enclave check, sees the fired stop and receipt links, cancels the take-profit, withdraws both asset deltas and checks that the original vault balances are restored. A faucet claim is made only if the demo account needs tUSD. It saves the deterministic transaction hash before the single broadcast, uses bounded read-only RPC fallback to wait for `FINAL` outcomes, and captures every major result at 1440x900 and 375x812. It closes its Chrome and preview server in `finally`.

Public evidence defaults to `deployments/qa-browser-<UTC-date>.json`; screenshots and build logs go under the external `flow-qa/mienai/qa-signer/` directory named in [FLOW-QA.md](FLOW-QA.md). A completed ledger cannot be overwritten or replayed. `QA_DROP_SEND_RESPONSE=1` deliberately discards the first real broadcast response after the provider accepts it; the signer must recover by polling the saved hash, with no second broadcast. `pnpm test:e2e --resume` can continue a recorded interrupted run only when the last intended transaction has a known final outcome; it never repeats a recorded successful action. An uncertain outcome requires chain inspection first. `QA_EVIDENCE` and `QA_SCREENSHOTS` can select other public artifact paths; prior ledger spending still counts. `QA_TESTNET_RPC` accepts only the three explicit testnet endpoints. `CHROME_LOCK_PATH` can relocate the same shared lock helper.

This signer tests actual browser encryption, wallet calls, chain results and refreshed positions. Human Meteor sign-in and approval remain a separate manual compatibility check. The first complete run passed; the balance-verification run exposed a delayed RPC outcome and resumed from its publicly recovered FINAL check without sending that check again. See the ledgers and recovery note in `FLOW-QA.md`.

## R3 fixes and capped keeper — 12 Nov 2026

- `pnpm build`: PASS after the terminal fixes (TypeScript and Vite).
- `QA_BASE_URL=http://127.0.0.1:5391 pnpm test:e2e --read-only`: 36/36 PASS at 1440/375, reusing the one production preview. No transactions were sent.
- `pnpm test:sdk`: 13/13 PASS: five existing crypto tests and eight keeper budget-policy tests.
- Four CLI refusal checks passed without any transaction: insufficient reserve, insufficient UTC-day cap, missing CI secret, and malformed signing-key input (masked rather than logged).
- `actionlint` 1.7.7 and a YAML parser accepted `.github/workflows/keeper.yml`. GitHub execution is intentionally untested/off until Nick publishes and adds `SETER_KEEPER_KEY`.
- Two local `pnpm keeper` invocations each sent one real testnet transaction: the first finalized but its OutLayer receipt rejected the 0.005 attachment (required 0.007002); the second attached 0.01, completed request 10 and returned `fired 0`. Both sealed journals are retained. The keeper now treats a failed enclave callback as a failure even when the outer transaction succeeded.
- Failed probe: `C9ZYpNSzkkenzxLGAtS3j5goezATZH7hueckQ6xH2Zxh`; successful check: `gP1o99iyC2rTJcrMXv55N1KwoDuG8r8yr9JCsj5eTaG`. Cumulative real debit: **0.0032805207829979 testnet NEAR**, below 0.02 and the 0.3 R3 cap. See `deployments/r3-2026-11-12.json`.

`pnpm test:e2e --read-only` (also `pnpm test:web`) builds/serves the normal production app, runs real read-only Chrome checks at 1440 and 375 under the shared lock, and rejects any transaction broadcast. It covers every route, all timeframes and terminal tabs, market-field containment, collision-free marker spans, raw errors, page errors and document overflow. It takes screenshots named `test-<step>-<width>.png` and writes `web-results.json`. Use this command for UI regression without repeating paid wallet flows. `QA_BASE_URL` can reuse an existing local preview; otherwise the test owns and closes its preview. The Nov 11 paid browser-flow ledger remains historical; it was not replayed for R3.

Both terminal bugs reproduced before the fix. Before/after captures: `before-1440.png`, `before-375.png`, `after-1440.png`, `after-375.png`, plus chart crops. Source/Coinbase is fully in frame, measured marker spans are separated, and both viewport widths have no document overflow or page exceptions. Existing fonts, colours and the terminal grid are retained; only the bar's permitted wrapping and colliding marker text changed.

Screenshots were captured locally during QA and are not committed.

The paid browser harness now also uses the durable orchestration Chrome lock and screenshot directory, checks system memory free >=30% and disk free >=5 GB before builds, and checks memory again inside the browser lock. Its original paid flow was not re-executed for this brief.
