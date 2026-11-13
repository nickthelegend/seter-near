# Seter — encrypted stop-loss and take-profit orders on NEAR testnet.

Public stop levels can show other traders where forced selling will happen. Traders need to keep those levels private until a price crossing makes the order execute.

## Try it

Run locally with Node 22+ and pnpm 10. No hosted demo URL is recorded in this repo. The read-only demo needs internet access to NEAR testnet, Coinbase and OutLayer; it needs no wallet or local contracts.

1. From the repo root, run `pnpm install` - see the workspace dependencies install.
2. Run `pnpm build`, then `pnpm --filter @mienai/web preview` - see the production app served at `http://127.0.0.1:5201`.
3. Open `http://127.0.0.1:5201/` - see the product page, live market data and recorded testnet proof.
4. Open `http://127.0.0.1:5201/app` - see the trading terminal and sealed levels shown as `••••`. Open Order history - see the recorded fired stop.
5. Open `http://127.0.0.1:5201/order/1` - see the recorded trigger of 3.5967, the enclave price of 3.5886 and its attestation certificate. The certificate shows recorded verification checks and fetches the quote from OutLayer to hash in the browser.

6. Open `/order/16` (or any order) and scroll to **Two views** - see the owner's view next to **What everyone else sees**: the order's real `place_order` transaction arguments, read back from NEAR testnet, with no trigger, size or side in them.
7. Open `/book` - see every order as anyone can read it: owner, time, ciphertext, and `sealed` where an armed trigger would be.
8. Open `/activity` - see the event feed (sealed, checked, fired, cancelled), the enclave heartbeat (time since the last TDX check), recent fires in money terms and Coinbase NEAR-USD trades streamed over WebSocket.
9. Open `/portfolio?account=mienai-4e6b1225.testnet` - see one account's vault valued at the live price, its armed orders (levels hidden), fills and cancelled orders.
10. Open `/how-it-works` - see a labelled stop-hunting illustration, the four steps with live data and what is public versus sealed.
11. In `/app`, click **Connect wallet** and sign in with a funded Meteor testnet account, then click **Pay for a check · 0.02 NEAR** and approve it - see **Last check** and **Runs / rejected** update in **Enclave · Intel TDX**; open **Enclave log** to see the new check and `fired 0` if no armed trigger crossed, while the orders stay **Armed**.

