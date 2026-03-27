/**
 * search_tickets — Search and filter support tickets.
 *
 * Input: Optional filters for status, priority, category, team, assignee.
 *        Pagination via page/per_page. Sorting via sort_by/sort_order.
 *
 * Output: Paginated list of tickets with key fields:
 *         id, subject, status, priority, category, team, assignee, confidence, timestamps.
 *
 * Maps to: GET /tickets on the ASD API.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AsdClient } from '../asd-client/index.js';
import { formatToolError } from './errors.js';

export function registerSearchTickets(server: McpServer, client: AsdClient) {
  server.registerTool(
    'search_tickets',
    {
      title: 'Search Tickets',
      description:
        'Search and filter support tickets. Returns a paginated list with ticket metadata including ' +
        'status, priority, category, team assignment, and AI confidence scores. ' +
        'Use filters to narrow results. Omit all filters to get the most recent tickets.',
      inputSchema: {
        status: z
          .enum(['open', 'in_progress', 'pending_customer', 'pending_internal', 'resolved', 'closed'])
          .optional()
          .describe('Filter by ticket status'),
        priority: z
          .enum(['low', 'medium', 'high', 'critical'])
          .optional()
          .describe('Filter by priority level'),
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
          .describe('Filter by ticket category'),
        team: z.string().optional().describe('Filter by assigned team name'),
        assignee_id: z.string().uuid().optional().describe('Filter by assignee user ID'),
        sort_by: z
          .enum(['created_at', 'updated_at', 'priority', 'status'])
          .optional()
          .describe('Field to sort by (default: created_at)'),
        sort_order: z
          .enum(['asc', 'desc'])
          .optional()
          .describe('Sort direction (default: desc)'),
        page: z.number().int().min(1).optional().describe('Page number (default: 1)'),
        per_page: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe('Results per page (default: 25, max: 100)'),
      },
    },
    async (args) => {
      try {
        const result = await client.searchTickets({
          status: args.status,
          priority: args.priority,
          category: args.category,
          team: args.team,
          assignee_id: args.assignee_id,
          sort_by: args.sort_by,
          sort_order: args.sort_order,
          page: args.page,
          per_page: args.per_page,
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  tickets: result.items.map((t) => ({
                    id: t.id,
                    subject: t.subject,
                    status: t.status,
                    priority: t.priority,
                    category: t.category,
                    team: t.team,
                    assignee: t.assignee_name,
                    confidence: t.confidence,
                    created_at: t.created_at,
                  })),
                  pagination: {
                    total: result.total,
                    page: result.page,
                    per_page: result.per_page,
                    total_pages: result.total_pages,
                  },
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return formatToolError(err, { toolName: 'search_tickets' });
      }
    },
  );
}
