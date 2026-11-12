# Seter full-flow QA — 2026-11-11

**Automated flow: PASS. Human Meteor approval remains a manual compatibility check.** All product changes are functional fixes in the existing approved design. No restyle, art, palette or font changes were made. Screenshots are outside the repo.

Evidence root: `mienai`.

Screenshots were captured locally during QA and are not committed.

## Ordered user flow and results

Normal production Chrome covered 67 captured steps at 1440x900 and 375x812. It found no document overflow, dead hash targets, raw exceptions, `NaN` or `undefined` after fixes. The only failed requests in that final walkthrough were deliberate RPC outages; their browser fetch-error console entries are expected. Connected/error fixtures are labelled separately from live transactions.

| Step | Action / screen | Result | Reason / evidence | Screenshots |
| --- | --- | --- | --- | --- |
| 1 | Install/build, landing `/` | FIXED | Production build and preview work. The development wallet dependency no longer throws `process is not defined`. | `landing-1440.png` / `landing-375.png` |
| 2 | Product, Proof, NEAR tech, footer and How it works | FIXED | Every anchor exists. Header How it works now targets `/#benefits`. Mainnet is described as not built; public metadata and the signed relay are disclosed. | `tech-1440.png` / `tech-375.png` |
| 3 | Terminal `/app`, market and all four chart timeframes | FIXED | Live RPC/Coinbase data loads. A slow previous timeframe cannot replace the selected one. Mobile Chart / Sealed book tabs work. | `terminal-1440.png` / `terminal-375.png` |
| 4 | Sealed book and armed detail `/order/3` | PASS | Public levels stay hidden. Ciphertext, commitment, public owner/time/status and return navigation render. | `order-3-1440.png` / `order-3-375.png` |
| 5 | Fired `/order/1`, cancelled `/order/6`, latest SDK `/order/7` and `/order/8` | FIXED | Crossing, fill, payload and receipts render. Unfilled crossings are distinct from sales. Order reads refresh and recover after navigation. | `order-7-1440.png` / `order-7-375.png` |
| 6 | Open orders, Order history, Enclave log, Attestations | FIXED | All tabs load. Each recorded certificate points to its own order; report logs describe requests accurately. | `attestations-1440.png` / `attestations-375.png` |
| 7 | Certificate, quote refetch, copy and external links | FIXED | Recorded checks are distinguished from live quote hashing. Clipboard denial gives manual-copy guidance without an exception. NearBlocks may challenge headless browsers; its target hashes are valid public records. | `copy-denied-1440.png` / `copy-denied-375.png` |
| 8 | Market / Limit explanations; stop / take-profit inputs | FIXED | All tabs and trigger controls respond. Quotes use the actual pool. Clearing the trigger stays empty; invalid, excessive and underfunded amounts stop before signing. | `insufficient-order-1440.png` / `insufficient-order-375.png` |
| 9 | Connect using QA signer | PASS | Real demo trader connects through the app wallet interface. No Meteor session or mocked success is used for this run. | `connected-1440.png` / `connected-375.png` |
| 10 | Deposit NEAR, then tUSD in Vault | PASS | Real `deposit_near` and `ft_transfer_call` transactions reach FINAL. The verification run waits until displayed vault balances match the deposits. | `tusd-deposited-1440.png` / `tusd-deposited-375.png` |
| 11 | Optional tUSD faucet | PASS | The earlier live SDK run claimed the faucet successfully. Browser runs used the already funded demo account, so did not repeat the optional claim during cooldown. Faucet UI/pending behavior was covered with a controlled fixture. | `deposit-tusd-1440.png` / `deposit-tusd-375.png` |
| 12 | Seal stop and take-profit; owner position and armed detail | PASS | Real browser encryption and signatures place both orders. Own order rows and detail decrypt the device-view copy; receipt links persist through route changes. | `armed-order-1440.png` / `armed-order-375.png` |
| 13 | Pay for enclave check; fire result and receipt | PASS | Real check reaches FINAL. The deliberately crossed stop becomes Fired in history and detail; the app links the actual placement and check transactions. | `stop-fired-history-1440.png` / `stop-fired-history-375.png` |
| 14 | Cancel distant take-profit; history | PASS | Real cancel reaches FINAL. The own-order row leaves Open orders and appears as Cancelled in history. | `cancelled-history-1440.png` / `cancelled-history-375.png` |
| 15 | Withdraw NEAR and tUSD; vault/profile position | PASS | Both real withdrawals complete. Displayed and on-chain balances return to the starting vault balances. This app uses Vault and own-order tabs as its position view; no separate profile route exists. | `vault-restored-1440.png` / `vault-restored-375.png` |
| 16 | View-key controls and sign out | PASS | Invalid import remains disabled; real browser-created view copies decrypt. No signing or view key is shown, exported or logged by QA. Sign out returns the Connect wallet control. | `signed-out-1440.png` / `signed-out-375.png` |
| 17 | Missing order, malformed ID, unknown route | FIXED | `/order/999999` is a readable empty state. `/order/1garbage` and `/unknown-route` now show recoverable not-found states. | `unknown-route-1440.png` / `unknown-route-375.png` |
| 18 | Empty account/book/history, failed RPC/Coinbase/quote, clipboard denial | FIXED | Controlled fixtures show readable, bounded errors and useful empty states, with no page exceptions or document overflow. Missing-order navigation recovers. Failed quote retrieval preserves the labelled recorded checks. | `rpc-outage-1440.png` / `rpc-outage-375.png` |
| 19 | Human Meteor login and approval | BLOCKED | Manual compatibility check remains: a person must sign into Meteor and approve one order. The production Connect action opens `/connect/testnet/login`, requests the correct contract, and handles closed/blocked windows. This does not block the real QA-signer browser flow. | `closed-1440.png` / `closed-375.png` |

