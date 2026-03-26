/**
 * Transport setup — Streamable HTTP (stateless) or stdio.
 *
 * Streamable HTTP (default):
 *   Express server on PORT with POST /mcp endpoint.
 *   Stateless — new McpServer per request, no session tracking.
 *   Uses createMcpExpressApp from the MCP SDK for DNS rebinding protection.
 *
 * stdio:
 *   Reads JSON-RPC from stdin, writes to stdout.
 *   Used when Claude Desktop or Cursor spawns this as a child process.
 */

import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Config } from './config.js';
import { createServer } from './server.js';

export async function startHttpTransport(config: Config): Promise<void> {
  const app = createMcpExpressApp();

  // Stateless: create a new server + transport per request
  app.post('/mcp', async (req, res) => {
    const server = createServer(config);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless — no session tracking
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  // Health endpoint (separate from MCP protocol)
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', server: 'support-ops-mcp' });
  });

  app.listen(config.port, '127.0.0.1', () => {
    console.log(`Support Ops MCP Server (HTTP) listening on http://127.0.0.1:${config.port}/mcp`);
  });
}

export async function startStdioTransport(config: Config): Promise<void> {
  const server = createServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdio transport runs until the process is killed
  console.error('Support Ops MCP Server (stdio) connected'); // stderr so it doesn't interfere with JSON-RPC on stdout
}
