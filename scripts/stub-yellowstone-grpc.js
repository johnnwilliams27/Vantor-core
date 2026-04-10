#!/usr/bin/env node
/**
 * Creates a stub for @triton-one/yellowstone-grpc-napi-win32-x64-msvc so
 * that @drift-labs/sdk can load on Windows.
 *
 * The Drift SDK imports yellowstone-grpc at module load time, which
 * requires a platform-specific native binding. On Windows, this binding
 * package doesn't exist in npm (as of this writing). Since we don't use
 * gRPC account subscriptions (we use polling), a JS stub works fine.
 *
 * Run with: node scripts/stub-yellowstone-grpc.js
 * Also gets run automatically via postinstall.
 */

const fs = require('node:fs');
const path = require('node:path');

if (process.platform !== 'win32') {
  process.exit(0);
}

const targetDir = path.join(
  __dirname,
  '..',
  'node_modules',
  '@triton-one',
  'yellowstone-grpc-napi-win32-x64-msvc'
);

if (!fs.existsSync(path.join(__dirname, '..', 'node_modules', '@drift-labs', 'sdk'))) {
  // Drift SDK not installed — nothing to stub.
  process.exit(0);
}

try {
  fs.mkdirSync(targetDir, { recursive: true });

  fs.writeFileSync(
    path.join(targetDir, 'package.json'),
    JSON.stringify(
      {
        name: '@triton-one/yellowstone-grpc-napi-win32-x64-msvc',
        version: '0.2.0',
        main: 'index.js',
      },
      null,
      2
    )
  );

  fs.writeFileSync(
    path.join(targetDir, 'index.js'),
    `// Auto-generated stub for yellowstone-grpc native binding on Windows.
// Drift SDK loads this at import time but only uses it for gRPC account
// subscription, which we don't use (we use polling). Stubbing lets the
// SDK load successfully; actual gRPC calls would throw.

class StubClient {
  constructor() {}
  async connect() {}
  async close() {}
  async subscribe() {
    throw new Error('yellowstone-grpc stub: gRPC not supported on Windows');
  }
  async ping() { return { count: 0 }; }
}

module.exports = StubClient;
module.exports.default = StubClient;
module.exports.Client = StubClient;
module.exports.SubscribeUpdate = {};
module.exports.SubscribeRequest = {};
module.exports.CommitmentLevel = { PROCESSED: 0, CONFIRMED: 1, FINALIZED: 2 };
`
  );

  console.log('[stub-yellowstone-grpc] Created Windows stub for @drift-labs/sdk');
} catch (err) {
  console.warn('[stub-yellowstone-grpc] Failed to create stub:', err.message);
}
