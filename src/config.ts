/**
 * Configuration for the MCP server.
 *
 * Required env vars:
 *   ASD_API_URL  — Base URL of the Agent Service Desk API
 *                  (e.g., https://agent-service-desk-api.railway.app)
 *   ASD_JWT      — Bearer token for authenticating with the ASD API
 *
 * Optional:
 *   PORT         — HTTP port for Streamable HTTP transport (default: 3001)
 *   TRANSPORT    — "http" | "stdio" (default: "http")
 */
export interface Config {
  asdApiUrl: string;
  asdJwt: string;
  port: number;
  transport: 'http' | 'stdio';
}

export function loadConfig(): Config {
  const asdApiUrl = process.env.ASD_API_URL;
  const asdJwt = process.env.ASD_JWT;

  if (!asdApiUrl) throw new Error('ASD_API_URL environment variable is required');
  if (!asdJwt) throw new Error('ASD_JWT environment variable is required');

  return {
    asdApiUrl: asdApiUrl.replace(/\/$/, ''), // strip trailing slash
    asdJwt,
    port: parseInt(process.env.PORT || '3001', 10),
    transport: (process.env.TRANSPORT as 'http' | 'stdio') || 'http',
  };
}
