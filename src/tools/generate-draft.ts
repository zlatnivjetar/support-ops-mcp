/**
 * generate_draft — Generate an AI draft response for a ticket using RAG-grounded evidence.
 *
 * Input: ticket_id (UUID)
 *
 * Output: Draft body, confidence, send_ready flag, evidence chunk count, latency.
 *
 * Maps to: POST /tickets/{id}/draft on the ASD API.
 * Note: Draft is created with "pending" approval status — use review_draft to approve/reject.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AsdClient } from '../asd-client/index.js';
import { formatToolError } from './errors.js';

export function registerGenerateDraft(server: McpServer, client: AsdClient) {
  server.registerTool(
    'generate_draft',
    {
      title: 'Generate Draft Response',
      description:
        'Generate an AI draft response for a ticket using RAG-grounded evidence from the ' +
        'knowledge base. The AI retrieves relevant documentation, then writes a response with ' +
        'citations. Returns the draft body, cited evidence, confidence score, and whether the ' +
        'draft is ready to send. Drafts are created with "pending" approval status — use ' +
        'review_draft to approve or reject.',
      inputSchema: {
        ticket_id: z.string().uuid().describe('The ticket ID to generate a draft for'),
      },
    },
    async (args) => {
      try {
        const result = await client.generateDraft(args.ticket_id);

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  draft: {
                    id: result.id,
                    ticket_id: result.ticket_id,
                    body: result.body,
                    confidence: result.confidence,
                    send_ready: result.send_ready,
                    evidence_chunks_cited: result.evidence_chunk_ids.length,
                    unresolved_questions: result.unresolved_questions,
                    approval_status: result.approval_outcome,
                  },
                  latency_ms: result.latency_ms,
                  next_steps: 'Use review_draft to approve, reject, or escalate this draft.',
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return formatToolError(err, {
          toolName: 'generate_draft',
          statusMessages: {
            404: `Ticket not found: ${args.ticket_id}`,
            403: 'Draft generation requires agent or lead role',
            504: 'Draft generation timed out — the AI backend may be under load. Try again.',
          },
        });
      }
    },
  );
}
