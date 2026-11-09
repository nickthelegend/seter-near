#!/usr/bin/env bash
# Reproducible build of the OutLayer enclave. The hash depends only on rust 1.95.0
# (rust-toolchain.toml), Cargo.lock and the sources: absolute paths are remapped away.
set -euo pipefail
cd "$(dirname "$0")/../packages/enclave"
CARGO_HOME_DIR="${CARGO_HOME:-$HOME/.cargo}"
# CARGO_ENCODED_RUSTFLAGS (0x1f-separated) survives spaces in paths.
SEP=$'\x1f'
export CARGO_ENCODED_RUSTFLAGS="--remap-path-prefix=${CARGO_HOME_DIR}/registry/src=/cargo/registry/src${SEP}--remap-path-prefix=$(pwd)=/mienai/enclave${SEP}--remap-path-prefix=${HOME}=/home"
cargo build --locked --target wasm32-wasip2 --release
WASM=target/wasm32-wasip2/release/mienai-enclave.wasm
if strings "$WASM" | grep -q "$HOME"; then echo "absolute path leaked into $WASM" >&2; exit 1; fi
if ! strings "$WASM" | grep -q "outlayer.manifest"; then echo "outlayer.manifest section missing" >&2; exit 1; fi
shasum -a 256 "$WASM" | cut -d' ' -f1
