#!/usr/bin/env node
import { loadConfig } from './config.js';
import { startHttpTransport, startStdioTransport } from './transport.js';

async function main() {
  const config = loadConfig();

  if (config.transport === 'stdio') {
    await startStdioTransport(config);
  } else {
    await startHttpTransport(config);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
