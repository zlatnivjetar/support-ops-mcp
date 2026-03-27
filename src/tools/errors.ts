import { AsdApiError } from '../asd-client/index.js';

export interface ToolErrorOptions {
  /** Tool name for the error prefix (e.g. "search_tickets") */
  toolName: string;
  /** Custom messages by HTTP status code. Keys not listed fall through to the generic handler. */
  statusMessages?: Record<number, string>;
}

/**
 * Formats any error into a structured MCP tool error response.
 * - 401 AsdApiError: JWT-specific message (global concern, applies to every tool)
 * - Other AsdApiError: uses statusMessages lookup, falls back to generic "Error in tool: detail (HTTP status)"
 * - Network errors (TypeError with "fetch failed" / ECONNREFUSED): ASD-unreachable message
 * - All other errors: generic internal error message
 *
 * Never throws — always returns a valid MCP response.
 */
export function formatToolError(err: unknown, opts: ToolErrorOptions) {
  let message: string;

  if (err instanceof AsdApiError) {
    if (err.status === 401) {
      message =
        'Authentication failed — the ASD JWT may be expired or invalid. Check the ASD_JWT environment variable.';
    } else {
      message =
        opts.statusMessages?.[err.status] ??
        `Error in ${opts.toolName}: ${err.detail} (HTTP ${err.status})`;
    }
  } else if (isNetworkError(err)) {
    message =
      'ASD API is unreachable — the backend may be down or the URL may be misconfigured. Check ASD_API_URL and try again.';
  } else {
    message = `Internal error in ${opts.toolName}: ${err instanceof Error ? err.message : String(err)}`;
  }

  return {
    content: [{ type: 'text' as const, text: message }],
    isError: true,
  };
}

function isNetworkError(err: unknown): boolean {
  return (
    err instanceof TypeError &&
    (err.message.includes('fetch failed') || err.message.includes('ECONNREFUSED'))
  );
}