The complete route set is `/`, `/app` and `/order/<integer>` (optional trailing slash for app/order). Landing sections are anchors, Vault is a sheet, and the four bottom views are tabs. Missing and invalid routes were exercised at both widths.

Screenshots were captured locally during QA and are not committed.

## Real browser transactions

The QA signer is available only when **both** `--mode qa` and `VITE_QA_SIGNER=1` are used. It implements the wallet-selector account, sign-in/out and single/batch transaction methods. The same app encryption, vault forms, order controls, receipt cache and refresh hooks run against real testnet contracts. No successful contract response was fabricated.

Normal production builds were scanned by filename and content for the module name and unique QA markers. They exclude the signer even if `VITE_QA_SIGNER=1` is accidentally set in production mode. Runtime refusal tests reject a non-testnet account and a mainnet RPC before signing. The adapter permits only the two demo contracts and the demo function calls, serializes sends and bounds its budget.

The test reads the existing trader credential in Node, injects it with `page.addInitScript` and consumes it into an in-memory keystore. It never writes a credential copy, captures browser traces/HAR/video, or logs the key. Every submitted hash is saved immediately and then updated after a `FINAL` status read.

First run: [public ledger](deployments/qa-browser-2026-11-11.json). Screenshot review showed that a balance read could finish just after the success label. The test was tightened to wait for displayed balances, then hit a delayed check response. Public block/chunk lookup recovered that exact FINAL check without resending it. The runner resumed, and the signer was hardened to save the hash before broadcast and poll through bounded read-only RPCs. The resumed run deliberately dropped one accepted broadcast response to test recovery. A subsequent prepared withdrawal was not accepted; both testnet RPCs reported UNKNOWN_TRANSACTION, and fresh-nonce signing fixed the following withdrawals. The unaccepted prepared hash remains in the ledger: [verified-balance ledger](deployments/qa-browser-2026-11-11-verified-balances.json). Each run used one transaction sequence and captured each major result at both widths; transactions were not repeated just to change viewport.

