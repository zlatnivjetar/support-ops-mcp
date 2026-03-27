# Concepts Log

---

## Milestone 4D: Hardening Verification

Milestone 4D is a verification-only pass confirming that the three hardening changes from 4A–4C behave correctly end-to-end: consistent error shapes, timeout handling, and structured logging all work together under real failure conditions.

**Key decisions:**

- **Targeted verifier script over running the full test suite with env overrides.** The existing test client was written for the happy path and crashed on `JSON.parse` whenever a tool returned an error response — making it unsuitable for scenarios where every call is expected to fail. A 20-line verifier (`verify-hardening.ts`) that calls one tool and reports `isError`/message gives a precise signal without noise. The full test client's unsafe parses were also fixed as a side effect, making it robust for future error-condition runs.

- **Node.js runner script for cross-platform env overrides.** The standard Unix pattern of `VAR=value command` doesn't work on Windows because concurrently (and other Node.js tools) spawn child processes via `cmd.exe`, which doesn't support inline env var syntax. A small `.mjs` runner that reads `.env`, merges overrides in JavaScript, and spawns the server with the combined env object works identically on all platforms and makes the override mechanism explicit rather than relying on shell behaviour.

- **Port ownership must be verified between successive server spawns.** When running two back-to-back server instances with different configs, killing a child process via `child.kill()` on Windows doesn't synchronously free the port — the process lingers briefly while TCP sockets drain. The second spawn finds the port already bound, fails silently (health endpoint still responds from the old server), and the verifier hits the wrong server. The fix is to confirm port 3001 is free before each spawn, not just to call `kill()` and immediately proceed.

---

## Milestone 4C: Request Logging

Milestone 4C adds structured JSON-line logging to stderr across the entire request path — from server startup through session lifecycle events to individual ASD API calls with timing — giving operators visibility into what the server is doing without touching any tool logic.

**Key decisions:**

- **Zero-dependency logger over a library.** A single `process.stderr.write(JSON.stringify(entry) + '\n')` call is sufficient for a single-purpose server. Pulling in `pino` or `winston` would add transitive dependencies, configuration surface, and version pinning concerns for a use case that needs exactly one output format. The tradeoff is no log rotation, levels filtering, or pretty-printing — acceptable for a server that is expected to be run behind a process supervisor that captures stderr.

- **`AsdApiError` excluded from the catch-branch log to avoid double entries.** The `request()` method logs a `warn` entry before throwing `AsdApiError`, then re-throws into a `catch` block that logs failures. If `AsdApiError` weren't excluded from that catch branch, every API error would produce two log lines — one `warn` with the status code and one `error` without it — making log parsing ambiguous. Only truly unexpected errors (network failures, timeouts, `DOMException`) reach the `error` branch.

- **All log output goes to stderr, enforced by the logger's design.** In stdio mode stdout carries the JSON-RPC stream — any non-protocol bytes written there corrupt the connection. Previously `transport.ts` used `console.log` for the HTTP startup message (stdout) and `console.error` for the stdio message (stderr), relying on the caller to pick the right one. Routing everything through `log()`, which always calls `process.stderr.write`, makes the invariant impossible to violate accidentally when adding future log calls.

---

## Milestone 4B: Fetch Timeout & Graceful Degradation

Milestone 4B adds a time-bounded fetch to every ASD API call by passing `AbortSignal.timeout()` to Node's native `fetch`, and wires the resulting `DOMException` through the shared error formatter so timeouts surface as clean `isError` responses rather than unhandled exceptions.

**Key decisions:**

- **`AbortSignal.timeout()` over a manual `AbortController` + `setTimeout`.** Node 20's built-in `AbortSignal.timeout(ms)` creates a self-cancelling signal in one call — no timer handle to clear, no `finally` block needed. A manual controller requires pairing every `setTimeout` with a `clearTimeout` on success, which is easy to miss. Both approaches throw the same `DOMException`, but the built-in is the idiomatic Node 20 pattern and removes a whole class of timer-leak bugs.

- **Per-endpoint timeout override for AI pipeline calls.** A single global timeout would have to be large enough for `generateDraft` (observed ~21s) while still being low enough to fail before Railway's 60s gateway kills the connection. Setting the global default to 30s and giving `triageTicket`/`generateDraft` an explicit 55s override lets each endpoint be bounded tightly to its actual behaviour — fast reads fail fast, slow AI calls get the headroom they need. The 55s ceiling matters: if the override exceeded Railway's 60s gateway timeout, the gateway would terminate the connection with a 504 before the `AbortSignal` ever fired, meaning the server would never see the abort and the tool would crash instead of returning a clean error.

