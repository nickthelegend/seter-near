# Seter (סֵתֶר, Hebrew for "hidden / secret place")

Formerly Mienai; on-chain account IDs keep the old prefix.
The `mienai:` domain-separation strings in the sealing format and the `@mienai/*` package scopes are also unchanged, because the deployed enclave and contract check those strings and the builds reference those scopes.

**Your stop-loss is invisible until it fires.**

Large traders push prices to where stop-losses and liquidation levels sit, trigger them, and buy the forced selling cheaply: stop hunting. That works because stop levels are visible, on a centralized exchange's books or in a DeFi contract's state.

With Seter, a stop-loss or take-profit is encrypted in the browser to a program running in an OutLayer TEE (Intel TDX). The NEAR contract stores only the ciphertext and a commitment hash. On each check the enclave reads NEAR/USD from Coinbase, opens every order, and reports only the ones whose trigger the price crossed. The contract accepts that report only through a verified OutLayer callback carrying the enclave's signature, swaps the order, and then publishes the trigger so anyone can audit that the price really crossed it.

Everything below runs on NEAR testnet and was run for real on 9 Nov 2026.

## Live on NEAR testnet

| What | Account / value | Explorer |
| --- | --- | --- |
| Seter vault contract | `mienai-3013a230.testnet` | [nearblocks](https://testnet.nearblocks.io/address/mienai-3013a230.testnet) |
| tUSD test NEP-141 (6 decimals, no value) | `mienai-ad65ebef.testnet` | [nearblocks](https://testnet.nearblocks.io/address/mienai-ad65ebef.testnet) |
| Enclave WASM (FastFS) | sha256 `791b4f6cab748be35d9f8c46c4df262bc8af13b4ade21a4b7e42c74e14a71386` | [upload tx](https://testnet.nearblocks.io/txns/98mADfzvnHtLCwnwYzGLfqZKM6LRtnwotpXRMo7UvbMu) |
| OutLayer | `outlayer.testnet` | — |

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

## How it works

1. **Seal (browser).** `packages/sdk/src/crypto.mjs` encrypts `{cond, trigger_e6, side, amount, salt}` to the enclave's X25519 key: ephemeral X25519 → HKDF-SHA256 → XChaCha20-Poly1305, with AAD `mienai:order:v1:<owner>` so a ciphertext copied onto another account's order does not open. The commitment is `sha256("mienai:commit:v1:" ‖ owner ‖ 0x00 ‖ plaintext)`. A second copy is sealed to a view key that stays on the user's device, so the owner can read their own levels back.
2. **Store (contract).** `place_order(ct, commit, view_ct)` keeps only those strings. `get_orders` shows what anyone sees: ciphertexts, commitments, statuses, counts.
3. **Check (OutLayer).** Anyone can call `check()` and pay for a run. The contract builds the input from its own state and calls `outlayer.testnet.request_execution` with a `WasmUrl` pinned by SHA-256. A TDX worker runs `packages/enclave`; it fetches `https://api.exchange.coinbase.com/products/NEAR-USD/ticker` inside the enclave, opens every order, and outputs `{body, sig}` where `body` lists only crossed orders with their plaintext, plus price, trade id, trade time and source.
4. **Fire (contract).** The result arrives as the promise result of the contract's own request in the `#[private]` callback `on_result`. The contract accepts the report only if: the ed25519 signature verifies against the enclave key (`env::ed25519_verify`); it answers a pending request the contract issued (no replay); the price is from the pinned source and at most 180 s old; every revealed plaintext matches the order's commitment; and the price really crossed the trigger. Then it swaps against the vault's NEAR/tUSD constant-product pool and records the trigger, price, source, block and report hash in `get_fired`.

### Why only the enclave can read the orders

- The X25519 secret is `mac("orders", "mienai/x25519-order-key/v1")` from an OutLayer **encryption key** declared `bind: "wasm"`, `caller: "predecessor"`. OutLayer's keystore derives it inside the TEE from the WASM hash and the account that called OutLayer, the Seter contract. Another build, or a run started by anyone else, derives a different key and opens nothing.
- The report key is an OutLayer **signing key** with the same binding. The contract learns both public keys from an attested `keys` run that can only reach it through the private callback.
- The manifest embedded in the WASM (covered by its hash) admits runs only from `mienai-3013a230.testnet` (`callers.contract.only`) and allows HTTPS only to `api.exchange.coinbase.com`.
- The WASM build is reproducible: `bash scripts/build-enclave.sh` prints the hash pinned on the contract (rust 1.95.0, `Cargo.lock`, paths remapped).

## NEAR features used, and why

- **OutLayer TEE** (`outlayer.testnet`, yield/resume): the only party that can read the orders and the only source of fire reports.
- **Promise callbacks with `#[private]`** as the origin check for results, plus **`env::ed25519_verify`** as an independent one.
- **NEP-141**: tUSD, the test quote token, with `ft_transfer_call` deposits into the vault.
- **FastFS** on testnet to host the WASM that OutLayer fetches by hash.
- **NEAR Intents** is not used: it has no testnet. Mainnet execution is Setup required (see BLOCKED.md).
- Not used: Chain Signatures, sub-accounts, NEP-171/245, meta transactions, Sputnik DAO.

## Repository

| Path | What |
| --- | --- |
| `packages/enclave` | Rust WASI P2 component run by OutLayer (`keys`, `check`, `bands`). |
| `packages/contract` | Rust near-sdk vault: orders, requests, verification, pool, balances. Sandbox tests in `tests/`. |
| `packages/token` | tUSD test NEP-141 with an hourly faucet. |
| `packages/sdk` | Sealing, attestation verification, FastFS upload, deploy and run scripts. |
| `packages/web` | Vite + React app: landing (`/`), trading terminal (`/app`, Lightweight Charts) and order pages (`/order/<id>`). |
| `deployments/` | Every transaction of the deploy and the real run, and the verified attestation. |
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
- Connect a testnet wallet ([Meteor Wallet](https://wallet.meteorwallet.app), see below), open Vault and deposit NEAR, then pick Sealed stop, set a trigger and amount and press Seal → the transaction stores only the ciphertext shown under "Chain sees"; your Open orders tab decrypts the trigger on your device.

**Connecting a wallet.** Seter signs with [Meteor Wallet](https://wallet.meteorwallet.app) on NEAR testnet, through NEAR Wallet Selector 10.1.4. You need a `.testnet` account in Meteor (create or import one there; NEAR's guide is [Create an account](https://docs.near.org/getting-started/create-account), and free testnet NEAR comes from [near-faucet.io](https://near-faucet.io)). **Connect wallet** opens Meteor in a pop-up (or its browser extension) at `wallet.meteorwallet.app/connect/testnet/login`, asking for a function-call key on the Seter contract; the result is posted back to the page, so there is no redirect. Calls with no deposit (cancel, withdraw) are then signed by that key; sealing an order, a deposit or a paid check attaches NEAR and opens Meteor for approval. A blocked pop-up or a closed wallet window shows a plain banner. MyNearWallet was removed on 2026-11-10: its testnet pop-up now answers "MyNearWallet can't connect to apps anymore" and points to Meteor.
- `node packages/sdk/scripts/verify-attestation.mjs deployments/outlayer-direct-check-*.json 999ec172…` → all six attestation checks pass for the probe run.
- To redeploy from scratch: `node packages/sdk/scripts/create-account.mjs deployer`, `... token`, `... trader`; `node packages/sdk/scripts/upload-enclave.mjs` (after editing `manifest.json` to your contract id); `node packages/sdk/scripts/deploy-testnet.mjs`; `node packages/sdk/scripts/real-run.mjs`.

## Limits, stated plainly

- One price source (Coinbase NEAR-USD last trade). A second source and a median would be stronger.
- A keeper must pay for checks (about 0.001 NEAR of OutLayer compute plus gas per check); nothing runs on a timer by itself.
- The fill happens on Seter's own test pool, so the execution itself is public once it fires. Private execution would need Confidential Intents on mainnet.
- The browser keeps the view key in `localStorage`; losing it loses the owner's local copy of the levels, not the order.
- Up to 16 open orders per contract (one enclave run reads all of them).

## Team and other projects

Lead: <TBD by Nick>

Other project by this lead: <TBD by Nick>. NEAR HACKATHON Q-015 permits at most two projects per person, and each must disclose the other.

## License

MIT, Copyright (c) 2026 Nivesh Gajengi.

## Credits

- The NEAR token logo comes from [`@web3icons/core`](https://github.com/0xa3k5/web3icons) 4.0.58 (branded variant), MIT licensed and bundled into the web build (no hotlinking). The logo remains the trademark of its project and is used only to identify the asset.
- The quote asset is the US dollar (Coinbase `NEAR-USD`). Fiat USD has no mark in that package, so the app draws a plain dollar disc for it.
- tUSD is Seter's own test token with no value. It shows the same dollar disc, never a real stablecoin's logo; from 20 px up the logo carries a "test" tag, and the "tUSD" ticker is always written next to it.
