/**
 * get_ticket — Get complete details for a specific support ticket.
 *
 * Input: ticket_id (UUID)
 *
 * Output: Ticket metadata, full conversation thread, latest AI prediction (if any),
 *         latest AI-generated draft (if any).
 *
 * Maps to: GET /tickets/{id} on the ASD API.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AsdClient } from '../asd-client/index.js';
import { AsdApiError } from '../asd-client/index.js';

export function registerGetTicket(server: McpServer, client: AsdClient) {
  server.registerTool(
    'get_ticket',
    {
      title: 'Get Ticket Details',
      description:
        'Get complete details for a specific ticket including the full conversation thread, ' +
        'latest AI triage prediction (if any), and latest AI-generated draft (if any). ' +
        'Use this after search_tickets to inspect a specific ticket before taking action.',
      inputSchema: {
        ticket_id: z.string().uuid().describe('The ticket ID to retrieve'),
      },
    },
    async (args) => {
      try {
        const ticket = await client.getTicket(args.ticket_id);

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  id: ticket.id,
                  subject: ticket.subject,
                  status: ticket.status,
                  priority: ticket.priority,
                  category: ticket.category,
                  team: ticket.team,
                  assignee: ticket.assignee_name,
                  org: ticket.org_name,
                  created_at: ticket.created_at,
                  updated_at: ticket.updated_at,
                  messages: ticket.messages.map((m) => ({
                    sender: m.sender_type,
                    sender_name: m.sender_name,
                    body: m.body,
                    internal: m.is_internal,
                    sent_at: m.created_at,
                  })),
                  prediction: ticket.latest_prediction
                    ? {
                        predicted_category: ticket.latest_prediction.predicted_category,
                        predicted_priority: ticket.latest_prediction.predicted_priority,
                        predicted_team: ticket.latest_prediction.predicted_team,
                        confidence: ticket.latest_prediction.confidence,
                        escalation_suggested: ticket.latest_prediction.escalation_suggested,
                        escalation_reason: ticket.latest_prediction.escalation_reason,
                      }
                    : null,
                  draft: ticket.latest_draft
                    ? {
                        id: ticket.latest_draft.id,
                        body: ticket.latest_draft.body.substring(0, 500),
                        confidence: ticket.latest_draft.confidence,
                        send_ready: ticket.latest_draft.send_ready,
                        approval_outcome: ticket.latest_draft.approval_outcome,
                        evidence_chunks: ticket.latest_draft.evidence_chunk_ids.length,
                      }
                    : null,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        if (err instanceof AsdApiError) {
          const message =
            err.status === 404
              ? `Ticket not found: ${args.ticket_id}`
              : `Error fetching ticket: ${err.detail} (HTTP ${err.status})`;
          return {
            content: [{ type: 'text' as const, text: message }],
            isError: true,
          };
        }
        throw err;
      }
    },
  );
}