- **`TimeoutError` is a `DOMException`, not a `TypeError`.** Network errors (unreachable host) arrive as `TypeError` with "fetch failed". Timeout errors from `AbortSignal.timeout()` arrive as `DOMException { name: 'TimeoutError' }`. Conflating them would mean timeout messages showing up as "ASD API is unreachable" — accurate about the symptom but wrong about the cause, sending the operator to check `ASD_API_URL` when they should be investigating backend latency. The `formatToolError` branch order is therefore: `AsdApiError` → `TimeoutError` → `AbortError` → network `TypeError` → generic.

---

## Milestone 4A: Consistent Error Shapes & MCP Error Codes

Milestone 4A centralises all error formatting behind a single shared utility (`src/tools/errors.ts`), replacing eight divergent catch blocks with one consistent shape: structured `isError` responses that never re-throw, so no error can crash the MCP transport connection.

**Key decisions:**

- **Shared formatter over per-tool error logic.** Each tool previously duplicated its own `instanceof AsdApiError` check and `throw err` fallthrough. Centralising into `formatToolError` means error behaviour is consistent by construction — adding a new tool automatically gets network-error handling and 401 detection without any extra work. Per-tool `statusMessages` still allow customisation (404 messages with the specific ID, 504 messages specific to AI endpoints) while keeping the catch block a one-liner.

- **401 handled globally, not per tool.** An expired or invalid JWT will cause every single tool to fail, so the "check ASD_JWT environment variable" message lives in `formatToolError` before the `statusMessages` lookup, not in any individual tool. If it were in `statusMessages`, it would have to be repeated in eight places and could easily be omitted from a new tool — making the failure mode silent rather than actionable.

- **Network errors distinguished from HTTP errors.** A `TypeError` with "fetch failed" or "ECONNREFUSED" means the ASD backend wasn't reached at all — the response the `AsdApiError` path assumes never arrived. Treating it the same as an HTTP error would be misleading ("Error in search_tickets: ..."). The separate "ASD API is unreachable" message tells the operator immediately whether to look at the backend URL or at the API response, which are very different debugging paths. This check must come after the `AsdApiError` branch, because `AsdApiError` is only thrown after a response arrives.

---

## Milestone 3E: Full Workflow Verification

Milestone 3E is the integration gate for all of Milestone 3 — it runs four end-to-end scenarios that chain all seven tools together in the sequences a real support agent would use, confirming that the tools compose correctly rather than just work in isolation.

**Key decisions:**

- **Test state isolation by picking fresh tickets.** The workflow scenarios avoid reusing tickets that unit tests have already put through the full pipeline, because those tickets end up in states (e.g. `pending_customer` after approval) that cause the ASD backend to reject further status updates with a 500. Scenario A filters out the ticket used in unit tests and picks a clean `open` one. This surfaces an important backend constraint: ticket status transitions are not freely reversible — operating on a ticket that has already been approved and resolved will fail, even if the individual tool call is otherwise valid.

- **Append-only draft behaviour verified through Scenario B.** Generating a draft, rejecting it, then generating again produces two records with distinct IDs — the second call doesn't overwrite or reuse the first. This matters because the review workflow depends on draft IDs being stable and unique: if `generate_draft` were idempotent and returned the same ID on retry, a rejection followed by a redraft would still point to the rejected record, making `review_draft` operate on stale data.

- **Performance targets are aspirational, not hard limits at the MCP layer.** The plan specifies `generate_draft` should complete in under 8 seconds, but Scenario A saw 21 seconds. The MCP protocol itself has no built-in timeout — the connection stays open as long as the underlying transport is alive, so a slow AI backend call doesn't break the protocol. The constraint that matters is Railway's server-side request timeout (which would surface as a 504, already handled in the tool). The 8s target is a user-experience guideline, not an enforced boundary.

---

## Milestone 3D: `update_ticket` Tool

`update_ticket` is the patch-fields tool — it sends a PATCH with any combination of status, priority, category, team, or assignee and returns a snapshot of the updated ticket. It's the tool an agent uses to apply triage predictions or manually adjust ticket properties after taking other actions.

**Key decisions:**

