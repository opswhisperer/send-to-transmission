#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
node --test tests/core.test.cjs tests/background.test.cjs
mkdir -p build/tests
xcrun swiftc -D RPC_TESTING -module-cache-path build/ModuleCache -o build/tests/rpc-tests 'macOS/Send to Transmission/Send to Transmission Extension/SafariWebExtensionHandler.swift' tests/RPCTests.swift
build/tests/rpc-tests