To place your own testnet order, follow [Connecting a wallet](#connecting-a-wallet). The real browser flow passes with the test-only QA signer (`pnpm test:e2e`); production uses Meteor. Human Meteor sign-in and approval remain a manual compatibility check. See [FLOW-QA.md](FLOW-QA.md) for results and receipts. For this local-only demo, the public X post must include a video ([official rule Q-012](https://nearhackathon.com/HACKATHON.md)).

## Hosting

Hosting is prepared, not deployed: from the repository root, `pnpm install --frozen-lockfile && pnpm build` produces `packages/web/dist`. The static app uses public NEAR testnet defaults and needs no private key or server secret. `vercel.json` serves existing assets first and falls back to `index.html` for `/app`, `/order/<id>` and the other app routes; `.vercelignore` excludes credentials, environment files, signing-key files and local state from upload. Production removes the QA signer even when `VITE_QA_SIGNER=1` is set; QA also requires the separate `qa` build mode. Nick can use this configuration when he is ready to host. No deployment was made. See [Vercel configuration](https://vercel.com/docs/project-configuration/vercel-json).

## Live on NEAR testnet

| Contract | Account |
| --- | --- |
| Seter vault | [`mienai-3013a230.testnet`](https://testnet.nearblocks.io/address/mienai-3013a230.testnet) |
| tUSD test NEP-141 (6 decimals, no value) | [`mienai-ad65ebef.testnet`](https://testnet.nearblocks.io/address/mienai-ad65ebef.testnet) |
| OutLayer | [`outlayer.testnet`](https://testnet.nearblocks.io/address/outlayer.testnet) |

These transactions are copied from [the recorded run](deployments/real-run-2026-11-09.json), dated 9 Nov 2026.

| Recorded action | Transaction |
| --- | --- |
| Seal a stop-loss | [BZbja8Bm…](https://testnet.nearblocks.io/txns/BZbja8BmNU8FqisMXxzDGAAubZFJhEyihorC1YgEYrBb) |
| Seal a take-profit | [4zE2auAG…](https://testnet.nearblocks.io/txns/4zE2auAGmuREh8YRFnfW7XPqCjrAJuoNJmE9j74AZiPS) |
| Check at 3.6003; nothing fires | [79pRBKd3…](https://testnet.nearblocks.io/txns/79pRBKd3khVem5AANMeUWmjD7oVKmk7VQk6GAHoaGxm1) |
| Check at 3.5886; stop at 3.5967 fires on the test pool | [GMMwkN28…](https://testnet.nearblocks.io/txns/GMMwkN289YgzaqZkqmC5n5wHjWnwDe1K2G1MEjEY82iS) |
| Cancel the take-profit without revealing its level | [HojS7Jjq…](https://testnet.nearblocks.io/txns/HojS7Jjquqdz4nRgpm3uQa2ZPnZfEpyWA8bcpDNzizio) |

## Product and deployment details

Seter (סֵתֶר, Hebrew for "hidden / secret place") was formerly named Mienai. On-chain account IDs keep the old prefix. The `mienai:` domain-separation strings and `@mienai/*` package scopes also stay unchanged because deployed code and builds use them.

The browser encrypts an order to an OutLayer Intel TDX enclave. The NEAR contract stores encrypted order data and commitments, alongside public owner, timestamp and status metadata. The enclave reads Coinbase NEAR/USD and reports crossed orders. The contract verifies the signed report, settles on its own NEAR/tUSD test pool and publishes the trigger for audit.

The recorded enclave WASM hash is `791b4f6cab748be35d9f8c46c4df262bc8af13b4ade21a4b7e42c74e14a71386`. Its [FastFS upload transaction](https://testnet.nearblocks.io/txns/98mADfzvnHtLCwnwYzGLfqZKM6LRtnwotpXRMo7UvbMu) is in [the deployment record](deployments/testnet-2026-11-09.json).

### The recorded run (`deployments/real-run-2026-11-09.json`)

| Step | Transaction |
| --- | --- |
| Enclave publishes its keys (OutLayer TEE run through the contract) | [65uyDrTu…](https://testnet.nearblocks.io/txns/65uyDrTufTD6BKKFPsMMKPGRT7CUhPzuwU1rCpKv5hoQ) |
| Trader deposits 1 NEAR | [Ciu5geSz…](https://testnet.nearblocks.io/txns/Ciu5geSzbtyQGa1VzXS6eicJFeLiSzs7P7k2pdr47bWp) |
| Trader seals a stop-loss (sell 0.4 NEAR) while NEAR trades at 3.6021 | [BZbja8Bm…](https://testnet.nearblocks.io/txns/BZbja8BmNU8FqisMXxzDGAAubZFJhEyihorC1YgEYrBb) |
| Trader seals a take-profit (sell 0.4 NEAR) | [4zE2auAG…](https://testnet.nearblocks.io/txns/4zE2auAGmuREh8YRFnfW7XPqCjrAJuoNJmE9j74AZiPS) |
| Keeper check #1: enclave reads 3.6003, fires nothing | [79pRBKd3…](https://testnet.nearblocks.io/txns/79pRBKd3khVem5AANMeUWmjD7oVKmk7VQk6GAHoaGxm1) |
| **Keeper check #2: enclave reads 3.5886 (Coinbase trade 36356680), fires the stop at 3.5967, sells 0.4 NEAR for 1.2725 tUSD** | [GMMwkN28…](https://testnet.nearblocks.io/txns/GMMwkN289YgzaqZkqmC5n5wHjWnwDe1K2G1MEjEY82iS) |
| Trader cancels the take-profit; its trigger was never revealed | [HojS7Jjq…](https://testnet.nearblocks.io/txns/HojS7Jjquqdz4nRgpm3uQa2ZPnZfEpyWA8bcpDNzizio) |

The TDX attestation of check #2 was verified independently (`packages/sdk/src/attestation.mjs`): wasm hash pinned, input hash, output hash, `report_data` binds the task, measurements approved on `worker.outlayer.testnet`, Intel signature chain valid (TCB `UpToDate`). The full result is stored in the run record. Deploy steps and the pool seed are in `deployments/testnet-2026-11-09.json`; further sealed orders and the band report are in `deployments/book-2026-11-09.json`.

The [11 Nov full-flow check](FLOW-QA.md) adds live deposits, encrypted stop/take-profit placement, a fired stop, cancellation and both withdrawals. Its [public evidence](deployments/flow-qa-2026-11-11.json) records the transactions, restored vault balances and six passing TDX checks.

## How it works

1. **Seal (browser).** `packages/sdk/src/crypto.mjs` encrypts `{cond, trigger_e6, side, amount, salt}` to the enclave's X25519 key: ephemeral X25519 → HKDF-SHA256 → XChaCha20-Poly1305, with AAD `mienai:order:v1:<owner>` so a ciphertext copied onto another account's order does not open. The commitment is `sha256("mienai:commit:v1:" ‖ owner ‖ 0x00 ‖ plaintext)`. A second copy is sealed to a view key that stays on the user's device, so the owner can read their own levels back.
2. **Store (contract).** `place_order(ct, commit, view_ct)` stores encrypted order data and commitments with public owner, timestamp and status metadata. `get_orders` shows what anyone sees: ciphertexts, commitments, statuses, counts.
3. **Check (OutLayer).** Anyone can call `check()` and pay for a run. The contract builds the input from its own state and calls `outlayer.testnet.request_execution` with a `WasmUrl` pinned by SHA-256. A TDX worker runs `packages/enclave`; it fetches `https://api.exchange.coinbase.com/products/NEAR-USD/ticker` inside the enclave, opens every order, and outputs `{body, sig}` where `body` lists only crossed orders with their plaintext, plus price, trade id, trade time and source.
4. **Fire (contract).** The result arrives as the promise result of the contract's own request in the `#[private]` callback `on_result`. The callback and the public `fire(body, sig)` relay both verify the report. The relay can deliver a signed report for a pending or failed request within its expiry window. Acceptance requires: the ed25519 signature verifies against the enclave key (`env::ed25519_verify`); it answers an eligible request the contract issued (no replay); the price is from the pinned source and at most 180 s old; every revealed plaintext matches the order's commitment; and the price really crossed the trigger. Then it swaps against the vault's NEAR/tUSD constant-product pool and records the trigger, price, source, block and report hash in `get_fired`.

### Why only the enclave can read the orders

- The X25519 secret is `mac("orders", "mienai/x25519-order-key/v1")` from an OutLayer **encryption key** declared `bind: "wasm"`, `caller: "predecessor"`. OutLayer's keystore derives it inside the TEE from the WASM hash and the account that called OutLayer, the Seter contract. Another build, or a run started by anyone else, derives a different key and opens nothing.
- The report key is an OutLayer **signing key** with the same binding. The contract learns both public keys from an attested `keys` run that can only reach it through the private callback.
- The manifest embedded in the WASM (covered by its hash) admits runs only from `mienai-3013a230.testnet` (`callers.contract.only`) and allows HTTPS only to `api.exchange.coinbase.com`.
- The WASM build is reproducible: `bash scripts/build-enclave.sh` prints the hash pinned on the contract (rust 1.95.0, `Cargo.lock`, paths remapped).

## NEAR features used, and why

- **OutLayer TEE** (`outlayer.testnet`, yield/resume): the only party that can read the orders and the only source of fire reports.
- **Promise callbacks with `#[private]`** authenticate callback results. **`env::ed25519_verify`** verifies reports on both the callback and the public relay path.
- **NEP-141**: tUSD, the test quote token, with `ft_transfer_call` deposits into the vault.
- **FastFS** on testnet to host the WASM that OutLayer fetches by hash.
- **NEAR Intents** is not integrated. Mainnet execution code is not built; funding alone does not enable it (see [BLOCKED.md](BLOCKED.md)).
- Not used: Chain Signatures, sub-accounts, NEP-171/245, meta transactions, Sputnik DAO.

## Repository

| Path | What |
| --- | --- |
| `packages/enclave` | Rust WASI P2 component run by OutLayer (`keys`, `check`, `bands`). |
| `packages/contract` | Rust near-sdk vault: orders, requests, verification, pool, balances. Sandbox tests in `tests/`. |
| `packages/token` | tUSD test NEP-141 with an hourly faucet. |
| `packages/sdk` | Sealing, attestation verification, FastFS upload, deploy and run scripts. |
| `packages/web` | Vite + React app: landing (`/`), trading terminal (`/app`, Lightweight Charts), order pages with the two-views panel (`/order/<id>`), sealed book (`/book`), portfolio (`/portfolio`), activity (`/activity`) and how it works (`/how-it-works`). Live price over the Coinbase WebSocket ticker with REST fallback. |
| `deployments/` | Deployment and run evidence, including transaction hashes and the verified attestation. |
| `docs/RESEARCH.md` | OutLayer, price-source and execution research with links. |

## Reproduce

Prerequisites: Rust 1.95.0 with `wasm32-wasip2` and `wasm32-unknown-unknown`, `cargo-near` 0.22, Node 22+, pnpm 10.

```bash
pnpm install
pnpm build:enclave        # prints 791b4f6c… (the hash pinned on the contract)
pnpm test:enclave         # 9 tests: sealing, real Coinbase fixtures, crossing, k-anonymous bands
pnpm build:contract
pnpm test:contract        # 3 unit + 2 sandbox tests on a local nearcore (attacks rejected on chain)
pnpm test:sdk             # 5 tests, including a real report signed inside OutLayer TDX
pnpm build && pnpm --filter @mienai/web preview   # http://127.0.0.1:5201
```

Do X → see Y:

- Open `/` → a product page: live tiles (Coinbase NEAR/USD, sealed orders armed, last enclave check), live contract stats, "What a stop hunter sees" (the real ciphertexts next to what only the enclave read at the last check), a live read-only preview of the terminal, the attestation certificate of the recorded fire and the NEAR tech.
- Open `/app` without a wallet → a standard trading terminal: market bar (Coinbase last price, 24h change/high/low/volume, the price the enclave last read), a Lightweight Charts candle chart of Coinbase NEAR-USD with the enclave's read price as a dashed line and checks/fires as markers, a sealed book whose levels show as `••••`, an order panel (Market | Limit | Sealed stop | Sealed take-profit; Market and Limit explain why they are not offered) with a "Chain sees" ciphertext preview, and bottom tabs: Open orders (trigger hidden, status Armed), Order history (the fired stop with trigger 3.5967 and price 3.5886), Enclave log (built from `get_orders` and `get_request`) and Attestations (every recorded OutLayer run with its TDX quote fetched from OutLayer and hashed in the browser).
- Open `/order/1` → the fired stop: order summary, trigger 3.5967 against the 3.5886 the TEE read, and the attestation as a certificate (live TDX quote SHA-256, MRTD and RTMR3 compared with the recorded verification).
- Connect a testnet wallet ([Meteor Wallet](https://wallet.meteorwallet.app), see below), open Vault and deposit NEAR, then pick Sealed stop, set a trigger and amount and press Seal → the transaction stores encrypted order data and a commitment; your Open orders tab decrypts the trigger on your device.

### Connecting a wallet

Seter signs with [Meteor Wallet](https://wallet.meteorwallet.app) on NEAR testnet, through NEAR Wallet Selector 10.1.4. You need a `.testnet` account in Meteor (create or import one there; NEAR's guide is [Create an account](https://docs.near.org/getting-started/create-account), and free testnet NEAR comes from [near-faucet.io](https://near-faucet.io)). **Connect wallet** opens Meteor in a pop-up (or its browser extension) at `wallet.meteorwallet.app/connect/testnet/login`, asking for a function-call key on the Seter contract; the result is posted back to the page, so there is no redirect. Calls with no deposit (cancel, withdraw) are then signed by that key; sealing an order, a deposit or a paid check attaches NEAR and opens Meteor for approval. A blocked pop-up or a closed wallet window shows a plain banner. MyNearWallet was removed on 2026-11-10: its testnet pop-up now answers "MyNearWallet can't connect to apps anymore" and points to Meteor.

### Additional verification and redeployment

- `node packages/sdk/scripts/verify-attestation.mjs deployments/outlayer-direct-check-4RDtRKvrXwjEz7ShLfgdSnWfDCNcWSksDvrtYRpvrWrK.json 999ec172cd7fa60bf66c6803183332deaabef30d0434793c8cf9da85b81080fe` → reruns the six attestation checks for the probe run; requires OutLayer, NEAR RPC and Intel collateral access.
- Redeployment is separate from the read-only demo. The existing scripts are `packages/sdk/scripts/create-account.mjs`, `upload-enclave.mjs`, `deploy-testnet.mjs` and `real-run.mjs`. They create accounts, spend testnet NEAR and write deployment evidence. A fresh deployment requires changing `packages/enclave/manifest.json` to the new contract account before rebuilding. `real-run.mjs` reads the fixed `deployments/testnet-2026-11-09.json` path, so it must be adapted to a new deployment record before reuse.

## Capped keeper (prepared, switched off)

Run `pnpm keeper` from the repo root to pay for one `check()` using the existing local keeper/deployer account, `mienai-3013a230.testnet`. This is the account that signed the recorded keeper checks; its key is loaded by file path and never printed. The command sends at most one transaction and saves its hash before broadcast under `deployments/keeper/`.

The default spendable reserve is 1 NEAR (`KEEPER_RESERVE_NEAR`), the per-run cap is 0.045 NEAR (`KEEPER_RUN_CAP_NEAR`), and the per-UTC-day cap is 0.05 NEAR (`KEEPER_DAILY_CAP_NEAR`). The script attaches 0.01 NEAR and reserves the full 240 Tgas at 125% of the current gas price before signing. Final daily charges conservatively include the full attachment plus all burned gas, even if funds were refunded. A low balance, insufficient cap room, unfinished journal or reservation overrun refuses another paid run. Keep the journal: deleting it defeats the cap.

OutLayer compute costs about 0.001 NEAR plus gas per check, but it needs a larger upfront reservation: on 12 Nov it required 0.007002 NEAR, so the contract's 0.005 NEAR minimum was insufficient. The successful 0.01-attached check debited 0.00251135 NEAR after refunds and returned `fired 0`; the failed probe and successful retry together spent 0.00328052 NEAR. Both hashes and the failure reason are in [the R3 record](deployments/r3-2026-11-12.json).

`.github/workflows/keeper.yml` attempts one run every 15 minutes. It does no paid work unless the GitHub Actions secret **`SETER_KEEPER_KEY`** exists. Nick must add that testnet signing-key secret and fund its account; `KEEPER_ACCOUNT_ID` can select a dedicated testnet keeper instead of the historical account. The reserve and daily cap can be set as repository variables. Conservative reservations mean some ticks will refuse; the cron is not a guarantee of 96 checks a day.

The workflow serializes runs and restores the previous active run's public journal artifact before spending. A missing artifact fails closed. It preserves journals even when a check fails and refuses workflow reruns. No workflow was enabled or executed in this task. For an uncertain local outcome, `pnpm keeper --reconcile <journal-filename.json>` only polls the saved hash; it never sends another check. Human Meteor approval remains a separate manual compatibility check.

## Limits, stated plainly

- One price source (Coinbase NEAR-USD last trade). A second source and a median would be stronger.
- A keeper must pay for checks (about 0.001 NEAR of OutLayer compute plus gas per check); the prepared schedule stays off until Nick adds its secret.
- The fill happens on Seter's own test pool, so the execution itself is public once it fires. Private execution is not built.
- The browser keeps the view key in `localStorage`; losing it loses the owner's local copy of the levels, not the order.
- Every public check that fires nothing reveals that no armed trigger was crossed at price P, and repeated checks at different prices narrow where levels can be.
- The k-anonymous band report leaks how levels are distributed.
- Up to 16 open orders per contract (one enclave run reads all of them).

## Hackathon disclosures

Built for NEAR HACKATHON 2026 (Nov 1-14). Submission deadline: 2026-11-14 23:59 UTC ([official rules](https://nearhackathon.com/HACKATHON.md)).

### Prior work

For this submission, code before 2026-11-01 is baseline; only the NEAR work built during Nov 1-14 is claimed for judging. The available git history has no project commits before Nov 1. The first commit, `73cbc1d` (9 Nov 2026), contains only `LICENSE` and `.gitignore`. No `NOTICE` file is tracked. The MIT license names Nivesh Gajengi and the year 2026; it gives no earlier development date.

The history records the OutLayer enclave, sealing SDK, NEAR vault, tUSD contract, tests, testnet deployments and web demo on Nov 9-10. Commit `bf32baa` renames Mienai to Seter during that same window. Mienai is this project's former name. The comment at the top of `packages/sdk/src/attestation.mjs` credits the attestation-verification method first worked out in the team's sibling project Kotoba. This repo does not establish Kotoba's development dates; that shared method is disclosed rather than claimed as new to Seter.

To inspect the implementation added after the license-only scaffold, run `git diff 73cbc1d 271c504 -- packages scripts pnpm-lock.yaml pnpm-workspace.yaml`. These are fixed commits in this repo; the range covers the implementation through the Meteor Wallet update.

Existing third-party libraries and services are dependencies, not new work claimed by the team. They include near-sdk, near-workspaces, NEAR Wallet Selector, OutLayer, the Noble crypto libraries, dcap-qvl, React, Vite, Lightweight Charts and web3icons. Versions are recorded in the package manifests and lockfiles; logo attribution is in [Credits](#credits).

### AI-assisted code

Built with AI coding agents (Claude Code, Codex) under human direction; all code reviewed and tested by the team.

### Other projects by the same team in this hackathon

Lead: <TBD by Nick>

### License

MIT. See [LICENSE](LICENSE).

## License

MIT, Copyright (c) 2026 Nivesh Gajengi.

## Credits

- The NEAR token logo comes from [`@web3icons/core`](https://github.com/0xa3k5/web3icons) 4.0.58 (branded variant), MIT licensed and bundled into the web build (no hotlinking). The logo remains the trademark of its project and is used only to identify the asset.
- The quote asset is the US dollar (Coinbase `NEAR-USD`). Fiat USD has no mark in that package, so the app draws a plain dollar disc for it.
- tUSD is Seter's own test token with no value. It shows the same dollar disc, never a real stablecoin's logo; from 20 px up the logo carries a "test" tag, and the "tUSD" ticker is always written next to it.
- 3D art generated with ChatGPT: the frosted violet glass objects in `packages/web/public/art/3d` (kit, prompts and placements in [docs/ART-3D.md](docs/ART-3D.md)).
