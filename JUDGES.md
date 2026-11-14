# Judge guide: Seter (NEAR HACKATHON 2026)

For human judges and for the Claude Code / Codex screening pass (HACKATHON.md Q-017). Every claim below has a command or a link that checks it.

## In one paragraph

**Product:** Seter places stop-loss, take-profit, limit and OCO orders on NEAR testnet with the trigger level kept encrypted until a price crossing makes the order execute.
**Problem:** A public stop level shows other traders where forced selling will happen, so it can be hunted.
**What Seter does:** The browser encrypts the order to an OutLayer Intel TDX enclave key. The vault contract (`mienai-3013a230.testnet`) stores only the ciphertext and a commitment. When `check()` is called, the contract asks `outlayer.testnet` to run a pinned WASM program, which reads the Coinbase NEAR/USD price inside the enclave, opens each order, and signs a report that names only the orders that crossed. The contract verifies the signature (`env::ed25519_verify`), the request, the price age, each commitment and the crossing. Since Nov 14 it also requires a second TEE price source (`price-oracle.testnet`) to agree within 1%. Then it settles against its own NEAR/tUSD test pool and publishes the trigger.
**Tracks:** `privacy` and `defi`, from [HACKATHON_SUBMISSION_FORM.md](HACKATHON_SUBMISSION_FORM.md). Settlement is on a test pool; tUSD has no value.

## Verify in one command (no install, no keys)

```sh
node scripts/judge-verify.mjs
```

Needs Node 18+ and nothing else. It checks public data, not our own files: the FastNEAR transaction API, the NEAR testnet RPC (a `tx` call per transaction, archival RPC first; see the RPC note below), contract view calls, the FastFS copy of the enclave program, and the contract source. Public endpoints rate-limit at times; the script retries with backoff, and a run takes seconds. A normal run takes a few seconds. Expected last line: `23/23 checks passed.` Exit code 0 only if all 23 pass.

| # | Check | Source of truth |
|---|---|---|
| 1 | Contract source: `env::ed25519_verify`, `#[private] on_result`, commitment, stale-price, replay and two-source checks exist | `packages/contract/src/lib.rs` |
| 2 | Four sealed placements (stop №1, take-profit №2, stop №18, limit buy №22): the transaction arguments are only `ct`, `commit`, `view_ct`; no trigger, side or condition | txs `BZbja8…`, `4zE2au…`, `T8tXKc…`, `9icSTT…` |
| 3 | Contrast: a public stop shows `trigger_usd "3.2800"` in its arguments | tx `2uFvSf…` |
| 4 | Enclave checks. The callback event shows the price and fired ids, and the OutLayer receipt output is a `check` body for this vault: 3.6003 fires nothing; 3.5886 fires №1; 3.4854 fires №16; 3.5024 fires №17 | txs `79pRBK…`, `GMMwkN…`, `9Jff4h…`, `9KRm7G…` |
| 5 | Keeper checks signed by the vault's own scoped key, with a `price-oracle.testnet` receipt (second source): fires №18; fires №19; fires №22 and №24 and cancels the OCO partner №25 unrevealed | txs `8MehJt…`, `5T6o5j…`, `HbFZQW…` |
| 6 | A keeper check where nothing crossed: fired 0, and `price-oracle.testnet` is never called | tx `AXwyjg…` |
| 7 | Three cancellations emit `order_cancelled` and no log contains a trigger | txs `HojS7J…`, `GbBRFr…`, `7GvkZd…` |
| 8 | The enclave WASM on FastFS hashes (sha256) to `791b4f6c…1386`, the hash pinned in `get_config` | FastFS download, hashed locally |
| 9 | Order №1: sha256(`mienai:commit:v1:` + owner + 0x00 + revealed plaintext) equals the commitment placed on chain, and the enclave price 3.5886 is at or below the revealed trigger 3.5967 | `get_orders` view, recomputed locally |
| 10 | A still-armed order's public view holds ciphertext and commitment, no trigger | `get_open_ids`, `get_orders` views |
| 11 | `get_second_source`: `price-oracle.testnet` enforced; last fire's two prices within the 100 bps tolerance | view |
| 12 | `get_stats`: 25+ orders, 12+ fired, 14+ checks | view |
| 13 | The keeper key on the vault is a function-call key limited to `check` on the vault | `view_access_key_list` |

The table groups the 23 checks. Each transaction line prints the signer and an explorer link `https://testnet.near.rocks/tx/<hash>`.

**RPC note.** For each transaction the script first reads the transaction and its receipts from the FastNEAR transaction API, then cross-checks it with an RPC `tx` call using the signer from that response. The public RPC sometimes answers HTTP 429 or stalls on older transactions. After three misses the script stops asking, and a line before the final count reports `N confirmed, M skipped`. A skipped cross-check does not fail a check, which then rests on the transaction API alone; the view-call, code-hash, FastFS, Bitcoin and source checks do not depend on it.

