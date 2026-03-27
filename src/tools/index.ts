import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AsdClient } from '../asd-client/index.js';
import { registerSearchTickets } from './search-tickets.js';
import { registerGetTicket } from './get-ticket.js';
import { registerSearchKnowledge } from './search-knowledge.js';
import { registerGetReviewQueue } from './get-review-queue.js';
import { registerTriageTicket } from './triage-ticket.js';
import { registerGenerateDraft } from './generate-draft.js';

/**
 * Register all MCP tools on the server.
 * Each tool maps to one ASD API endpoint.
 */
export function registerAllTools(server: McpServer, client: AsdClient) {
  registerSearchTickets(server, client);
  registerGetTicket(server, client);
  registerSearchKnowledge(server, client);
  registerGetReviewQueue(server, client);
  registerTriageTicket(server, client);
  registerGenerateDraft(server, client);
}
