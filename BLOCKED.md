# Blocked and Setup required

Nothing on testnet is blocked. The testnet accounts came from the official account helper; OutLayer testnet needs no sign-up.

| Item | Status | Exact input needed |
| --- | --- | --- |
| Mainnet execution through NEAR Intents (1Click) | **Setup required** | A funded mainnet account in a gitignored `.env`: `NEAR_MAINNET_ACCOUNT` and its key. `ONECLICK_JWT` is optional (without it 1Click charges 0.2%). NEAR Intents has no testnet, so the testnet build settles on its own tUSD pool. Not built: a mainnet vault would also need an `intents.near` public key controlled by the enclave's signing key. |
| Confidential (private) execution | Not built | Confidential Intents is mainnet only (1Click "Confidential Swaps"). |
| Placing orders from the web app with a real wallet | Built, not exercised by the agent | The app signs through MyNearWallet (wallet-selector 9). The agent cannot sign in to a wallet; every contract method the app calls was exercised by the SDK scripts on testnet with the same arguments. Nick should place one order from the browser before recording the demo. |
| Public repository, demo video, X post, submission | Nick | See `HACKATHON_SUBMISSION_FORM.md`. |
