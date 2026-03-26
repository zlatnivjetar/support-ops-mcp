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
