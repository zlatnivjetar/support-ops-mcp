/**
 * Creates an McpServer with all support operations tools registered.
 *
 * This is called once for stdio transport (persistent server),
 * or once per request for stateless HTTP transport.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AsdClient } from './asd-client/index.js';
import type { Config } from './config.js';
import { registerAllTools } from './tools/index.js';

const SERVER_NAME = 'support-ops-mcp';
const SERVER_VERSION = '0.1.0';

export function createServer(config: Config): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions: `This server provides support operations tools backed by Agent Service Desk.
Available capabilities:
- Search and filter support tickets
- Get full ticket details with conversation history
- Run AI triage (classification) on tickets
- Generate AI draft responses with RAG-grounded citations
- Review and approve/reject AI-generated drafts
- Search the knowledge base semantically
- View the pending draft review queue
- Update ticket fields (status, priority, assignment)

Typical workflow: search_tickets → get_ticket → triage_ticket → generate_draft → review_draft`,
    },
  );

  const client = new AsdClient(config);

  registerAllTools(server, client);

  return server;
}
