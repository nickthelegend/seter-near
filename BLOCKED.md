# Remaining setup and limitations

The recorded testnet deployment and sealed-stop execution are complete; see `deployments/testnet-2026-11-09.json` and `deployments/real-run-2026-11-09.json`. Browser wallet approval and publication still need Nick.

| Item | Status | Exact input needed |
| --- | --- | --- |
| Mainnet execution through NEAR Intents (1Click) | Not built | The current contract settles on its own testnet tUSD pool. Mainnet needs an execution integration, an enclave-controlled Intents identity and a funded mainnet account. Funding alone does not enable it. |
| Confidential (private) execution | Not built | The current test-pool execution becomes public when an order fires. |
| Human Meteor sign-in and approval | Manual compatibility check | The real browser flow passes with the build-gated QA signer and real testnet transactions. Production uses Meteor Wallet through NEAR Wallet Selector 10.1.4; its popup and closed/blocked states pass. A person should still approve one order in Meteor before judging. See `FLOW-QA.md` and `TESTING.md`. |
| Public repository, X post, submission | Nick | The local demo video is complete; its path is in `HACKATHON_SUBMISSION_FORM.md`. Nick still publishes the repository, posts the video and submits the form. |
