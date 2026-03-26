/**
 * Transport setup — Streamable HTTP (stateful, session-based) or stdio.
 *
 * Streamable HTTP (default):
 *   Express server on PORT with POST /mcp endpoint.
 *   Session-based — one McpServer + transport per client session, stored in memory.
 *   Sessions are cleaned up when the transport closes.
 *
 * stdio:
 *   Reads JSON-RPC from stdin, writes to stdout.
 *   Used when Claude Desktop or Cursor spawns this as a child process.
 */

import { randomUUID } from 'node:crypto';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Config } from './config.js';
import { createServer } from './server.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

interface Session {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
}

export async function startHttpTransport(config: Config): Promise<void> {
  const app = createMcpExpressApp();
  const sessions = new Map<string, Session>();

  app.post('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    // Resume existing session
    if (sessionId && sessions.has(sessionId)) {
      const { transport } = sessions.get(sessionId)!;
      await transport.handleRequest(req, res, req.body);
      return;
    }

    // New session — create server + transport
    const server = createServer(config);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        sessions.set(id, { server, transport });
      },
    });

    transport.onclose = () => {
      if (transport.sessionId) {
        sessions.delete(transport.sessionId);
      }
    };

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
