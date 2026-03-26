/**
 * get_review_queue — List AI-generated drafts pending human review.
 *
 * Input: optional page and per_page
 *
 * Output: Pending drafts with preview (truncated to 200 chars), confidence score,
 *         and associated ticket info. Ordered oldest-first (FIFO).
 *
 * Maps to: GET /drafts/review-queue on the ASD API.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AsdClient } from '../asd-client/index.js';
import { AsdApiError } from '../asd-client/index.js';

export function registerGetReviewQueue(server: McpServer, client: AsdClient) {
  server.registerTool(
    'get_review_queue',
    {
      title: 'Get Review Queue',
      description:
        'List AI-generated draft responses awaiting human review. Returns pending drafts ordered ' +
        'oldest-first (FIFO). Each item shows the draft body preview, confidence score, and ' +
        'associated ticket. Use review_draft to approve, reject, or escalate items from this queue.',
      inputSchema: {
        page: z.number().int().min(1).optional().describe('Page number (default: 1)'),
        per_page: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe('Results per page (default: 25, max: 50)'),
      },
    },
    async (args) => {
      try {
        const data = await client.getReviewQueue({ page: args.page, per_page: args.per_page });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  pending_drafts: data.items.map((item) => ({
                    draft_id: item.draft_generation_id,
                    ticket_id: item.ticket_id,
                    ticket_subject: item.ticket_subject,
                    draft_preview: item.body.length > 200 ? item.body.slice(0, 200) + '…' : item.body,
                    confidence: item.confidence,
                    created_at: item.created_at,
                  })),
                  pagination: {
                    total: data.total,
                    page: data.page,
                    per_page: data.per_page,
                    total_pages: data.total_pages,
                  },
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        if (err instanceof AsdApiError) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Error fetching review queue: ${err.detail} (HTTP ${err.status})`,
              },
            ],
            isError: true,
          };
        }
        throw err;
      }
    },
  );
}
