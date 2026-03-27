/**
 * Runs verify-hardening.ts against a server started with custom env overrides.
 *
 * Usage:
 *   node tests/run-hardening-verify.mjs ASD_TIMEOUT_MS=1
 *   node tests/run-hardening-verify.mjs ASD_API_URL=http://localhost:9999
 */

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Parse overrides from CLI args (KEY=value)
const overrides = Object.fromEntries(
  process.argv.slice(2).map((arg) => arg.split('=', 2)),
);

// Load .env file (skip commented lines)
const envFromFile = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => l.split('=', 2))
    .filter(([k]) => k),
);

const env = { ...process.env, ...envFromFile, ...overrides };

console.log('Starting server with overrides:', overrides);

const server = spawn('npx', ['tsx', 'src/index.ts'], { env, shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
server.stderr.on('data', (d) => process.stderr.write('[server] ' + d));

// Wait for health endpoint
await new Promise((resolve, reject) => {
  const start = Date.now();
  const poll = setInterval(async () => {
    try {
      const r = await fetch('http://127.0.0.1:3001/health');
      if (r.ok) { clearInterval(poll); resolve(); }
    } catch { /* not ready yet */ }
    if (Date.now() - start > 10_000) { clearInterval(poll); reject(new Error('Server startup timed out')); }
  }, 300);
});

console.log('Server ready. Running verifier...\n');

const verifier = spawn('npx', ['tsx', 'tests/verify-hardening.ts'], { env: process.env, shell: true, stdio: 'inherit' });
const code = await new Promise((resolve) => verifier.on('close', resolve));

server.kill();
process.exit(code ?? 0);
