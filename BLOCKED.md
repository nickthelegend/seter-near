# Remaining setup and limitations

The recorded testnet deployment and sealed-stop execution are complete; see `deployments/testnet-2026-11-09.json` and `deployments/real-run-2026-11-09.json`. Browser wallet approval and publication still need Nick.

| Item | Status | Exact input needed |
| --- | --- | --- |
| Mainnet execution through NEAR Intents (1Click) | Not built | The current contract settles on its own testnet tUSD pool. Mainnet needs an execution integration, an enclave-controlled Intents identity and a funded mainnet account. Funding alone does not enable it. |
| Confidential (private) execution | Not built | The current test-pool execution becomes public when an order fires. |
| Placing orders from the web app with a real wallet | Built; full approval not verified | The app uses Meteor Wallet through NEAR Wallet Selector 10.1.4. Pop-up opening and error handling were checked; a full Meteor sign-in and approval were not. Nick should place one order from the browser before recording the demo. See `TESTING.md`. |
| Public repository, demo video, X post, submission | Nick | See `HACKATHON_SUBMISSION_FORM.md`. |
