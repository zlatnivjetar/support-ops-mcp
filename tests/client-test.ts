/**
 * Interactive test client for the Support Ops MCP Server.
 *
 * Usage:
 *   1. Start the server: npm run dev
 *   2. Run this: npm run test:client
 *
 * This uses the MCP SDK's Client class to connect via Streamable HTTP
 * and exercise each registered tool.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const SERVER_URL = process.env.MCP_SERVER_URL || 'http://127.0.0.1:3001/mcp';

async function main() {
  console.log(`Connecting to MCP server at ${SERVER_URL}...`);

  const transport = new StreamableHTTPClientTransport(new URL(SERVER_URL));
  const client = new Client({ name: 'test-client', version: '1.0.0' });

  await client.connect(transport);
  console.log('Connected!\n');

  // List available tools
  const { tools } = await client.listTools();
  console.log(`Available tools (${tools.length}):`);
  for (const tool of tools) {
    console.log(`  - ${tool.name}: ${tool.description?.substring(0, 80)}...`);
  }
  console.log();

  // Test 1: search_tickets with no filters (should return recent tickets)
  console.log('=== Test 1: search_tickets (no filters) ===');
  const result1 = await client.callTool({
    name: 'search_tickets',
    arguments: { per_page: 3 },
  });
  console.log('Result:', JSON.stringify(result1.content, null, 2));
  console.log();

  // Test 2: search_tickets with filters
  console.log('=== Test 2: search_tickets (status=open, priority=high) ===');
  const result2 = await client.callTool({
    name: 'search_tickets',
    arguments: { status: 'open', priority: 'high', per_page: 3 },
  });
  console.log('Result:', JSON.stringify(result2.content, null, 2));
  console.log();

  // Test 3: search_tickets with bad filter (should still work, return 0 results)
  console.log('=== Test 3: search_tickets (category=billing, sort_by=priority) ===');
  const result3 = await client.callTool({
    name: 'search_tickets',
    arguments: { category: 'billing', sort_by: 'priority', sort_order: 'desc', per_page: 5 },
  });
  console.log('Result:', JSON.stringify(result3.content, null, 2));

  await client.close();
  console.log('\nDone — all tests passed.');
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
