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
| Second price source: OutLayer price oracle (not ours) | [`price-oracle.testnet`](https://testnet.nearblocks.io/address/price-oracle.testnet) |
| Scoped keeper key on the vault (function call, `check` only, 2 NEAR gas allowance) | `ed25519:EEgpZvdE…` (full key in [the upgrade record](deployments/second-source/upgrade-2026-11-14.json)) |

### Two price sources and a scoped keeper key (upgrade of 13–14 Nov, testnet)

Since this upgrade, a fire needs two TEE price sources to agree, and the keeper signs with a key that can only call `check`. The vault was upgraded in place: same account, same state and the same enclave hash, so every order and record above is unchanged. The 13 Nov films were recorded before this upgrade; the 14 Nov film below uses it.

| Step | Transaction |
| --- | --- |
| Probe: one paid refresh of `price-oracle.testnet` from the trader (NEAR 3.5114 vs Coinbase 3.5072) | [53Lsy4AP…](https://testnet.nearblocks.io/txns/53Lsy4APti6hkneCNJBfLm9WMm7gn1zJsqCgRDFkJtne) |
| Upgrade the vault in place to the two-source build (wasm `ab042db7…`); state preserved | [5tDHzuba…](https://testnet.nearblocks.io/txns/5tDHzubaHDz6ZwBsCeodqgMNi6thNEZ11vrXtSm27Tty) |
| Fund the keeper budget with 0.2 NEAR (`fund_keeper`) | [GdYa764C…](https://testnet.nearblocks.io/txns/GdYa764C5qV3iVDsLfu7P9XpcvWQcYCrunWnJg4Z8HsK) |
| Add a function-call key limited to `check` (first try: 0.25 NEAR allowance) | [GNP7twTv…](https://testnet.nearblocks.io/txns/GNP7twTv2mpSXBsdEmhrF1eJGnBNDs4z72uoM4L54NqP) |
| Swap that key for one allowed 2 NEAR. NEAR reserves about 0.30 NEAR of allowance up front for a 300 Tgas call and refunds the unused gas afterwards. | [55xBKAGR…](https://testnet.nearblocks.io/txns/55xBKAGRduhJDyeUQZtbCNzFqLbhzUG84HR4j1S8x8tf) |
| Trader seals stop №18 (sell 0.05 NEAR, set 2% above Coinbase 3.5038 so the next check crosses it); trigger hidden on chain | [T8tXKcVj…](https://testnet.nearblocks.io/txns/T8tXKcVjZ21HXRgN2SeigabVz4FFCh5xYQUfBXLHb41) |
| **Keeper check signed by the scoped key, no deposit: the enclave reads Coinbase 3.5058 and reports №18; the vault asks `price-oracle.testnet`, which reads 3.5110 (15 bps apart, limit 100); only then does №18 fire. TDX attestation of the enclave run passes 6/6 (TCB UpToDate).** | [8MehJtyr…](https://testnet.nearblocks.io/txns/8MehJtyrBSeCv9cjeVfoiZ7TanZecUZhdPPeicHAaL6r) |
| `pnpm keeper` with the scoped key: nothing crossed (`fired 0`), so the oracle is never asked and its 0.01 NEAR reserve goes back to the budget (0.18 → 0.17 NEAR) | [AXwyjgTB…](https://testnet.nearblocks.io/txns/AXwyjgTBmFNr8pXXdCk5nBqviBjninsKVPmC3zV4Zm4p) |

The protocol refused the same keeper key three times before anything ran, so these transactions have no explorer page. The rejected transactions are listed in [the run record](deployments/second-source/two-source-fire-2026-11-13.json) with the hashes they would have had:
- `withdraw_near` was refused with "Access key does not allow method withdraw_near".
- `check` with 0.02 NEAR attached was refused with "Deposit is not allowed with function call".
- A call to the tUSD contract was refused with "Access key receiver … does not match".

The vault's original full-access key is still on the account. Removing it is Nick's decision.

These transactions are copied from [the recorded run](deployments/real-run-2026-11-09.json), dated 9 Nov 2026.

| Recorded action | Transaction |
| --- | --- |
| Seal a stop-loss | [BZbja8Bm…](https://testnet.nearblocks.io/txns/BZbja8BmNU8FqisMXxzDGAAubZFJhEyihorC1YgEYrBb) |
| Seal a take-profit | [4zE2auAG…](https://testnet.nearblocks.io/txns/4zE2auAGmuREh8YRFnfW7XPqCjrAJuoNJmE9j74AZiPS) |
| Check at 3.6003; nothing fires | [79pRBKd3…](https://testnet.nearblocks.io/txns/79pRBKd3khVem5AANMeUWmjD7oVKmk7VQk6GAHoaGxm1) |
| Check at 3.5886; stop at 3.5967 fires on the test pool | [GMMwkN28…](https://testnet.nearblocks.io/txns/GMMwkN289YgzaqZkqmC5n5wHjWnwDe1K2G1MEjEY82iS) |
| Cancel the take-profit without revealing its level | [HojS7Jjq…](https://testnet.nearblocks.io/txns/HojS7Jjquqdz4nRgpm3uQa2ZPnZfEpyWA8bcpDNzizio) |

### Filmed in the app on 13 Nov 2026 (`deployments/film-2026-11-13.json`)

| In-app action | Transaction |
| --- | --- |
| Seal stop №16 (sell 0.2 NEAR, trigger 3.5305 while NEAR traded at 3.4886); trigger hidden on chain | [3AsXyWwy…](https://testnet.nearblocks.io/txns/3AsXyWwyrW7EDRfRZbcWUVHvBTCv1qa6jEQGzJSKawtH) |
| Paid check: the enclave reads 3.4854 (Coinbase trade 36575004), fires №16, sells 0.2 NEAR for 0.682980 tUSD; TDX attestation 6/6 checks | [9Jff4h8J…](https://testnet.nearblocks.io/txns/9Jff4h8JPCZbase4gMgcgK2DoLTYY5uZrv6V2V6Qphbx) |
| Cancel order №5; its trigger was never revealed | [GbBRFrWs…](https://testnet.nearblocks.io/txns/GbBRFrWsi47ND6PcvHToxdH2gGmpZ4nt78PQpYryZabB) |

The film was re-recorded the same evening for clean subtitles (`deployments/film-2026-11-13b.json`): seal stop №17 (trigger 3.5367) [8XGosiUZ…](https://testnet.nearblocks.io/txns/8XGosiUZtLN3aNfCdasQoaseEAiEKEuqJ3jZZLDg1Hdk); check reads 3.5024 and fires it, 0.2 NEAR → 0.652121 tUSD, attestation 6/6 [9KRm7G6d…](https://testnet.nearblocks.io/txns/9KRm7G6dWV6Wutcn9Uy6aEAttV25kXB76T8cXhi6mJNy); cancel №4 [2AUm4jMP…](https://testnet.nearblocks.io/txns/2AUm4jMPnGwse13FTuMi3ptSM3zmTevLNZxeSMraQ9SU).

### Filmed on 14 Nov 2026 with the two-source build (`deployments/film-2026-11-14-v4.json`)

Each user transaction was approved on camera in the test wallet's **Approve transaction** sheet and then shown on the public explorer (nearvalidate.org):
- Seal stop №19 (trigger 3.4729, sell 0.2 NEAR; Coinbase 3.4317 at placement): [Dc7DPhQE…](https://testnet.nearblocks.io/txns/Dc7DPhQEL3PqEmsKUk1HsC1xejpZR2eee3NanM5spc3B).
- Keeper check signed by the check-only key, paid from the keeper budget: [5T6o5jEb…](https://testnet.nearblocks.io/txns/5T6o5jEbzPW1mQpwTjMNhDGxdD1tAURHUQCfvgGaNiws). The enclave read 3.4276 and price-oracle.testnet read 3.4313 (11 bps apart, limit 100), so №19 fired: 0.2 NEAR → 0.616403 tUSD. TDX attestation of the vault's run: 6/6 (`verify-film-fire.mjs`). Keeper journal: `deployments/keeper/2026-11-13-1794609837483-5a8db899.json`.
- Cancel №3, trigger never published: [7GvkZdjb…](https://testnet.nearblocks.io/txns/7GvkZdjbvQLb1z1r7GZkozcgG5buYWbfRtGSBMm9uD3v).

Before filming, the trader deposited 0.3 NEAR into its own vault off camera (`deployments/film-v4-prep-2026-11-14.json`).

Before filming, `rebalance-pool.mjs` deepened the test pool (+5 NEAR, +20.13 tUSD) and returned its price to Coinbase 3.5061 (`deployments/pool-rebalance-2026-11-13.json`).

### Order types and public orders (upgrade and film of 14 Nov, `deployments/order-types/`, `deployments/film-2026-11-14-v5.json`)

The vault was upgraded in place again ([Aw5AyCjh…](https://testnet.nearblocks.io/txns/Aw5AyCjhWtvmgASVGrgjQiQtTzUtHqqFCyhY9Ye5Y6aF)): same account, same state, same enclave hash. New storage lives in raw slots, so the deployed state struct is unchanged; `order_types_upgrade_keeps_state` replays the upgrade from the exact previous code. What it adds:
- **Market orders** (`market_order(side, amount, min_out)`): swap now against the test pool from the vault balance, refused below `min_out`. No trigger, so nothing to seal.
- **Sealed limit buy**: a sealed order with `side: buy` (spend tUSD when NEAR falls to the limit). No contract change; the enclave already accepted `buy`.
- **OCO pairs** (`place_oco(a, b)`): two sealed orders in one transaction. When one fires, the other is cancelled in the same transaction, never revealed. Cancelling one cancels both. Only the link between the two order numbers is public.
- **Public orders, no seal** (`place_public_order(kind, cond, trigger_usd, side, amount)`): for comparison. The trigger is in the arguments and in `get_public_orders`. They fire on the same signed, two-source-checked check price. The book page shows them as a bot reads them, next to the sealed book.
- Trailing stops are not built: they need state inside the enclave, and changing the enclave changes its keys.

Before filming, the trader deposited 1.5 NEAR into its vault and placed two public and two sealed stops (0.10 and 0.15 NEAR) at $3.28, off camera (`deployments/film-v5-prep-2026-11-14.json`). `rebalance-pool.mjs` returned the pool to Coinbase 3.3215 first (`deployments/pool-rebalance-2026-11-14.json`).

Filmed in the app; each was approved on camera in the test wallet sheet and shown on nearvalidate.org:

| In-app action | Transaction |
| --- | --- |
| Public stop P3 (no seal): sell 0.2 NEAR at `"trigger_usd": "3.2800"`, readable in the arguments | [2uFvSfTi…](https://testnet.nearblocks.io/txns/2uFvSfTiPkMuNzFH9kabYMWctedqEiBQ8yF4VgmLucse) |
| Market sell 0.05 NEAR → 0.164762 tUSD on the test pool | [8HTwn3LH…](https://testnet.nearblocks.io/txns/8HTwn3LHWnqShDXmJZctsV38eM2wtsLcfL2Zh6i5fM94) |
| Sealed limit buy №22 (spend 0.50 tUSD; limit 3.3686, 1.5% above the market so the next check fills it) | [9icSTTgr…](https://testnet.nearblocks.io/txns/9icSTTgrDVCPinJ8ouA3SaLmQf1YLKURxiUjBKHurEoU) |
| Sealed take-profit №23 (sell 0.05 NEAR at 3.4184); still armed | [5M2Xo8nR…](https://testnet.nearblocks.io/txns/5M2Xo8nRud5WjUoUBDbaNVvAePcUdL9PsT3tnjeBz9SY) |
| Sealed OCO pair №24 + №25 (stop 3.3686 just above the market, take-profit 3.4184; 0.05 NEAR each) | [FxBQp5MR…](https://testnet.nearblocks.io/txns/FxBQp5MRyKTa42A6bYG3BrNW6HBHQZmvMRQuWfsWHExk) |
| **Keeper check (check-only key): enclave 3.3310, `price-oracle.testnet` 3.3343 (10 bps apart). №22 bought 0.149339 NEAR for 0.50 tUSD; №24 sold 0.05 NEAR for 0.168057 tUSD; №25 cancelled in the same transaction, never revealed** | [HbFZQWKw…](https://testnet.nearblocks.io/txns/HbFZQWKw22CMTr4ovnZZmui5MCnpgLYdxAZPq2nJQCsu) |

The first keeper check of that session failed inside OutLayer ([Dt6AMdpK…](https://testnet.nearblocks.io/txns/Dt6AMdpK32GSDYTCGgmmd3NzFAYgqTr7GJF2XnJd5pWp), "Execution promise failed"). The vault marked request 18 Failed and nothing executed; the keeper budget paid 0.0215 NEAR. The film shows the second check.

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
4. **Second source (contract, since 14 Nov).** A report that crosses an order doesn't execute straight away. The vault calls OutLayer's price oracle `price-oracle.testnet` (`request_price_data(["wrap.near"])`). The oracle is a separate TEE program run by another operator. It takes the median price across many exchanges and refreshes it on demand, paid from a 0.01 NEAR reserve held back from the check. In `on_second_source`, the contract re-validates the whole report. It refuses the report unless the oracle's price is within `tolerance_bps` (100 bps = 1%) of the enclave's Coinbase price (`ERR_SOURCES_DISAGREE`). It also refuses when the oracle has no fresh price (`ERR_SECOND_SOURCE_UNAVAILABLE`). Both prices are stored with the fire (`get_fire_second_source`). If no order crossed, the oracle isn't asked and the reserve goes back to whoever paid.
5. **Fire (contract).** The result arrives as the promise result of the contract's own request in the `#[private]` callback `on_result`. The callback and the public `fire(body, sig)` relay both verify the report. The relay can deliver a signed report for a pending or failed request within its expiry window. Acceptance requires: the ed25519 signature verifies against the enclave key (`env::ed25519_verify`); it answers an eligible request the contract issued (no replay); the price is from the pinned source and at most 180 s old; every revealed plaintext matches the order's commitment; the price really crossed the trigger; and the second source agrees (step 4; a relayer attaches the 0.01 NEAR oracle fee). Then it swaps against the vault's NEAR/tUSD constant-product pool and records the trigger, price, source, block and report hash in `get_fired`.

### Why only the enclave can read the orders

- The X25519 secret is `mac("orders", "mienai/x25519-order-key/v1")` from an OutLayer **encryption key** declared `bind: "wasm"`, `caller: "predecessor"`. OutLayer's keystore derives it inside the TEE from the WASM hash and the account that called OutLayer, the Seter contract. Another build, or a run started by anyone else, derives a different key and opens nothing.
- The report key is an OutLayer **signing key** with the same binding. The contract learns both public keys from an attested `keys` run that can only reach it through the private callback.
- The manifest embedded in the WASM (covered by its hash) admits runs only from `mienai-3013a230.testnet` (`callers.contract.only`) and allows HTTPS only to `api.exchange.coinbase.com`.
- The WASM build is reproducible: `bash scripts/build-enclave.sh` prints the hash pinned on the contract (rust 1.95.0, `Cargo.lock`, paths remapped).

## NEAR features used, and why

- **OutLayer TEE** (`outlayer.testnet`, yield/resume): the only party that can read the orders and the only source of fire reports.
- **OutLayer price oracle** (`price-oracle.testnet`): the second, independent TEE price source, called cross-contract (`request_price_data`) between the enclave report and the fire.
- **Function-call access key**: the keeper key on the vault account can only call `check`. It can't attach NEAR, so `check` with no deposit from the vault account is paid from an on-chain keeper budget (`fund_keeper`), never from user balances.
- **Promise callbacks with `#[private]`** authenticate callback results. **`env::ed25519_verify`** verifies reports on both the callback and the public relay path.
- **NEP-141**: tUSD, the test quote token, with `ft_transfer_call` deposits into the vault.
- **FastFS** on testnet to host the WASM that OutLayer fetches by hash.
- **NEAR Intents** is not integrated. Mainnet execution code is not built; funding alone does not enable it (see [BLOCKED.md](BLOCKED.md)).
- Not used: Chain Signatures, sub-accounts, NEP-171/245, meta transactions, Sputnik DAO, gas keys (the keeper needs one nonce; a plain function-call key is enough).

## Repository

| Path | What |
| --- | --- |
| `packages/enclave` | Rust WASI P2 component run by OutLayer (`keys`, `check`, `bands`). |
| `packages/contract` | Rust near-sdk vault: orders, requests, verification, pool, balances. Sandbox tests in `tests/`. |
| `packages/token` | tUSD test NEP-141 with an hourly faucet. |
| `packages/sdk` | Sealing, attestation verification, FastFS upload, deploy and run scripts. |
| `packages/web` | Vite + React app: landing (`/`), trading terminal (`/app`, Lightweight Charts; market, limit, stop, take-profit and OCO tickets, sealed or public), order pages with the two-views panel (`/order/<id>`), sealed book (`/book`), portfolio (`/portfolio`), activity (`/activity`) and how it works (`/how-it-works`). Live price over the Coinbase WebSocket ticker with REST fallback. |
| `deployments/` | Deployment and run evidence, including transaction hashes and the verified attestation. |
| `docs/RESEARCH.md` | OutLayer, price-source and execution research with links. |

## Reproduce

Prerequisites: Rust 1.95.0 with `wasm32-wasip2` and `wasm32-unknown-unknown`, `cargo-near` 0.22, Node 22+, pnpm 10.

```bash
pnpm install
pnpm build:enclave        # prints 791b4f6c… (the hash pinned on the contract)
pnpm test:enclave         # 9 tests: sealing, real Coinbase fixtures, crossing, k-anonymous bands
pnpm build:contract
pnpm test:contract        # 7 unit + 4 sandbox tests on a local nearcore (attacks rejected on chain), with the
                          # real OutLayer price-oracle contract deployed beside the vault (tests/fixtures)
pnpm test:sdk             # 13 tests, including a real report signed inside OutLayer TDX and the keeper caps
pnpm build && pnpm --filter @mienai/web preview   # http://127.0.0.1:5201
```

Do X → see Y:

- Open `/` → a product page: live tiles (Coinbase NEAR/USD, sealed orders armed, last enclave check), live contract stats, "What a stop hunter sees" (the real ciphertexts next to what only the enclave read at the last check), a live read-only preview of the terminal, the attestation certificate of the recorded fire and the NEAR tech.
- Open `/app` without a wallet → a standard trading terminal: market bar (Coinbase last price, 24h change/high/low/volume, the price the enclave last read), a Lightweight Charts candle chart of Coinbase NEAR-USD with the enclave's read price as a dashed line and checks/fires as markers, a sealed book whose levels show as `••••`, an order panel (Market | Limit | Sealed stop | Sealed take-profit; Market and Limit explain why they are not offered) with a "Chain sees" ciphertext preview, and bottom tabs: Open orders (trigger hidden, status Armed), Order history (the fired stop with trigger 3.5967 and price 3.5886), Enclave log (built from `get_orders` and `get_request`) and Attestations (every recorded OutLayer run with its TDX quote fetched from OutLayer and hashed in the browser).
- Open `/order/1` → the fired stop: order summary, trigger 3.5967 against the 3.5886 the TEE read, and the attestation as a certificate (live TDX quote SHA-256, MRTD and RTMR3 compared with the recorded verification).
- Connect a testnet wallet ([Meteor Wallet](https://wallet.meteorwallet.app), see below), open Vault and deposit NEAR, then pick Sealed stop, set a trigger and amount and press Seal → the transaction stores encrypted order data and a commitment; your Open orders tab decrypts the trigger on your device.

### Connecting a wallet

Seter signs with [Meteor Wallet](https://wallet.meteorwallet.app) on NEAR testnet, through NEAR Wallet Selector 10.1.4. You need a `.testnet` account in Meteor (create or import one there; NEAR's guide is [Create an account](https://docs.near.org/getting-started/create-account), and free testnet NEAR comes from [near-faucet.io](https://near-faucet.io)). **Connect wallet** opens Meteor in a pop-up (or its browser extension) at `wallet.meteorwallet.app/connect/testnet/login`, asking for a function-call key on the Seter contract; the result is posted back to the page, so there is no redirect. Calls with no deposit (cancel, withdraw) are then signed by that key; sealing an order, a deposit or a paid check attaches NEAR and opens Meteor for approval. A blocked pop-up or a closed wallet window shows a plain banner. MyNearWallet was removed on 2026-11-10: its testnet pop-up now answers "MyNearWallet can't connect to apps anymore" and points to Meteor.

The build-gated test wallet used for QA and the films (`vite build --mode qa` with `VITE_QA_SIGNER=1`; never in production builds) behaves like a wallet pop-up: before it signs, an **Approve transaction** sheet shows the network, signer, receiving contract, method, the key arguments in plain words (for `place_order`: the trigger and size are an encrypted blob, no price in the arguments), the deposit and the gas limit. **Reject** sends nothing.

### Additional verification and redeployment

- `node packages/sdk/scripts/verify-attestation.mjs deployments/outlayer-direct-check-4RDtRKvrXwjEz7ShLfgdSnWfDCNcWSksDvrtYRpvrWrK.json 999ec172cd7fa60bf66c6803183332deaabef30d0434793c8cf9da85b81080fe` → reruns the six attestation checks for the probe run; requires OutLayer, NEAR RPC and Intel collateral access.
- Redeployment is separate from the read-only demo. The existing scripts are `packages/sdk/scripts/create-account.mjs`, `upload-enclave.mjs`, `deploy-testnet.mjs` and `real-run.mjs`. They create accounts, spend testnet NEAR and write deployment evidence. A fresh deployment requires changing `packages/enclave/manifest.json` to the new contract account before rebuilding. `real-run.mjs` reads the fixed `deployments/testnet-2026-11-09.json` path, so it must be adapted to a new deployment record before reuse.

## Keeper: a scoped key and an on-chain budget

`pnpm keeper` pays for one `check()` with the **function-call key** on the vault account. The key is limited to `check` on `mienai-3013a230.testnet` and has a 2 NEAR gas allowance. It is loaded from `.near-credentials/keeper-fc.json` (gitignored) and never printed. NEAR refuses any transaction from this key that calls another method or contract, or that attaches NEAR. That means the key can't withdraw, cancel, seed or upgrade anything. A copy of it in CI can only buy checks.

Because the key can't attach a deposit, `check()` called by the vault account with no deposit takes 0.02 NEAR (0.01 for the enclave run plus the 0.01 oracle reserve) from the **keeper budget**. Anyone can top up that budget with `fund_keeper`, and `get_second_source` shows it. User balances are never touched. An unused oracle reserve goes back into the budget. OutLayer's refund of unused compute, about 0.009 NEAR per run, lands on the vault account but isn't credited to the budget.

The script sends at most one transaction and saves its hash before broadcast under `deployments/keeper/`. It refuses a run that its caps don't cover:
- **Per run** (`KEEPER_RUN_CAP_NEAR`, default 0.06 NEAR): the 0.02 NEAR check cost plus 300 Tgas at 125% of the current gas price.
- **Per UTC day** (`KEEPER_DAILY_CAP_NEAR`, default 0.25 NEAR).
- **Budget reserve** (`KEEPER_RESERVE_NEAR`, default 0): the keeper budget must stay above it.

It also refuses after a reservation overrun or while an earlier journal is unfinished. Keep the journal, because deleting it defeats the cap. `pnpm keeper --reconcile <journal-filename.json>` only polls a saved hash; it never sends another check.

`.github/workflows/keeper.yml` tries one run every 15 minutes. It does no paid work unless the GitHub Actions secret **`SETER_KEEPER_KEY`** exists, and that secret should now be the function-call key. No workflow was enabled or executed. Conservative reservations mean some ticks will refuse, so the cron isn't a guarantee of 96 checks a day.

## Limits, stated plainly

- Two price sources, not two independent markets. The enclave reads the Coinbase NEAR-USD last trade; `price-oracle.testnet` takes the median of about 14 venues, Coinbase among them. A fire needs the two within 1%, and both run in TEEs. The oracle is OutLayer's contract and is refreshed on demand. If it can't produce a fresh price, fires are refused until it can, so an oracle outage blocks fires rather than weakening them.
- The vault owner can switch the second source off or change the tolerance (10–500 bps) with `set_second_source`. Every change is logged as an event. With it off, fires fall back to the original single-source rule.
- A fire costs up to 0.01 NEAR more (the oracle's OutLayer run). The oracle's refunds return to the vault account, not to the payer.
- The vault account still has its original full-access key next to the scoped keeper key. Deleting it would also remove the ability to upgrade, so it is left to Nick.
- Someone must pay for checks: about 0.001 NEAR of OutLayer compute plus gas per check, drawn from the keeper budget or paid by a user. The prepared schedule stays off until Nick adds the scoped key as its secret.
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