- **Fixing a latent double-read bug in the HTTP client's error path.** The original error handler called `response.json()` and, if that threw, called `response.text()` in the catch block. In Node.js's built-in fetch (undici), calling `.json()` marks the response body as "disturbed" the moment it starts — even if JSON parsing ultimately fails. The subsequent `.text()` call finds the body already disturbed and throws "Body is unusable: Body has already been read," which is not an `AsdApiError`, bypasses the tool's error handler, and surfaces as a raw exception. The fix is to read the body once with `.text()` and then attempt `JSON.parse()` separately, keeping the body consumed exactly once regardless of whether the content is valid JSON. This bug was latent across all previous tools but only triggered when the ASD backend returned a non-JSON error body — which first happened here when PATCH got a 500 with a plain-text body.

- **Client-side validation for the no-op case.** The tool rejects calls where no update fields are provided before making any API call. A PATCH with an empty body would likely get a 422 from the server anyway, but catching it early returns a clearer, tool-specific message ("At least one field to update must be provided") and avoids a wasted network round-trip. This is the same principle as `review_draft`'s `edited_and_approved` check: validate at the tool boundary when the invalid case is structurally obvious from the inputs alone.

- **`fields_changed` derived from inputs, not from diffing before/after state.** The response includes a `fields_changed` array listing which fields were actually provided in the call. This is computed from which arguments were non-undefined before the API call, not by comparing the pre-update and post-update ticket state. Diffing would require a `get_ticket` call before every update (extra latency, extra complexity), and it would conflate "field was provided but unchanged" with "field was not provided" — a subtle distinction that matters when an LLM is deciding what actions have been taken. Reporting what was sent is accurate, cheap, and unambiguous.

---

## Milestone 3C: `review_draft` Tool

`review_draft` is the human-in-the-loop gate — it submits an approval decision (approve, edit-and-approve, reject, or escalate) on a pending AI draft, closing the loop between AI generation and actual customer reply. It's the only tool whose output directly changes what gets sent to a customer.

**Key decisions:**

- **Client-side validation before the API call.** The `edited_and_approved` action requires an `edited_body` — if that field is missing, the tool returns a structured error immediately without making a network request. Relying on the API to catch this would produce a generic 400 with an opaque message; catching it in the handler lets you return a precise, actionable error ("edited_body is required when action is edited_and_approved") at zero cost. This pattern is worth applying to any tool where a missing combination of optional fields makes a request semantically invalid.

