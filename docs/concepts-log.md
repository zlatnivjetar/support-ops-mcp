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

---

## Milestone 1C & 1D: MCP Server, Transport, and First Tool

### What we built and why

1C wired the MCP protocol layer to two delivery mechanisms — HTTP and stdio — so the same server logic works whether it's running as a remote endpoint or spawned as a child process by a local AI client. 1D registered the first real tool (`search_tickets`), establishing the pattern every subsequent tool follows: a Zod input schema, a call to the ASD client, and a structured JSON response. Together these two milestones turn the project from a typed HTTP client into an actual MCP server that an LLM can talk to.

---

### Key concepts under the hood

**The McpServer / transport split.** The MCP SDK separates two concerns: the protocol handler (which knows about tools, resources, and JSON-RPC messages) and the transport (which knows how bytes move between server and client). `McpServer` handles the former; `StreamableHTTPServerTransport` or `StdioServerTransport` handles the latter. This split matters because the same `createServer()` logic runs identically in both modes — only the transport changes. If protocol logic were entangled with transport logic, you'd have to maintain two diverging server implementations and keep them in sync.

**Stateless HTTP: new server instance per request.** In the HTTP mode, a brand new `McpServer` and `StreamableHTTPServerTransport` are created for every incoming POST to `/mcp`, then discarded after the response. There is no session store, no in-memory state shared between requests. This is a deliberate tradeoff: stateless servers are trivially horizontally scalable and require no sticky routing, but it means any state that needs to persist between tool calls must live in the client (the LLM's conversation context) or in the backend (the ASD API). If you accidentally stored mutable state on the server instance expecting it to survive to the next request, it would silently disappear.

**Zod schemas as the LLM's contract.** The input schema on each tool is not just validation — it is the machine-readable description the MCP client uses to know what arguments to send. Every `.describe()` call on a field becomes the natural-language hint the LLM reads when deciding how to call the tool. Enum constraints (`z.enum([...])`) ensure the LLM can only send values the ASD API accepts; without them, the LLM might hallucinate a plausible-sounding but invalid value (e.g. `"urgent"` instead of `"critical"`), which would reach the API and fail. Getting these schemas right is effectively writing the interface documentation that the LLM will act on.

---

### How these pieces connect

`createServer()` from 1C is the assembly point for everything: it takes the config, builds an `AsdClient`, registers all tools, and returns a ready `McpServer` — the transports in `transport.ts` just call it and plug in the delivery mechanism. The `registerAllTools` barrel in `src/tools/index.ts` is the single place where new tools are added as subsequent milestones land; if a tool is implemented but not imported here, it silently won't appear in the server's tool manifest. The error handling pattern established in `search_tickets` — catch `AsdApiError`, return `isError: true`, re-throw anything unexpected — must be followed by every future tool or a bad API response will crash the MCP connection instead of returning a graceful error to the LLM.

---

## Milestone 1E: End-to-End Verification

### What we built and why

1E proved the full stack works — MCP client connects, discovers tools, calls them, and gets real data back from the ASD API. It also surfaced and fixed a fundamental architectural mismatch in the HTTP transport: the originally planned stateless pattern is incompatible with how the MCP client SDK actually works, requiring a switch to session-based transport. Without this milestone, the architecture would have looked correct on paper but failed at runtime.

---

### Key concepts under the hood

**MCP protocol lifecycle and why stateless doesn't work.** The MCP protocol requires a handshake — the client sends `initialize`, the server responds with its capabilities, and only then can the client call tools. In stateless HTTP mode (new server per POST), the `initialize` request lands on one server instance, but the very next request (`tools/list`) lands on a fresh instance that has never been initialized — so it correctly returns "Method not found." The fix is session-based mode: the server generates a session ID during `initialize`, stores the live server instance in a map, and all subsequent requests with that session ID are routed to the same instance. Without this session affinity, the MCP protocol's state machine and the HTTP server's instance lifecycle are fundamentally at odds.

**Session lifecycle management: store on init, clean up on close.** Keeping server instances in an in-memory map introduces a resource leak risk if sessions are never removed. The transport fires an `onsessioninitialized` callback when the session ID is assigned (during `initialize`), and an `onclose` callback when the client disconnects or times out. The store-on-init / delete-on-close pattern means the map stays bounded to active sessions. If the cleanup were missing, every client connection would add a permanent entry — a slow memory leak that would only manifest under load.

**Long-lived JWTs for server-to-server integrations.** Browser-based auth flows issue short-lived tokens (the ASD frontend hardcodes 1h) because they're designed for interactive users who can re-authenticate. A server-to-server integration that can't prompt a user needs a token that outlasts a deploy cycle. The ASD seed script (`mint_tokens.py`) signs tokens directly with the shared secret, bypassing the web route entirely, allowing arbitrary expiry. The tradeoff is that this token can't be revoked without rotating the secret — acceptable for a dev/demo environment, but worth noting for production.

---

### How these pieces connect

1E is the validation gate for everything in Milestone 1: if the transport, server, tool registration, ASD client, and config all work together correctly, the test passes. The session-based transport fix made here is permanent infrastructure — all future tools (Milestones 2 and 3) rely on the same session routing. If the session map were ever accidentally cleared or the `onsessioninitialized` callback missed, every tool call after `initialize` would silently fail with the same `-32601` error.

---

## Milestone 2A: `get_ticket` Tool

`get_ticket` fetches the full detail record for a single ticket — conversation thread, latest AI prediction, and latest draft — and is the natural second step in the support workflow after `search_tickets` narrows down which ticket to inspect.

**Key decisions:**

- **Status-specific 404 messages.** When the ASD API returns a 404, the handler returns `"Ticket not found: {ticket_id}"` rather than the generic `AsdApiError` message. A generic error says the request failed; a specific one tells the LLM exactly what went wrong and what to do differently (try a different ID, or confirm the ticket exists first). Every other HTTP error still surfaces the raw detail and status code for debuggability.

- **Selective field projection in the output.** The raw `TicketDetail` response includes fields like `assignee_id`, `sender_id`, and the full `evidence_chunk_ids` array that add noise without helping an LLM decide what action to take. The handler maps the response to only what matters: human-readable names, the message thread, prediction scores, and a draft preview. The one non-obvious projection is `evidence_chunks` (a count) rather than `evidence_chunk_ids` (the array) — the IDs reference internal knowledge chunks the LLM can't dereference without a separate tool call.

- **Automated test orchestration with `wait-on`.** Rather than requiring a developer to manually start the server before running tests, `npm test` uses `concurrently` to start the server alongside a `wait-on` process that polls `/health` every 250ms. Once the health check returns 200, the test client runs — no fixed sleeps, no race conditions. The `-k -s first` flags tell `concurrently` to kill both processes as soon as the test client exits, so the server doesn't linger. This pattern scales cleanly to CI: any environment that can run `npm test` gets the same reliable test run without extra setup steps.
