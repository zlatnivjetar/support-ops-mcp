# Concepts Log

---

## Milestone 1B: ASD API Client

### What we built and why

The ASD client is the only place in the server that speaks HTTP to the Agent Service Desk backend. Everything above it (MCP tools) calls client methods and gets typed data back — they never construct URLs, set headers, or handle raw fetch responses. This matters because the MCP protocol layer and the HTTP transport layer have completely different concerns, and keeping them apart means each can change without touching the other.

---

### Key concepts under the hood

**Typed error classes as protocol boundaries.** A plain `Error` thrown from deep inside a fetch call carries only a message string — by the time it surfaces in an MCP tool handler, the HTTP status code and endpoint that caused the failure are gone. `AsdApiError` is a custom error subclass that preserves `status`, `detail`, and `endpoint` alongside the message. This means a tool handler can catch `AsdApiError` specifically, distinguish a 401 (bad JWT) from a 404 (ticket doesn't exist) from a 500 (backend down), and return a structured MCP error response with enough context for the user to act on it. Without this, every API failure would look identical from the tool's perspective.

**Strict layer separation (no MCP knowledge in the HTTP client).** The `AsdClient` class imports nothing from `@modelcontextprotocol/sdk` and knows nothing about tool responses, content blocks, or `isError` flags. It is a pure HTTP client that takes a config object, makes requests, and returns typed data or throws. This is not just tidiness — it means the client can be instantiated and called in any context (a test script, a CLI, a different server framework) without pulling in MCP infrastructure. If MCP concepts had leaked into the client, you'd need a full MCP environment just to make an API call.

**Optional parameter filtering in query strings.** When a function accepts ten optional filter parameters and the caller only provides two, the other eight are `undefined`. If you naively call `URLSearchParams.set(key, String(value))` on all of them, you get `?status=undefined&priority=undefined&...` — which the API either rejects or misinterprets as the literal string "undefined". The `buildQuery` helper only appends a parameter when its value is not `undefined`, not `null`, and not an empty string. This makes optional parameters genuinely optional rather than subtly broken.

---

### How these pieces connect

Everything built in 1A (the scaffold and config loader) feeds directly into `AsdClient` — the client takes a `Config` object and uses `asdApiUrl` and `asdJwt` on every request. In the next milestone (1C), `createServer()` in `server.ts` will instantiate `AsdClient` and pass it into each tool registration. If the client's method signatures or error types change after tools are written, every tool handler that calls those methods will need updating — so the shapes defined here are the contract the rest of the codebase depends on.