- **Action-specific result messages over a single generic confirmation.** Each of the four actions produces a different outcome in the ASD backend — approved drafts update the ticket status, rejections leave it open, escalations flag it for a different queue. Rather than returning the raw API response (which doesn't describe what happened in plain terms), the tool maps each action to a human-readable result string. This gives the LLM enough context to decide what to do next without reading the ASD documentation.

- **Defensive 409 handling for idempotent backends.** The tool includes a specific handler for HTTP 409 Conflict, which would fire if the API enforced that a draft can only be reviewed once. In practice, the ASD backend accepted a second approval on the same draft without error — it treats review submissions as idempotent rather than enforcing uniqueness. The 409 handler is correct and harmless, but it won't trigger against the current backend; if the API ever tightens this constraint, the error message is already in place.

---

## Milestone 3B: `generate_draft` Tool

`generate_draft` triggers the RAG-grounded draft generation pipeline — the ASD backend retrieves relevant knowledge base chunks, then uses them as evidence to write a reply — and is the most computationally expensive tool in the server, sitting between triage (classification) and review (human approval) in the support workflow.

**Key decisions:**

- **`next_steps` as explicit workflow guidance.** The response includes a `next_steps` field telling the LLM to use `review_draft` next. Without it, the LLM has no signal that draft generation is a non-terminal action — it might surface the draft to the user as if it were already sent, or stall waiting for further instructions. This is the same pattern as `triage_ticket`'s `note` field: both tools create records that require a subsequent action to take effect, so both responses name that action explicitly.

- **Field renaming at the serialisation boundary.** The API returns `approval_outcome`; the tool exposes it as `approval_status`. The rename happens only in the JSON the tool returns — the underlying `DraftResult` type and client method are untouched. This matters because the LLM reads field names as semantic labels: "approval_outcome" implies a past event, while "approval_status" implies a current state to act on. Renaming at the boundary keeps the API contract stable while making the LLM-facing vocabulary match the tool's description.

- **`evidence_chunks_cited` as a count, not a list.** The raw API response includes `evidence_chunk_ids` — an array of UUIDs referencing the knowledge chunks the AI cited. The tool exposes only the count. Chunk IDs are internal identifiers the LLM can't dereference without a separate lookup; a count gives the LLM a useful signal (did the AI have supporting material?) without cluttering the response with opaque strings. The current ASD backend packs citation data into the body string rather than the `evidence_chunk_ids` array, so the count reads as 0 — a backend data quality issue, not a client bug.

---

## Milestone 3A: `triage_ticket` Tool

`triage_ticket` is the first action tool — it fires the ASD AI classification pipeline on a specific ticket and returns a prediction record containing category, priority, team, escalation recommendation, and confidence score. It marks the transition from read-only tools to tools that create persistent state in the backend.

**Key decisions:**

- **Triage is append-only, and the `note` field communicates this to the LLM.** Calling `triage_ticket` does not change the ticket — it creates a new prediction record in a separate table. An LLM that doesn't understand this distinction might assume the ticket is now classified and skip calling `update_ticket`, leaving the ticket fields unchanged in the ASD database. The `note` field in every response explicitly says: "Prediction stored separately from ticket. Use update_ticket to apply these values." This turns a silent architectural fact into actionable guidance surfaced at exactly the right moment.

- **Status-specific error messages for the failure modes that matter.** Three error codes get distinct treatment: 404 ("Ticket not found"), 403 ("Triage requires agent or lead role"), and 504 ("Triage timed out — the AI backend may be under load. Try again."). The 504 case is the most important — it is not a programming error or a bad request, it's an expected failure mode when the OpenAI call inside the ASD pipeline takes too long. A generic "HTTP 504" message tells the LLM nothing useful; a message that names the cause and suggests retrying gives it a recovery path.

- **`latency_ms` is surfaced from the API response, not measured client-side.** The ASD API includes a `latency_ms` field on the `TriageResult` type that measures how long the internal AI call took, and the tool passes it through directly. This is more accurate than wrapping the whole `client.triageTicket()` call in a `Date.now()` delta — client-side timing includes network overhead and serialisation, whereas the API's figure isolates the AI pipeline duration. Surfacing it lets a downstream agent (or a human reading logs) distinguish a slow AI call from a slow network.

---

## Milestone 2D: Read-Only Tools Verification

Milestone 2D was a verification pass — no new code was written. It confirmed that all four read-only tools (`search_tickets`, `get_ticket`, `search_knowledge`, `get_review_queue`) work correctly end-to-end against the live ASD API before moving on to the action tools in Milestone 3.

**Key decisions:**

- **Verify the full workflow, not just individual tools.** The test plan chains tools together in the order an agent would actually use them — `search_tickets` to find a ticket, `get_ticket` to read its detail, `search_knowledge` to retrieve supporting material. Running each tool in isolation would miss integration issues; running them as a workflow catches cases where one tool's output format doesn't match another tool's expected input (e.g. the ticket ID field name in the search response must match what `get_ticket` accepts as `ticket_id`).

- **Error cases are first-class test targets.** Three negative cases were verified alongside the happy paths: a non-existent UUID, an empty query string, and a role-gated 403. Testing only the success path leaves a gap — if error handling is broken, the LLM will receive a crash or raw exception text instead of a structured `isError` response, which it can't act on gracefully. Verifying error shape at this stage means the error contract is confirmed before action tools build on top of it.

- **No code changes signals the milestone was built correctly the first time.** A verification milestone that requires fixes is a sign that the preceding implementation milestone was incomplete. The fact that 2D required zero changes confirms that the tool pattern established in 1D — Zod validation → ASD client call → structured JSON response → `isError` on API error — was applied consistently across all four tools. This matters because Milestone 3 introduces mutation tools where errors have real consequences; knowing the error handling pattern is solid reduces risk.

---

## Milestone 2C: `get_review_queue` Tool

`get_review_queue` lists AI-generated draft responses that are waiting for a human agent to approve, reject, or escalate — it exposes the FIFO review queue so an LLM agent can surface the oldest unreviewed drafts and hand them off to `review_draft` for a decision.

**Key decisions:**

- **Preview truncation at the tool layer, not the API layer.** The ASD API returns the full draft body in every queue item. The tool truncates it to 200 characters before sending it to the LLM. This is deliberate: the queue is for triage, not reading — the LLM needs enough text to identify what the draft is about, not the full response. If the LLM actually needs to read the draft in full (e.g. to approve it with edits), it calls `get_ticket`, which returns the complete body. The 200-char limit also keeps queue responses compact when there are many pending drafts.

- **Field renaming to match the LLM's mental model.** The API returns `draft_generation_id` — an internal identifier that names the database table it came from. The tool exposes it as `draft_id`, which is what an agent would naturally say when talking about "the draft to review." Similarly, the raw `body` field becomes `draft_preview` to signal upfront that the content is truncated. Renaming at the serialisation boundary keeps the LLM-facing vocabulary consistent with how the tools describe themselves without changing the underlying API contract.

- **Defensive `isError` check before `JSON.parse` in the test client.** The review queue endpoint requires agent or lead role — a JWT with only basic user permissions gets a 403, which the tool surfaces as `isError: true` with a plain text message instead of JSON. The test added in this milestone checks `result.isError` before attempting `JSON.parse` so the test client exits cleanly rather than crashing with a syntax error. This pattern applies to any tool that may legitimately return a role-gated error: always branch on `isError` before assuming the response body is structured data.

---

## Milestone 2B: `search_knowledge` Tool

`search_knowledge` performs semantic search over the support knowledge base and returns ranked document chunks — it's the retrieval half of the RAG pipeline that `generate_draft` uses internally, now exposed directly so an LLM agent can inspect source material before or after drafting a response.

**Key decisions:**

- **No content truncation.** Every other tool in this server trims or summarises long text fields to reduce noise (e.g. `get_ticket` caps the draft body at 500 chars). `search_knowledge` deliberately does not truncate chunk content. A knowledge chunk only has value if the LLM can read it in full — a truncated passage that cuts off mid-sentence before the relevant policy wording is worse than no result at all. The cost is slightly larger responses, but that's the right tradeoff for a retrieval tool.

- **Return type is a flat list, not paginated.** The `/knowledge/search` endpoint returns a plain JSON array rather than the `PaginatedResponse<T>` wrapper used by ticket endpoints. This reflects what the endpoint actually does — it returns the top-K results by similarity score in a single shot; there's no concept of "page 2 of semantic search results." The `KnowledgeSearchResult[]` type in `types.ts` captures this accurately. If the type had been force-fit into the paginated wrapper, the handler would have needed to unwrap `.items` from a field that doesn't exist.

- **Zod `.min(1)` as the first line of defence.** An empty query string sent to a vector search endpoint is technically valid but semantically meaningless — it would consume API quota and return noise. The `.min(1)` constraint on the `query` field rejects the call before it leaves the server, returning a structured MCP validation error rather than a confusing near-zero-similarity result set. This is the same principle as enum constraints on ticket filters: the schema is the contract that prevents the LLM from making calls that can't succeed.

---

## Milestone 2A: `get_ticket` Tool

`get_ticket` fetches the full detail record for a single ticket — conversation thread, latest AI prediction, and latest draft — and is the natural second step in the support workflow after `search_tickets` narrows down which ticket to inspect.

**Key decisions:**

- **Status-specific 404 messages.** When the ASD API returns a 404, the handler returns `"Ticket not found: {ticket_id}"` rather than the generic `AsdApiError` message. A generic error says the request failed; a specific one tells the LLM exactly what went wrong and what to do differently (try a different ID, or confirm the ticket exists first). Every other HTTP error still surfaces the raw detail and status code for debuggability.

- **Selective field projection in the output.** The raw `TicketDetail` response includes fields like `assignee_id`, `sender_id`, and the full `evidence_chunk_ids` array that add noise without helping an LLM decide what action to take. The handler maps the response to only what matters: human-readable names, the message thread, prediction scores, and a draft preview. The one non-obvious projection is `evidence_chunks` (a count) rather than `evidence_chunk_ids` (the array) — the IDs reference internal knowledge chunks the LLM can't dereference without a separate tool call.

- **Automated test orchestration with `wait-on`.** Rather than requiring a developer to manually start the server before running tests, `npm test` uses `concurrently` to start the server alongside a `wait-on` process that polls `/health` every 250ms. Once the health check returns 200, the test client runs — no fixed sleeps, no race conditions. The `-k -s first` flags tell `concurrently` to kill both processes as soon as the test client exits, so the server doesn't linger. This pattern scales cleanly to CI: any environment that can run `npm test` gets the same reliable test run without extra setup steps.

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
