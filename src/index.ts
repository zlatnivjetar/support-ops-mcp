#!/usr/bin/env node
import { loadConfig } from './config.js';
import { log } from './logger.js';
import { startHttpTransport, startStdioTransport } from './transport.js';

async function main() {
  const config = loadConfig();
  log('info', 'Server starting', { transport: config.transport, port: config.port });

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
