import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AsdClient } from '../asd-client/index.js';
import { registerSearchTickets } from './search-tickets.js';
import { registerGetTicket } from './get-ticket.js';

/**
 * Register all MCP tools on the server.
 * Each tool maps to one ASD API endpoint.
 */
export function registerAllTools(server: McpServer, client: AsdClient) {
  registerSearchTickets(server, client);
  registerGetTicket(server, client);
  // More tools added in M2 and M3
}
