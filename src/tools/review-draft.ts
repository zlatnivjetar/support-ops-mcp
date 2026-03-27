/**
 * review_draft — Submit an approval decision on a pending AI-generated draft.
 *
 * Input: draft_id (UUID), action, optional edited_body and reason
 *
 * Output: Confirmation of the review decision and result message.
 *
 * Maps to: POST /drafts/{id}/review on the ASD API.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AsdClient } from '../asd-client/index.js';
import { AsdApiError } from '../asd-client/index.js';

const RESULT_MESSAGES: Record<string, string> = {
  approved: 'Draft approved and ticket status updated to pending_customer.',
  edited_and_approved: 'Draft edited and approved. Ticket status updated to pending_customer.',
  rejected: 'Draft rejected. Generate a new draft with generate_draft if needed.',
  escalated: 'Draft escalated for senior review.',
};

export function registerReviewDraft(server: McpServer, client: AsdClient) {
  server.registerTool(
    'review_draft',
    {
      title: 'Review Draft',
      description:
        'Submit a review decision on an AI-generated draft. Actions: "approved" (send as-is), ' +
        '"edited_and_approved" (send with edits — provide edited_body), "rejected" (discard — ' +
        'provide reason), "escalated" (flag for senior review). Use get_review_queue or ' +
        'get_ticket to see pending drafts first.',
      inputSchema: {
        draft_id: z.string().uuid().describe('The draft generation ID to review'),
        action: z
          .enum(['approved', 'edited_and_approved', 'rejected', 'escalated'])
          .describe('Review decision'),
        edited_body: z
          .string()
          .optional()
          .describe('Required when action is "edited_and_approved" — the revised draft text'),
        reason: z
          .string()
          .optional()
          .describe('Optional reason for rejection or escalation'),
      },
    },
    async (args) => {
      if (args.action === 'edited_and_approved' && !args.edited_body) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'edited_body is required when action is "edited_and_approved"',
            },
          ],
          isError: true,
        };
      }

      try {
        await client.reviewDraft(args.draft_id, {
          action: args.action,
          edited_body: args.edited_body,
          reason: args.reason,
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  review: {
                    draft_id: args.draft_id,
                    action: args.action,
                    result: RESULT_MESSAGES[args.action],
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
          let message: string;
          if (err.status === 404) {
            message = `Draft not found: ${args.draft_id}`;
          } else if (err.status === 403) {
            message = 'Reviewing drafts requires agent or lead role';
          } else if (err.status === 409) {
            message = `Draft has already been reviewed: ${args.draft_id}`;
          } else {
            message = `Error reviewing draft: ${err.detail} (HTTP ${err.status})`;
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
