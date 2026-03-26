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
