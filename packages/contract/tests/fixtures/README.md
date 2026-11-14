# price_oracle-0.7.0.wasm

The real OutLayer price oracle contract (the code behind `price-oracle.testnet`, v0.7.0), built
unchanged from https://github.com/zavodil/oracle-ark at commit `888ae663803209e5689892d671657331852428f8`
(`contract/`, `cargo near build non-reproducible-wasm --no-abi`, Rust 1.85.0; MIT OR Apache-2.0).
The sandbox tests deploy it next to Seter so the second-source path calls the oracle's own
`request_price_data`, not a stand-in. Its prices come from a sandbox account registered as an
oracle reporter through the contract's own council flow.

SHA-256: `8be420b557d83a812d01fd128864124cd682547346907b15f22cf3c8763c7f1f`

# mienai-testnet-two-source.wasm

The vault code running on `mienai-3013a230.testnet` before the 14 Nov order-types upgrade (the
two-source build, read back with `view_code`). `order_types_upgrade_keeps_state` deploys it, writes
orders and balances, then upgrades in place to the new build, as the testnet upgrade does.

SHA-256: `ab042db7e1892d02eb447f3c9ea9af384cb308b220de757f0daa20c8ae8c5608`