## Do X → see Y

1. **`pnpm install && pnpm build && pnpm --filter @mienai/web preview`**, open `http://127.0.0.1:5201/app`. You see the trading terminal with sealed levels shown as `••••`.
2. **Open `/order/1`.** You see the recorded trigger 3.5967, the enclave price 3.5886 and the attestation certificate.
3. **Open `/order/16`, scroll to "Two views".** You see the owner's view next to what everyone else sees: the real `place_order` arguments read back from NEAR testnet, with no trigger, size or side.
4. **Open `/book`.** You see every order as the public sees it: owner, time, ciphertext, `sealed` where a trigger would be.
5. **Re-check an enclave attestation:** `packages/sdk/scripts/verify-attestation.mjs` (and `verify-film-fire.mjs` for the filmed fire) check the TDX quote of an OutLayer run.
6. **Run the tests:** `pnpm test:enclave` (9), `pnpm test:contract` (7 unit and 8 sandbox on a local nearcore, attacks rejected on chain), `pnpm test:sdk` (13). Counts and what each covers: [TESTING.md](TESTING.md). Rust 1.95, `cargo-near` 0.22, Node 22+ and pnpm 10 are needed.
7. **Placing your own order** needs a funded Meteor testnet wallet; reading does not.

## How Seter uses NEAR (specific)

| NEAR feature | How Seter uses it | Where |
|---|---|---|
| OutLayer (TDX enclave execution) | `check()` calls `outlayer.testnet` `request_execution` with a WASM pinned by SHA-256; the enclave reads the price and signs the report | `packages/contract/src/lib.rs`, `packages/enclave/` |
| `env::ed25519_verify` | Verifies the enclave's signed report on chain | `packages/contract/src/lib.rs`, checks 1, 4, 5 |
| Private callbacks + promises | The result arrives only in the `#[private]` callback of the contract's own request; a second cross-contract call asks `price-oracle.testnet` | checks 5, 6 |
| `price-oracle.testnet` (OutLayer's own price TEE) | Independent second price source; the fire is refused if the two differ by more than 100 bps | checks 5, 11 |
| Function-call access keys | The keeper signs with a key limited to `check` on the vault with a gas allowance, paid from an on-contract keeper budget | check 13, 5 |
| NEP-141 (tUSD) | The test pool's quote asset; deposits via `ft_transfer_call` | `packages/token/` |
| FastFS | Hosts the pinned enclave program | check 8 |
| In-place contract upgrade | The vault was upgraded twice with state preserved (`DeployContract` on the same account) | `deployments/second-source/`, `deployments/order-types/` |
| Meteor Wallet via wallet-selector | Browser signing on testnet | `packages/web/` |

## Limits (read before scoring)

- **Settlement is on Seter's own NEAR/tUSD test pool.** tUSD has no value. Mainnet execution through NEAR Intents (1Click) is not built.
- **Execution is not confidential.** When an order fires, its trigger is published. Cancelled orders are never revealed.
- **Someone must pay for a check.** Nothing fires by itself. The keeper workflow (`.github/workflows/keeper.yml`) is prepared but switched off and was not run on GitHub. Local keeper runs with the scoped key are the recorded ones.
- **Small leaks, stated in the form:** an empty public check shows that no armed trigger crossed, which narrows where triggers can be; k-anonymous band reports reveal their distribution.
- **Two price sources, not two independent markets.** The second source's median includes Coinbase among about 14 venues.
- **One recorded keeper check failed inside OutLayer** ("Execution promise failed", tx `Dt6AMdpK32GSDYTCGgmmd3NzFAYgqTr7GJF2XnJd5pWp`); the vault marked the request Failed and nothing executed. It is not in the verifier's PASS list. The later check succeeded.
- Human Meteor sign-in and approval is a manual compatibility check; the recorded browser runs use a development-only test signer on real testnet. Not audited. No hosted URL is claimed. See [BLOCKED.md](BLOCKED.md).

## Repository map

- `packages/contract/`: vault contract (orders, commitments, `check`, `on_result`, `fire`, test pool, keeper budget).
- `packages/enclave/`: the OutLayer WASM program (price read, order opening, signed report).
- `packages/sdk/`: client encryption, keeper, attestation verification, deploy and run scripts.
- `packages/web/`: the app. `packages/token/`: tUSD test token.
- `deployments/`: raw records of every live run. `scripts/`: build and QA scripts, and `judge-verify.mjs`.

## Rules compliance

- Built during the window: the first commit `73cbc1d` (Nov 9) holds only the licence and `.gitignore`; see README "Prior work".
- Public repo and MIT licence (`LICENSE`).
- Demo post on X with the film (`seter-near-film.mp4`).
- Other team projects are named in the README (Q-015).
