/**
 * update_ticket — Update fields on a support ticket.
 *
 * Input: ticket_id (UUID), plus any combination of status, priority, category, team, assignee_id
 *
 * Output: Updated ticket snapshot and list of which fields were changed.
 *
 * Maps to: PATCH /tickets/{id} on the ASD API.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AsdClient } from '../asd-client/index.js';
import { formatToolError } from './errors.js';

export function registerUpdateTicket(server: McpServer, client: AsdClient) {
  server.registerTool(
    'update_ticket',
    {
      title: 'Update Ticket',
      description:
        'Update ticket fields: status, priority, category, team, or assignee. All fields are ' +
        'optional — only provided fields are updated. Use this after triage_ticket to apply ' +
        'predicted values, or to manually adjust ticket properties.',
      inputSchema: {
        ticket_id: z.string().uuid().describe('The ticket ID to update'),
        status: z
          .enum(['open', 'in_progress', 'pending_customer', 'pending_internal', 'resolved', 'closed'])
          .optional()
          .describe('New status'),
        priority: z
          .enum(['low', 'medium', 'high', 'critical'])
          .optional()
          .describe('New priority level'),
        category: z
          .enum([
            'billing',
            'bug_report',
            'feature_request',
            'account_access',
            'integration',
            'api_issue',
            'onboarding',
            'data_export',
          ])
          .optional()
          .describe('New category'),
        team: z.string().optional().describe('New team assignment'),
        assignee_id: z.string().uuid().optional().describe('New assignee user ID'),
      },
    },
    async (args) => {
      const updates: Record<string, string> = {};
      const fieldsChanged: string[] = [];

      if (args.status !== undefined) { updates.status = args.status; fieldsChanged.push('status'); }
      if (args.priority !== undefined) { updates.priority = args.priority; fieldsChanged.push('priority'); }
      if (args.category !== undefined) { updates.category = args.category; fieldsChanged.push('category'); }
      if (args.team !== undefined) { updates.team = args.team; fieldsChanged.push('team'); }
      if (args.assignee_id !== undefined) { updates.assignee_id = args.assignee_id; fieldsChanged.push('assignee_id'); }

      if (fieldsChanged.length === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'At least one field to update must be provided.',
            },
          ],
          isError: true,
        };
      }

      try {
        const ticket = await client.updateTicket(args.ticket_id, updates);

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  updated_ticket: {
                    id: ticket.id,
                    subject: ticket.subject,
                    status: ticket.status,
                    priority: ticket.priority,
                    category: ticket.category,
                    team: ticket.team,
                    assignee: ticket.assignee_name,
                  },
                  fields_changed: fieldsChanged,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return formatToolError(err, {
          toolName: 'update_ticket',
          statusMessages: {
            404: `Ticket not found: ${args.ticket_id}`,
          },
        });
      }
    },
  );
}
