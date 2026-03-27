/**
 * Minimal hardening verifier — used in Milestone 4D.
 *
 * Connects to the running MCP server, calls search_tickets once, and reports
 * whether the response is a structured isError response or a successful result.
 * Run with env overrides to verify timeout and unreachable handling:
 *
 *   ASD_TIMEOUT_MS=1      tsx tests/verify-hardening.ts  → should print TimeoutError
 *   ASD_API_URL=bad-url   tsx tests/verify-hardening.ts  → should print unreachable
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const SERVER_URL = process.env.MCP_SERVER_URL || 'http://127.0.0.1:3001/mcp';

const transport = new StreamableHTTPClientTransport(new URL(SERVER_URL));
const client = new Client({ name: 'hardening-verify', version: '1.0.0' });
await client.connect(transport);

const result = await client.callTool({
  name: 'search_tickets',
  arguments: { status: 'open', per_page: 1 },
});

const text = (result.content[0] as { type: string; text: string }).text;
console.log(`isError : ${result.isError ?? false}`);
console.log(`message : ${text}`);

await client.close();
