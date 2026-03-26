# Support Operations MCP Server

## Current Milestone

**→ Milestone 2B: `search_knowledge` Tool**

Implementation plan: `docs/implementation-plan.md`

When instructed to "implement current milestone", read the matching sub-milestone from the plan file.

---

## Completion Protocol

When I type exactly **COMPLETED**:

1. Update "Current Milestone" at the top of this file to the next sub-milestone
2. Append a summary to `docs/implementation-log.md`: what changed, key decisions made, key files touched, any gotchas
3. Use the `/concepts-debrief` skill to append a concepts debrief to `docs/concepts-log.md`
4. Commit with message: `milestone <ID>: <brief description>`

Only the exact standalone input **COMPLETED** triggers this.

---

## Project Context

TypeScript MCP server exposing support operations as tools over Streamable HTTP (stateless) and stdio transports. Backed by the Agent Service Desk API.

## Architecture

- `src/server.ts` — McpServer instance, tool registration
- `src/transport.ts` — dual transport: Streamable HTTP + stdio, selected via `TRANSPORT` env var
- `src/config.ts` — env-based config (`ASD_API_URL`, `ASD_JWT`, `PORT`, `TRANSPORT`)
- `src/asd-client/` — typed HTTP client for the ASD API. No MCP awareness — pure fetch wrapper with JWT passthrough
- `src/tools/` — one file per MCP tool, barrel export via `index.ts`

## Tool Pattern

Every tool follows this structure (established in `search-tickets.ts`):

1. Zod input schema with `.describe()` on every field
2. Async handler: validate → call AsdClient method → format JSON response
3. Catch `AsdApiError` → return `{ isError: true, content: [{ type: 'text', text: '...' }] }`
4. Never throw from a handler — always return structured MCP responses
5. Output is JSON.stringify'd with 2-space indent, only fields the LLM needs

## Commands

```
npm run dev          # start with tsx (auto-reload)
npm run build        # production build (tsup → dist/)
npm run start        # run production build
npm run typecheck    # tsc --noEmit
npm run test:client  # interactive MCP client against local server
```

## Key Conventions

- Stateless HTTP: new McpServer + transport per request. No session state.
- ASD client methods map 1:1 to ASD API endpoints. Types in `asd-client/types.ts` mirror API response shapes.
- Enum values in Zod schemas must exactly match ASD API values.
- Error messages include HTTP status and endpoint for debugging.
- Console output in stdio mode goes to stderr (stdout is reserved for JSON-RPC).
