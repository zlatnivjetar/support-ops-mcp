# Implementation Log

---

## Milestone 1A — Project Scaffold

**What changed:** Created the full project skeleton — `package.json`, `tsconfig.json`, `.gitignore`, `.env.example`, `LICENSE`, `README.md`, placeholder `src/` files (`index.ts`, `server.ts`, `transport.ts`, `config.ts`, `asd-client/index.ts`, `asd-client/types.ts`, `tools/index.ts`), and `tests/client-test.ts`. Installed all npm dependencies.

**Key decisions:**
- `@modelcontextprotocol/express` does not exist on npm — removed from `package.json`. DNS rebinding protection will be handled directly in Express middleware when the HTTP transport is implemented in 1C.
- Used `moduleResolution: "bundler"` in tsconfig to support ESM `.js` extension imports alongside `tsup`.

**Key files:** `package.json`, `tsconfig.json`, `src/config.ts`, `src/index.ts`

**Gotchas:** The implementation plan referenced `@modelcontextprotocol/express` but this package is not published. The MCP SDK's `StreamableHTTPServerTransport` is used directly with Express.

---

## Milestone 1B — ASD API Client

**What changed:** Implemented `src/asd-client/types.ts` and `src/asd-client/index.ts` — the full typed HTTP client for the Agent Service Desk API.

**Key decisions:**
- `AsdApiError` carries `status`, `detail`, and `endpoint` fields so MCP tools can surface specific, debuggable error messages.
- `buildQuery` filters out `undefined`, `null`, and `''` so optional params don't pollute query strings.
- 204 No Content handled explicitly — returns `undefined as T` rather than trying to parse an empty body.
- No unit tests added — the client is a thin fetch wrapper; the interactive test client (1C) is the appropriate validation against real API responses.

**Key files:** `src/asd-client/types.ts`, `src/asd-client/index.ts`

**Gotchas:** None.

---

## Milestone 1C — MCP Server & Transport Setup

**What changed:** Implemented `src/server.ts`, `src/transport.ts`, and rewrote `src/index.ts`. The server now boots as either a Streamable HTTP server (Express on port 3001) or a stdio process depending on the `TRANSPORT` env var.

**Key decisions:**
- `@modelcontextprotocol/express` does not exist as a standalone npm package. `createMcpExpressApp` is exported directly from `@modelcontextprotocol/sdk/server/express.js` — used that instead.
- `instructions` is a `ServerOptions` field (second arg to `McpServer`), not part of `serverInfo` (first arg). Plan had them merged into one object.
- Stateless HTTP: new `McpServer` + `StreamableHTTPServerTransport` per request — no session tracking (`sessionIdGenerator: undefined`).
- stdio `console.error` goes to stderr so it doesn't pollute the JSON-RPC stdout channel.

**Key files:** `src/server.ts`, `src/transport.ts`, `src/index.ts`

**Gotchas:** `sleep` in bash commands causes the Bash tool to auto-background them on this machine. Workaround: start server with explicit `run_in_background: true`, then curl in a separate tool call.

---

## Milestone 1D — First Tool: `search_tickets`

**What changed:** Implemented `src/tools/search-tickets.ts` with the full `search_tickets` MCP tool. Created `src/tools/index.ts` barrel with `registerAllTools`. Wired `registerAllTools(server, client)` into `src/server.ts`.

**Key decisions:**
- Tool follows the established pattern: Zod input schema with `.describe()` on every field → handler → JSON response.
- Output strips fields the LLM doesn't need (e.g. full message history) — only surfaces `id`, `subject`, `status`, `priority`, `category`, `team`, `assignee_name`, `confidence`, `created_at`.
- `AsdApiError` caught in handler → `isError: true` response so MCP connection never crashes.
- Unexpected errors re-thrown so they surface as transport-level errors (correct behaviour).

**Key files:** `src/tools/search-tickets.ts`, `src/tools/index.ts`, `src/server.ts`

**Gotchas:** None.

---

## Milestone 1E — End-to-End Verification

**What changed:** Implemented `tests/client-test.ts` — an MCP SDK `Client` that connects via Streamable HTTP and runs three `search_tickets` tests against the live ASD API.

**Key decisions:**
- Session-based HTTP transport (one `McpServer` + `StreamableHTTPServerTransport` per session, reused across requests). The originally planned stateless-per-request pattern failed: the MCP client sends `initialize` once and reuses the session, but a fresh server instance on the second request has no protocol state and returns `-32601 Method not found` for `tools/list`.
- `onsessioninitialized` callback stores the server/transport pair in a `Map<sessionId, Session>`. Subsequent requests with `mcp-session-id` header route to the stored transport instance.
- `transport.onclose` cleans up the session map when a client disconnects.
- JWT obtained via `seed/mint_tokens.py` with 90-day expiry (offline signing — bypasses the Next.js `/api/token` route which hardcodes 1h expiry). Real values kept out of `.env.example`.
- `tsx --env-file=.env` loads the env file. Requires killing any lingering server process before restarting.

**Key files:** `tests/client-test.ts`, `src/transport.ts`, `.env.example`, `package.json`

**Gotchas:**
- Stateless MCP transport is incompatible with the standard `StreamableHTTPClientTransport` — the client sends `initialize` once, but stateless mode creates a fresh server per POST that rejects subsequent methods. Session-based mode is required.
- An old server process holding port 3001 caused the new server to silently fail to bind, hiding debug output.
