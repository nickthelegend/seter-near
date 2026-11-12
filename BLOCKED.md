# Remaining setup and limitations

The recorded testnet deployment and sealed-stop execution are complete; see `deployments/testnet-2026-11-09.json` and `deployments/real-run-2026-11-09.json`. Browser wallet approval and publication still need Nick.

| Item | Status | Exact input needed |
| --- | --- | --- |
| Mainnet execution through NEAR Intents (1Click) | Not built | The current contract settles on its own testnet tUSD pool. Mainnet needs an execution integration, an enclave-controlled Intents identity and a funded mainnet account. Funding alone does not enable it. |
| Confidential (private) execution | Not built | The current test-pool execution becomes public when an order fires. |
| Human Meteor sign-in and approval | Manual compatibility check | The real browser flow passes with the build-gated QA signer and real testnet transactions. Production uses Meteor Wallet through NEAR Wallet Selector 10.1.4; its popup and closed/blocked states pass. A person should still approve one order in Meteor before judging. See `FLOW-QA.md` and `TESTING.md`. |
| Public repository, X post, submission | Nick | The local demo video is complete; its path is in `HACKATHON_SUBMISSION_FORM.md`. Nick still publishes the repository, posts the video and submits the form. |

## R3 keeper activation

Prepared, switched off: `.github/workflows/keeper.yml` is syntactically valid and gated on `SETER_KEEPER_KEY`. Local real request 10 passed (`gP1o99iyC2rTJcrMXv55N1KwoDuG8r8yr9JCsj5eTaG`, `fired 0`). GitHub execution was not run because publishing and adding that secret belong to Nick; no CI success is claimed. The script defaults to a 1 NEAR spendable reserve and 0.05 NEAR daily cap, so Nick must fund/configure the matching testnet keeper and retain its journal artifacts. Missing budget state or an unresolved hash fails closed. See README and TESTING for the failed low-attachment probe, current upfront fee reservation and exact local results.
