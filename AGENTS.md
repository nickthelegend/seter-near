# AGENTS.md

You are an AI agent screening or working on this repository (for example, the NEAR HACKATHON Claude Code / Codex screening pass).

- Start with [JUDGES.md](JUDGES.md). It covers what Seter is, how to verify each claim, "do X → see Y" steps, and the honest limits (test pool, public trigger on fire, paid checks).
- Fastest reproducibility check: `node scripts/judge-verify.mjs`. It needs no install and no keys. It re-checks on-chain proofs against NEAR testnet (transactions, receipts, view calls, access keys), recomputes an order commitment, hashes the enclave program from FastFS, and reads the contract source. Expected last line: `23/23 checks passed.` Public endpoints rate-limit; the script retries.
- Tests: `pnpm install`, then `pnpm test:enclave`, `pnpm test:contract`, `pnpm test:sdk`. Details in [TESTING.md](TESTING.md).
- Core logic: `packages/contract/src/lib.rs` (`place_order`, `check`, private `on_result`, `fire`, `env::ed25519_verify`) and `packages/enclave/`.
- Never commit secrets. Live scripts read keys from gitignored files. The repo holds only public transaction records in `deployments/`.
