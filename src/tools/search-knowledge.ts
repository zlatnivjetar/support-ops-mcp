/**
 * search_knowledge — Semantic search over the support knowledge base.
 *
 * Input: query string, optional top_k
 *
 * Output: Ranked document chunks with similarity scores and full content.
 *
 * Maps to: GET /knowledge/search on the ASD API.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AsdClient } from '../asd-client/index.js';
import { AsdApiError } from '../asd-client/index.js';

export function registerSearchKnowledge(server: McpServer, client: AsdClient) {
  server.registerTool(
    'search_knowledge',
    {
      title: 'Search Knowledge Base',
      description:
        'Semantic search over the support knowledge base. Returns document chunks ranked by ' +
        'relevance with similarity scores. Use this to find documentation, FAQs, or policy ' +
        'information relevant to a customer\'s question.',
      inputSchema: {
        query: z
          .string()
          .min(1)
          .describe(
            'Search query — be specific for better results ' +
              '(e.g., "refund policy for annual plans" not just "refund")',
          ),
        top_k: z
          .number()
          .int()
          .min(1)
          .max(20)
          .optional()
          .describe('Number of results to return (default: 5)'),
      },
    },
    async (args) => {
      try {
        const results = await client.searchKnowledge(args.query, args.top_k);

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  query: args.query,
                  results: results.map((r) => ({
                    chunk_id: r.chunk_id,
                    document_title: r.document_title,
                    content: r.content,
                    similarity: r.similarity,
                    chunk_index: r.chunk_index,
                  })),
                  result_count: results.length,
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
                text: `Error searching knowledge base: ${err.detail} (HTTP ${err.status})`,
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
