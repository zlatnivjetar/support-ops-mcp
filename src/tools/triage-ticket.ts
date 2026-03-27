/**
 * triage_ticket — Run AI triage on a ticket to classify it.
 *
 * Input: ticket_id (UUID)
 *
 * Output: Prediction with category, priority, team, escalation, confidence, and latency.
 *
 * Maps to: POST /tickets/{id}/triage on the ASD API.
 * Note: Creates a prediction record — does NOT modify the ticket itself.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AsdClient } from '../asd-client/index.js';
import { AsdApiError } from '../asd-client/index.js';

export function registerTriageTicket(server: McpServer, client: AsdClient) {
  server.registerTool(
    'triage_ticket',
    {
      title: 'Triage Ticket',
      description:
        'Run AI triage on a ticket to classify its category, priority, team assignment, and ' +
        'escalation need. Returns a prediction with confidence score. This does NOT modify the ' +
        'ticket — it creates a separate prediction record. Run this before generate_draft to ' +
        'ensure the ticket is classified.',
      inputSchema: {
        ticket_id: z.string().uuid().describe('The ticket ID to triage'),
      },
    },
    async (args) => {
      try {
        const result = await client.triageTicket(args.ticket_id);

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  prediction: {
                    ticket_id: result.ticket_id,
                    predicted_category: result.predicted_category,
                    predicted_priority: result.predicted_priority,
                    predicted_team: result.predicted_team,
                    escalation_suggested: result.escalation_suggested,
                    escalation_reason: result.escalation_reason,
                    confidence: result.confidence,
                  },
                  latency_ms: result.latency_ms,
                  note: 'Prediction stored separately from ticket. Use update_ticket to apply these values.',
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        if (err instanceof AsdApiError) {
          let message: string;
          if (err.status === 404) {
            message = `Ticket not found: ${args.ticket_id}`;
          } else if (err.status === 403) {
            message = 'Triage requires agent or lead role';
          } else if (err.status === 504) {
            message = 'Triage timed out — the AI backend may be under load. Try again.';
          } else {
            message = `Error triaging ticket: ${err.detail} (HTTP ${err.status})`;
          }
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
