# Research (2026-11-09)

Everything Seter relies on, with the source for each fact. Where a path is closed, it says so.

## 1. OutLayer (TEE execution for NEAR)

| Question | Finding | Source |
| --- | --- | --- |
| What runs | A WASI component (`wasm32-wasip2`), fetched by URL and checked against a SHA-256 the caller pins, executed by a worker inside Intel TDX. | [docs/near-integration](https://app.outlayer.ai/docs/near-integration), [docs/wasi](https://app.outlayer.ai/docs/wasi) |
| How a NEAR contract calls it | `request_execution` on `outlayer.testnet` / `outlayer.near` with `source: {WasmUrl: {url, hash, build_target}}`, `input_data`, `resource_limits`, `response_format`, `payer_account_id`. The OutLayer contract creates a `promise_yield`; the worker resolves it; the stdout comes back as the **promise result** of that call, into the caller's chained callback. | [docs/near-integration](https://app.outlayer.ai/docs/near-integration), [contract/src/execution.rs](https://github.com/out-layer/outlayer/blob/main/contract/src/execution.rs) (`promise_yield_create`, `resolve_execution`, `on_execution_response` → `env::value_return(output)`) |
| Large output | Outputs over 1024 bytes go through `submit_execution_output_and_resolve`; the callback still receives the bytes. Seter keeps reports well under 1 KB anyway. | same file |
| Encryption keys | A module declares `encryption_keys` in its embedded manifest. The keystore derives a 256-bit key inside the TEE as `HMAC(master, "encryption-key:v1:wasm:{wasm_sha256}:{caller}:{account}:{path}")` for `bind: "wasm"`. The module never sees the key; it calls host `encrypt` / `decrypt` / `mac`. **The key is symmetric, so a browser cannot encrypt to it directly.** | [docs/encryption-keys](https://app.outlayer.ai/docs/encryption-keys), [CONNECTOR_MANIFEST.md §encryption_keys](https://github.com/out-layer/outlayer/blob/main/wasi-examples/CONNECTOR_MANIFEST.md), [encryption-keys.wit](https://github.com/out-layer/outlayer/blob/main/sdk/outlayer/wit/deps/encryption-keys.wit) |
| Signing keys | `signing_keys` (ed25519 / secp256k1), same derivation rules; host `public-key` and `sign` (RFC 8032 over raw bytes). | [signing-keys.wit](https://github.com/out-layer/outlayer/blob/main/sdk/outlayer/wit/deps/signing-keys.wit) |
| Caller binding | `caller: "predecessor"` binds a key to the account that called OutLayer, i.e. the Seter contract itself. A run started by any other account derives a different key. | CONNECTOR_MANIFEST.md §signing_keys |
| Who may start a run | `"callers": {"contract": {"only": [...]}}` in the manifest refuses every run whose OutLayer caller is not listed, before keys are derived. The manifest is a custom section covered by the wasm hash. | CONNECTOR_MANIFEST.md §callers, §Embedding it |
| Network | `capabilities.network` is an exact-host allowlist, enforced when present. | CONNECTOR_MANIFEST.md, table "What goes in it" |
| Secrets | User secrets are ECIES (X25519 + HKDF-SHA256 + ChaCha20-Poly1305) to a keystore key and appear as env vars. They are per-secret dashboard objects with storage cost, not a per-order encryption API, so Seter does not use them. | [docs/secrets](https://app.outlayer.ai/docs/secrets) |
| Attestation | Each execution has a TDX quote whose `report_data` binds `sha256(task_type ‖ task_id ‖ … ‖ wasm_hash ‖ input_hash ‖ output_hash ‖ block_height ‖ caller ‖ timestamp …)`; fetch it at `https://testnet-api.outlayer.ai/attestations/by-tx/<tx>`, check the measurements with `worker.outlayer.testnet.is_measurements_approved`, and the Intel chain with Phala `dcap-qvl`. The method was worked out and run for real on testnet by our sibling project Kotoba. | [docs/tee-attestation](https://app.outlayer.ai/docs/tee-attestation), [docs/trust-verification](https://app.outlayer.ai/docs/trust-verification), `packages/sdk/src/attestation.mjs` |
| Hosting the wasm | FastFS on testnet (`https://test.fastfs.io/<account>/outlayer.testnet/<sha256>.wasm`), written by a `__fastdata_fastfs` call to `outlayer.testnet` with the bytes as arguments. | [docs/near-integration](https://app.outlayer.ai/docs/near-integration) (FastFS workflow), [outlayer-cli upload.rs](https://github.com/out-layer/outlayer-cli) |
| Cost | Dynamic; `estimate_execution_cost(resource_limits, input_len)` view. Kotoba's live quote: 0.007 NEAR for 10 B instructions / 256 MB / 60 s. Unused deposit is refunded to `payer_account_id`. | [docs/pricing](https://app.outlayer.ai/docs/pricing) |
| Testnet path | Open: `outlayer.testnet`, no sign-up, paid in testnet NEAR. **Not blocked.** | — |

### How Seter turns a symmetric TEE key into "encrypt to the enclave"

The enclave derives an X25519 secret as `mac("orders", "mienai/x25519-order-key/v1")`: 32 uniform bytes only a run of this exact wasm, called by this contract, can compute. Its public key is published once by an attested `keys` run whose output lands in the contract through the private callback. Browsers seal orders to it with X25519 → HKDF-SHA256 → XChaCha20-Poly1305 (AAD = `mienai:order:v1:<owner>`), so a ciphertext copied onto another account's order does not open.

### How the contract knows a fire came from the enclave

Two independent checks, both enforced on chain:

1. **Promise origin.** `check()` calls `outlayer.testnet.request_execution` with the pinned `WasmUrl` hash and chains `on_check`, which is `#[private]`. Nobody can call `on_check` directly, and its only input is the promise result of the contract's own request.
2. **Enclave signature.** The report body is signed with the enclave's ed25519 `attest` key (`bind: "wasm"`, `caller: "predecessor"`). The keystore only releases that key to a TDX worker running this wasm hash for this contract. The contract checks it with `env::ed25519_verify` against the key from the `keys` run. The public `fire(body, sig)` path accepts any relayer but only with this signature.

The per-execution TDX quote is verified off chain (`packages/sdk/scripts/verify-attestation.mjs`) and its result is stored next to each fired order in `deployments/`.

## 2. Price source

**Pyth on NEAR is gone**: Pyth Core ended NEAR support and `pyth-oracle.testnet` returns null (shared fact from earlier builds, docs.pyth.network pull-integration/near). Seter does not use Pyth or Hermes.

Inside the TEE the enclave fetches `https://api.exchange.coinbase.com/products/NEAR-USD/ticker` (public, no key; returns `price`, `trade_id`, `time`). The source URL, trade id and trade time go into the signed report. The contract refuses a report whose price is older than 180 s at the block, or older than its own request. Real responses are pinned in `packages/enclave/fixtures/` for tests. A single source is a stated limitation (see README).

## 3. Execution

- **NEAR Intents has no testnet** ([1Click quickstart](https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart): "There is no testnet version of NEAR Intents"). On testnet a fire settles against Seter's own constant-product pool of NEAR and **tUSD**, a test NEP-141 token deployed for this project.
- **Mainnet:** the web app shows a live 1Click `dry: true` quote for the same swap (`POST https://1click.chaindefuser.com/v0/quote`). A real Intents swap needs a funded `NEAR_MAINNET_ACCOUNT`; that is Setup required, not attempted.
- **Holding `intents.near` balances:** a contract can hold NEP-245 balances on `intents.near` by depositing tokens to it (`ft_transfer_call` with the contract as receiver) and moving them with signed intents executed by `execute_intents`; a contract account cannot produce an ed25519 intent signature itself, so a vault would register a public key (`add_public_key` on `intents.near`) controlled by the enclave's signing key. Not built: it is mainnet only and unfunded.
- **Confidential Intents:** reported as generally available through the 1Click API as a "Confidential Swaps" flow ([1Click quickstart](https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart); press: [glitchwire](https://glitchwire.com/news/nears-confidential-intents-reaches-general-availability-bringing-privacy-infrast/article.md), [ChainCatcher](https://www.chaincatcher.com/en/article/2275396)). That would hide the fill itself on mainnet. It is mainnet only; noted as future work.

## What this means

- Every on-chain piece runs on testnet now: contract, test NEP-141, pool, and real OutLayer TEE runs.
- Mainnet Intents execution is **Setup required: `NEAR_MAINNET_ACCOUNT`** (funded). Quotes are `dry: true` only.