| Action | First run | Verified-balance run |
| --- | --- | --- |
| deposit-near | [`ASez3oe8U6SHoZ1eDV5Mapj7Kky4Wsk3aRHchw7hu4Pc`](https://testnet.nearblocks.io/txns/ASez3oe8U6SHoZ1eDV5Mapj7Kky4Wsk3aRHchw7hu4Pc) | [`7BgRoW7ks3qRYZivSTY64bPo2bYuMetnVygHTff8qvXc`](https://testnet.nearblocks.io/txns/7BgRoW7ks3qRYZivSTY64bPo2bYuMetnVygHTff8qvXc) |
| deposit-tusd | [`77cFGePreuVnJdsqsdckQRqK49A715H1x1o1g4HasMCT`](https://testnet.nearblocks.io/txns/77cFGePreuVnJdsqsdckQRqK49A715H1x1o1g4HasMCT) | [`BtpzLiyLdD41HjcqJv3truM4bQH1eA4w1CEJzTUpGv8w`](https://testnet.nearblocks.io/txns/BtpzLiyLdD41HjcqJv3truM4bQH1eA4w1CEJzTUpGv8w) |
| sealed-stop | [`HLpu1Lb2MeB3e3NQXFbcKBF73HZth99NUdB1hLzGsFad`](https://testnet.nearblocks.io/txns/HLpu1Lb2MeB3e3NQXFbcKBF73HZth99NUdB1hLzGsFad) | [`EeVtQW2QJur5mUEj3cNJCq8ZLKtjdNFw5r3gG38Jqjqd`](https://testnet.nearblocks.io/txns/EeVtQW2QJur5mUEj3cNJCq8ZLKtjdNFw5r3gG38Jqjqd) |
| sealed-take-profit | [`9Q7QrdLwPd2qtpTX2UJQrZQXvx5LTDnt5EY7cCj8FxWd`](https://testnet.nearblocks.io/txns/9Q7QrdLwPd2qtpTX2UJQrZQXvx5LTDnt5EY7cCj8FxWd) | [`nEVsuRE8zaTMnz96g44QQHNe8mjB4wUV9QDQmBRw3o5`](https://testnet.nearblocks.io/txns/nEVsuRE8zaTMnz96g44QQHNe8mjB4wUV9QDQmBRw3o5) |
| enclave-check | [`ETERH96kxHXjkPSpV2uK5WzWBGbiw7KTGLyJqv5EuWnX`](https://testnet.nearblocks.io/txns/ETERH96kxHXjkPSpV2uK5WzWBGbiw7KTGLyJqv5EuWnX) | [`9hEuZTjvik1ECo7Q4rYzhyqedrG1W8PEGo4dFBnaSbMD`](https://testnet.nearblocks.io/txns/9hEuZTjvik1ECo7Q4rYzhyqedrG1W8PEGo4dFBnaSbMD) |
| cancel-take-profit | [`9nzBguussyqdzMPEyi9VMcA2fjXba4kvJvk1hJ5mneaJ`](https://testnet.nearblocks.io/txns/9nzBguussyqdzMPEyi9VMcA2fjXba4kvJvk1hJ5mneaJ) | [`8CG3Jzfff4NQGwVXxqzXu447V6F1wD6BDNG7JdDFNt5L`](https://testnet.nearblocks.io/txns/8CG3Jzfff4NQGwVXxqzXu447V6F1wD6BDNG7JdDFNt5L) |
| withdraw-near | [`B1z3iQB6ic3wi3wsxY6e8TFqoSgXAFVN1rvTHmZPNsHw`](https://testnet.nearblocks.io/txns/B1z3iQB6ic3wi3wsxY6e8TFqoSgXAFVN1rvTHmZPNsHw) | [`AAibpMiipb2EeMWj9tr6p7CQh7wmeU5E54a2rmkouFBm`](https://testnet.nearblocks.io/txns/AAibpMiipb2EeMWj9tr6p7CQh7wmeU5E54a2rmkouFBm) |
| withdraw-tusd | [`8UK3nynTYhcUwwnbCxiHDvRZ8o3oMTUz2qaH7PKPoJLP`](https://testnet.nearblocks.io/txns/8UK3nynTYhcUwwnbCxiHDvRZ8o3oMTUz2qaH7PKPoJLP) | [`BeZqkwxH6jRkvCSbeF1BTX8Lg5TXnBQowtifaw34G5J`](https://testnet.nearblocks.io/txns/BeZqkwxH6jRkvCSbeF1BTX8Lg5TXnBQowtifaw34G5J) |

First run: stop №9 Fired, take-profit №10 Cancelled; debit **0.055173177659052900000001 testnet NEAR**. Verification: stop №11 Fired, take-profit №12 Cancelled; debit **0.055208984366562400000001 testnet NEAR**.

Including the earlier SDK flow, total QA debit is **0.175769172388370900000003 testnet NEAR**, below the 0.3 cap. Both browser runs restored the vault to `{'near': '600000000000000000000000', 'usd': '1272503'}`. There were no unhandled page errors. The resumed run has one expected failed request from deliberately dropping the accepted broadcast response; the saved hash reached FINAL without a second broadcast.

The [earlier live SDK flow](deployments/flow-qa-2026-11-11.json) additionally records the faucet, view-key round trip, orders №7/8, restored vault balances and independently verified Intel TDX attestation (all six checks true, TCB UpToDate). Browser-run attestation verification was not independently rerun; their contract callbacks did accept signed enclave reports.

## Fixes and before/after screenshots

Each pair links 1440 and 375 captures. Error/connected fixtures are explicitly controlled tests; ordinary and QA-signer screens use live public contract reads. Existing horizontal scrolling within tables is preserved. The connected header fix prevents document overflow without changing the design.

| Fix / commit | Before | After |
| --- | --- | --- |
| Development wallet startup (`260f018`) | `dev-1440.png` / `dev-375.png` | `dev-1440.png` / `dev-375.png` |
| Order error recovery (`35eab88`) | `order-error-recovery-1440.png` / `order-error-recovery-375.png` | `order-error-recovery-1440.png` / `order-error-recovery-375.png` |
| Stale chart response (`2f6219f`) | `chart-race-1440.png` / `chart-race-375.png` | `chart-race-1440.png` / `chart-race-375.png` |
| Clipboard rejection (`90356dc`) | `copy-denied-1440.png` / `copy-denied-375.png` | `copy-denied-1440.png` / `copy-denied-375.png` |
| Strict routes (`ec91bdb`) | `unknown-route-1440.png` / `unknown-route-375.png` | `unknown-route-1440.png` / `unknown-route-375.png` |
| How it works anchor (`2e06e4b`) | `how-navigation-1440.png` / `footer-375.png` | `how-navigation-1440.png` / `how-navigation-375.png` |
| Connected mobile header overflow (`f84353a`) | `connected-1440.png` / `connected-375.png` | `connected-1440.png` / `connected-375.png` |
| Vault validation / pending / token registration (`ff1c4db`) | `vault-1440.png` / `vault-375.png` | `token-refund-1440.png` / `token-refund-375.png` |
| Real pool quote and order validation (`0e86e3f`) | `type-sealed-stop-1440.png` / `type-sealed-stop-375.png` | `type-sealed-stop-1440.png` / `type-sealed-stop-375.png` |
| Receipts and confirmed-state refresh (`982656f`, type narrowing `a5c2bbb`) | `fresh-order-1440.png` / `fresh-order-375.png` | `order-7-1440.png` / `order-7-375.png` |
| Accurate mainnet/report copy (`cb4e9e4`) | `tech-1440.png` / `tech-375.png` | `tech-1440.png` / `tech-375.png` |
| Bounded public reads (`cb8b069`) | `order-error-1440.png` / `order-error-375.png` | `order-error-1440.png` / `order-error-375.png` |
| Unfilled crossing / refreshed detail (`498e314`) | `unfilled-1440.png` / `unfilled-375.png` | `unfilled-1440.png` / `unfilled-375.png` |
| Matching certificate / pending check-cancel (`0a43375`) | `attestations-1440.png` / `attestations-375.png` | `attestations-1440.png` / `attestations-375.png` |
| Book RPC failure (`dd9b6b8`) | `rpc-outage-1440.png` / `rpc-outage-375.png` | `rpc-outage-1440.png` / `rpc-outage-375.png` |
| Public metadata / cancellation copy (`dec2e74`) | `order-6-1440.png` / `order-6-375.png` | `order-6-1440.png` / `order-6-375.png` |

The pinned Meteor SDK patch (`2aff45d`) removes generated login-key logging. Real popup checks after the patch found no key-pair object logged. The QA adapter (`9ee1efb`) adds no UI controls and leaves the production wallet as Meteor.

Screenshots were captured locally during QA and are not committed.

## Verification and remaining limits

- `pnpm build`: PASS (TypeScript + Vite). Existing dependency/chunk-size warnings remain informational.
- `pnpm test:sdk`: 5/5 PASS. Contract/enclave historical suites were not rerun for these web-only fixes.
- `pnpm install --frozen-lockfile`: PASS with the final Playwright dependency and Meteor patch.
- `pnpm test:e2e`: PASS for the first complete run and the resumed verification run, with 28 unique screenshot views per run; the second run asserts the displayed balances before capturing deposit/restoration results.
- Normal anonymous walkthrough: `after/results.json`; connected fixtures: `after-connected/connected-results.json`; input/wallet-cancel fixtures: `after-actions/results.json`; actual Meteor popup checks: `after-wallet/results.json`.
- Race/clipboard tests: `after/edge-results.json`; missing-order navigation: `after/recovery.json`; outage/empty/unfilled fixtures: `after/states.json`; token-registration/refund and public-receipt controller fixtures: `after-controllers/results.json`.
- Normal production remains Meteor-only. A person still needs to verify a human Meteor sign-in and approval. This is separate from the now-passing real QA-signer browser flow.
- NearBlocks can block headless Chrome. Transaction targets remain valid; ledger hashes and direct testnet RPC reads independently confirm these transactions. The film used NearBlocks Lite (`nearvalidate.org`) with the archival RPC.
- tUSD has no value. A paid keeper call is needed for each check. Mainnet Intents and private settlement remain unbuilt.
- No push, force operation, `.loom/` edit or signing-key print/copy was performed. All Chrome/preview processes started for this QA are closed.

See [TESTING.md](TESTING.md#real-browser-transactions-with-the-qa-signer-11-nov-2026) for the reproducible command, flags, budget checks and guarded resume behavior.

## Judging R3 — 12 Nov 2026

| Item | Result | What ran / evidence |
| --- | --- | --- |
| 1. Local evidence links | PASS | Replaced all local absolute links/paths in tracked Markdown except the submission form with plain filenames; all historical result rows and PASS/FAIL/BLOCKED words were preserved. The required `git grep` prints nothing. |
| 2. Privacy limits | PASS | README Limits now states the empty-check probing leak and the band-report distribution leak; submission Scope mentions both. The existing 16-order cap is unchanged. |
| 3. Terminal bugs | FIXED | Reproduced at 1440 and captured at both widths. Existing market fields now wrap completely into view; colliding chart labels merge into counts while individual event labels remain in the chart tooltip. Before/after screenshots: `before-1440.png`, `before-375.png`, `after-1440.png`, `after-375.png`; chart crops: `before-chart-1440.png`, `after-chart-1440.png`. Both widths pass containment, no overlap, no document overflow and no page exceptions. |
| 4. Capped keeper | PASS | Added one-check command, spendable reserve, per-run/UTC-day caps, saved hash before broadcast, immutable finalized journals, and a secret-gated 15-minute workflow with persistent cap state. Local request 10 completed with `fired 0`; workflow YAML/actionlint pass. CI was not run or enabled. |
| 5. Judge paid check | PASS | Try it names Connect wallet, Pay for a check · 0.02 NEAR, Last check, Runs / rejected, Enclave log and the `fired 0` result exactly as the app shows them. |

Two real keeper attempts were made. `C9ZYpNSzkkenzxLGAtS3j5goezATZH7hueckQ6xH2Zxh` finalized but its enclave request failed: OutLayer required 0.007002 NEAR rather than the contract's 0.005 minimum. Its original sealed journal reports outer transaction success and retains the failed callback. After correcting the attachment and completion check, `gP1o99iyC2rTJcrMXv55N1KwoDuG8r8yr9JCsj5eTaG` completed request 10, checked the three armed orders, fired none and updated Last check. Total real R3 debit: **0.0032805207829979 NEAR**. Full hashes, request result, balances and cumulative spend are in `deployments/r3-2026-11-12.json` and its two keeper journals.

Executed checks: `QA_BASE_URL=http://127.0.0.1:5391 pnpm test:e2e --read-only` 36/36 PASS at 1440/375 without writes; production build PASS; SDK/policy tests 13/13 PASS; CLI refusal checks 4/4 PASS; YAML parser and actionlint PASS. Read-only browser regression result is recorded in `web-results.json`; the paid Nov 11 browser flow was not repeated. Screenshots were captured locally during QA and are not committed.

Remaining manual work: Nick adds `SETER_KEEPER_KEY` to turn on the prepared workflow, publishes the repository and X video, and performs a human Meteor approval. None was attempted here.

## Judging R4 — 12 Nov 2026

| Item | Result | Evidence |
| --- | --- | --- |
| Host-ready static app | PASS | Added `vercel.json` with filesystem-first SPA fallback and output `packages/web/dist`, `.vercelignore` secret/local-state exclusions, a build guard, and README Hosting instructions. Production built successfully with `VITE_QA_SIGNER=1`; the guard found no QA signer module/markers or private files among 36 public build files. Nine representative private upload paths are excluded. The normal production preview also passed 36 read-only route/tab/timeframe checks at both widths, including direct page loads and order-detail navigation. No deployment was performed. |
| One fresh in-app seal and fire | PASS | `pnpm test:e2e --fire-only` used the existing QA wallet interface, real trader encryption and real testnet transactions. Exactly one fresh order, **№13**, was placed; one paid check from the existing keeper completed request **11** and fired it. No deposit, faucet, cancellation, second order or extra check was made. |

The trigger was deliberately set about 1% above the live Coinbase quote (3.3881) so the next check could cross it. The armed page decrypted the owner's local view copy. Its trigger **3.4220** was revealed only in the on-chain fire report, whose enclave price was **3.3892**. The contract filled **0.0001 NEAR** for **0.000275 tUSD** on its test pool, via the private callback. This was a deliberately crossed demo stop, not a claim that the market fell through a previously lower trigger.

| Browser action | Transaction | Payer wallet debit |
| --- | --- | --- |
| Seal stop | [`79frNkPN8C4tZPPoJJHSYMTb9zxtRRdDXbWwx6SxQu8i`](https://testnet.nearblocks.io/txns/79frNkPN8C4tZPPoJJHSYMTb9zxtRRdDXbWwx6SxQu8i) | 0.0202756615105998 NEAR |
| Pay for a check | [`93MYASBvJJvru635brwsrV9zRuAGDeav99KYQcqxvFcz`](https://testnet.nearblocks.io/txns/93MYASBvJJvru635brwsrV9zRuAGDeav99KYQcqxvFcz) | 0.0026850939967024 NEAR |

Combined wallet debit was **0.0229607555073022 NEAR**. Counting the sold 0.0001 NEAR too, the conservative total was **0.0230607555073022 NEAR**, below the 0.03 cap. The trader used its existing funded vault; no new funds or secrets were created. The payer budgets were checked before both writes, every hash was saved before broadcast, and both transactions reached FINAL. The completed proof refuses replay. Full evidence: [r4-fire-2026-11-12.json](deployments/r4-fire-2026-11-12.json).

Twelve screenshots cover configuration, armed state, keeper readiness, fired state, real receipt links and a hard refresh of the fired detail at **1440x900 and 375x812**. Examples: `armed-1440.png`, `armed-375.png`, `fired-1440.png`, `fired-375.png`, `receipts-1440.png`, `receipts-375.png`, `fired-refreshed-1440.png`, `fired-refreshed-375.png`. No page exceptions or document overflow were found. The order summary shows the exact 0.0001 NEAR; the existing two-decimal fill caption rounds that tiny quantity to 0.00. No product UI code was changed. A fresh independent TDX attestation verification was not run or claimed; the app truthfully shows that no recorded attestation has been bundled for this fire.

Screenshots were captured locally during QA and are not committed.

A low-disk preflight briefly paused builds/browsers. Only this repo's regenerable Rust build caches were removed; work resumed after the internal volume recovered above 5 GB. No films, deployment, push, new secret or keeper activation occurred. Hosting, human Meteor approval and adding the keeper secret remain Nick's steps.
