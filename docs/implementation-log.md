# Implementation Log

---

## Milestone 4A — Consistent Error Shapes & MCP Error Codes

**What changed:** Created `src/tools/errors.ts` with a shared `formatToolError` utility. Refactored all 8 tool catch blocks to use it. Removed all `throw err` fallthroughs — no tool handler can crash the MCP transport anymore.

**Key decisions:**
- 401 handling is global inside `formatToolError` rather than per-tool `statusMessages` — expired JWT is a cross-cutting concern that every tool surfaces the same way.
- Network errors (`TypeError` with "fetch failed" / "ECONNREFUSED") get a distinct "ASD API is unreachable" message, separate from HTTP-level errors, so operators know immediately whether the problem is connectivity vs. a bad response.
- Unexpected errors (anything that's not `AsdApiError` or a network error) return "Internal error in {tool}: {message}" instead of crashing — keeps the MCP connection alive for subsequent calls.
- All `AsdApiError` imports were removed from tool files; tools only import `formatToolError`. This enforces the boundary: tools never inspect error internals directly.

**Key files:** `src/tools/errors.ts` (new), all 8 files in `src/tools/`

**Gotchas:**
- Tests failed initially because port 3001 was held by a leftover process from a previous dev session. `taskkill /PID` freed it; tests passed 18/18 unit + 4 workflow scenarios.

---

## Milestone 3E — Full Workflow Verification

**What changed:** Added Workflow Scenarios A–D to `tests/client-test.ts` — four end-to-end chains that exercise all seven tools together rather than in isolation.

**Key decisions:**
- Scenario A picks a ticket that wasn't used in earlier unit tests (filters out `firstTicketId`) so it starts in a clean `open` state. This avoids backend 500s caused by operating on tickets that have already been fully processed.
- Scenario B verifies append-only draft behaviour by generating two drafts on the same ticket, rejecting the first, and confirming the second has a different ID.
- Scenario C combines `search_knowledge` + `search_tickets` (billing) + `generate_draft` to exercise the knowledge-retrieval path end-to-end.
- Scenario D is a printed summary of which unit tests (5, 10, 12, 14, 17, 18) cover each error category, plus a note that expired-JWT testing requires a manual server restart.

**Key files:** `tests/client-test.ts`

**Gotchas:**
- `generate_draft` took 21s in Scenario A — the 8s performance target in the plan is aspirational; the ASD backend's OpenAI call is highly variable. The MCP layer handled it without timing out.
- `update_ticket` returned 500 in the unit test (Test 16) but succeeded in Scenario A — the 500 was specific to a ticket that had already been approved and transitioned to `pending_customer`. Fresh open tickets accept PATCH correctly.
- `evidence_chunks_cited` remains 0 across all scenarios — the ASD backend embeds citation IDs in the body string rather than the `evidence_chunk_ids` field. This is a backend data quality issue documented in 3B.

---

## Milestone 3D — `update_ticket` Tool

**What changed:** Implemented `src/tools/update-ticket.ts` with the `update_ticket` MCP tool. Registered it in `src/tools/index.ts`. Added Tests 16, 17, and 18 to `tests/client-test.ts`. Fixed a latent double-read bug in `AsdClient.request()` that was exposed for the first time by this tool.

**Key decisions:**
- Client-side validation rejects calls with no update fields before hitting the API, returning "At least one field to update must be provided." The PATCH endpoint would likely return a 422, but catching it early gives a clearer error and avoids a network round-trip.
- `fields_changed` is derived from which args were non-undefined before building the updates object, not from diffing the before/after ticket state. This is simpler and accurate — only the fields explicitly provided in the call are reported as changed.
- The `AsdClient.request()` error path was changed from `try { response.json() } catch { response.text() }` to `response.text()` then `JSON.parse()`. In Node.js undici, calling `.json()` marks the response body as "disturbed" even when it fails (e.g. non-JSON error body from Railway). The subsequent `.text()` call then throws "Body is unusable: Body has already been read" — a raw exception that bypasses `AsdApiError` handling entirely and surfaced as the cryptic undici error rather than a clean tool error. The fix reads the body once as text, then parses it in a regular try/catch.

**Key files:** `src/tools/update-ticket.ts`, `src/tools/index.ts`, `src/asd-client/index.ts`, `tests/client-test.ts`

**Gotchas:** The ASD backend returned 500 for the status update in Test 16. The ticket used had been through triage → draft → approval in earlier tests (now `pending_customer`), and the backend appears to reject transitioning it back to `in_progress`. This is a backend business-logic constraint, not a client bug. The error is now surfaced cleanly thanks to the double-read fix.

---

## Milestone 3C — `review_draft` Tool

**What changed:** Implemented `src/tools/review-draft.ts` with the `review_draft` MCP tool. Registered it in `src/tools/index.ts`. Added Tests 13, 14, and 15 to `tests/client-test.ts`. Added `queueDraftId` extraction from Test 8's result to make the draft ID available across review tests.

**Key decisions:**
- Client-side validation for `edited_and_approved` without `edited_body` runs before any API call. This gives a clear, specific error message rather than relying on the ASD API to catch it with a potentially opaque 400 response.
- Action-specific result messages are defined in a `RESULT_MESSAGES` lookup map rather than a switch statement — readable and easy to extend if new actions are added.
- 409 Conflict is handled explicitly for the already-reviewed case, though the ASD API turned out to be idempotent (Test 15 returned success on a second approve rather than 409). The handler is correct defensively and won't cause issues.

**Key files:** `src/tools/review-draft.ts`, `src/tools/index.ts`, `tests/client-test.ts`

**Gotchas:** The ASD API does not enforce review uniqueness — submitting the same approval twice returns success rather than a conflict error. The 409 handler is correct but won't fire against the current backend.

---

## Milestone 3B — `generate_draft` Tool

**What changed:** Implemented `src/tools/generate-draft.ts` with the `generate_draft` MCP tool. Registered it in `src/tools/index.ts`. Added Tests 11 and 12 to `tests/client-test.ts`.

**Key decisions:**
- `approval_status` in the output is mapped from `approval_outcome` in the `DraftResult` type — the plan spec used the friendlier name; the API field is `approval_outcome`. Renamed at the serialisation boundary so the LLM-facing name matches the tool descriptions.
- `evidence_chunks_cited` is a count derived from `result.evidence_chunk_ids.length`, consistent with the plan spec and the `get_ticket` tool. The ASD backend appears to embed citation IDs inside the body string rather than populating `evidence_chunk_ids` — count returns 0 as a result, but this is a backend data quality issue, not a client bug.
- `next_steps` field explicitly directs the LLM to `review_draft` — same pattern as `triage_ticket`'s `note` field, preventing the LLM from treating draft generation as a terminal action.

**Key files:** `src/tools/generate-draft.ts`, `src/tools/index.ts`, `tests/client-test.ts`

**Gotchas:** Server must be restarted after adding a new tool — `tsx` auto-reloads source files but a running server won't pick up new tool registrations until it restarts. First test run returned "Tool generate_draft not found" for this reason.

---

## Milestone 3A — `triage_ticket` Tool

**What changed:** Implemented `src/tools/triage-ticket.ts` with the `triage_ticket` MCP tool. Registered it in `src/tools/index.ts`. Added Tests 9 and 10 to `tests/client-test.ts`.

**Key decisions:**
- 504 (gateway timeout) handled as a distinct case — surfaces as "Triage timed out — the AI backend may be under load. Try again." rather than a generic error, since AI pipeline timeouts are expected and actionable.
- 403 gets a specific message ("Triage requires agent or lead role") rather than the raw ASD detail string, matching the plan spec.
- The `note` field in the response explicitly tells the LLM that triage is append-only and `update_ticket` is needed to apply the classification — prevents the LLM from assuming triage automatically mutates the ticket.
- `latency_ms` is surfaced directly from the `TriageResult` type (already in `asd-client/types.ts` from milestone 1B).
- Test 9 calls triage twice on the same ticket to confirm append-only behaviour (both calls succeed, second returns a new prediction).

**Key files:** `src/tools/triage-ticket.ts`, `src/tools/index.ts`, `tests/client-test.ts`

**Gotchas:** None.

---

## Milestone 2D — Read-Only Tools Verification

**What changed:** No code changes — this was a manual verification pass against the live ASD API.

**Key decisions:**
- All three test scenarios from the plan were executed via `npm run test:client` against a live server instance.
- Verification confirmed the investigation workflow (search → get_ticket → search_knowledge) and review queue workflow (get_review_queue → get_ticket) both return real ASD data.
- Error handling confirmed: non-existent UUID → clean `isError: true` with "Ticket not found"; empty query → Zod validation error before hitting the API.

**Key files:** `tests/client-test.ts` (no changes needed — all 8 tests already covered the verification criteria)

**Gotchas:** None — all 4 tools passed on the first run.

---

## Milestone 2C — `get_review_queue` Tool

**What changed:** Implemented `src/tools/get-review-queue.ts` with the `get_review_queue` MCP tool. Registered it in `src/tools/index.ts`. Added Test 8 to `tests/client-test.ts`.

**Key decisions:**
- Draft body truncated to 200 chars for the preview using `slice(0, 200) + '…'` — the full body is available via `get_ticket`. The API field is `body`; the output field is `draft_preview` to make the truncation semantically obvious.
- API field `draft_generation_id` mapped to `draft_id` in output — cleaner for LLM consumption.
- Test 8 guards against `isError` before `JSON.parse` — avoids a crash if the JWT lacks agent/lead role and the ASD API returns 403.
- The ASD client method `getReviewQueue` was already implemented in 1B (all client methods were scaffolded upfront), so no client changes were needed.

**Key files:** `src/tools/get-review-queue.ts`, `src/tools/index.ts`, `tests/client-test.ts`

**Gotchas:** After adding the new tool, the running server must be restarted — `tsx` auto-reloads on file save but the test client was connecting to an already-running instance without the new tool registered, causing "Tool get_review_queue not found".

---

## Milestone 2B — `search_knowledge` Tool

**What changed:** Implemented `src/tools/search-knowledge.ts` with the `search_knowledge` MCP tool. Registered it in `src/tools/index.ts`. Added Tests 6 and 7 to `tests/client-test.ts`.

**Key decisions:**
- Content is NOT truncated — the spec explicitly requires full chunk text so the LLM can use it as evidence when drafting responses.
- `top_k` is optional (1–20, int) with no default in the Zod schema — the API default of 5 is applied server-side.
- `AsdApiError` caught generically (no special 404 case needed — the endpoint always returns a list, never 404s on a missing entity).
- Test 7 confirms Zod `.min(1)` catches empty queries before they reach the API, surfacing as `isError: true` with a clear validation message.

**Key files:** `src/tools/search-knowledge.ts`, `src/tools/index.ts`, `tests/client-test.ts`

**Gotchas:** The knowledge base in the dev environment contains test/placeholder documents (e.g. a "Test" doc with UI design notes), so similarity scores for "billing refund" are low (~0.10). The plumbing is correct — this is a data quality issue in the seed data, not a code issue.

---

## Milestone 2A — `get_ticket` Tool

**What changed:** Implemented `src/tools/get-ticket.ts` with the `get_ticket` MCP tool. Registered it in `src/tools/index.ts`. Added Tests 4 and 5 to `tests/client-test.ts`. Added `npm test` script using `concurrently` + `wait-on` to auto-start the server, wait for `/health`, run the test client, then kill both processes.

**Key decisions:**
- Draft body truncated to 500 chars in the summary (plan spec); full body available via the same endpoint.
- 404 errors surface as `"Ticket not found: {ticket_id}"` rather than the generic AsdApiError message — more actionable for the LLM.
- `evidence_chunks` exposes the count of `evidence_chunk_ids` (not the IDs themselves) — the IDs aren't useful to the LLM at summary time.
- `npm test` uses `wait-on http://127.0.0.1:3001/health` rather than a fixed sleep — reliable and zero added friction.

**Key files:** `src/tools/get-ticket.ts`, `src/tools/index.ts`, `tests/client-test.ts`, `package.json`

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

## Milestone 1A — Project Scaffold

**What changed:** Created the full project skeleton — `package.json`, `tsconfig.json`, `.gitignore`, `.env.example`, `LICENSE`, `README.md`, placeholder `src/` files (`index.ts`, `server.ts`, `transport.ts`, `config.ts`, `asd-client/index.ts`, `asd-client/types.ts`, `tools/index.ts`), and `tests/client-test.ts`. Installed all npm dependencies.

**Key decisions:**
- `@modelcontextprotocol/express` does not exist on npm — removed from `package.json`. DNS rebinding protection will be handled directly in Express middleware when the HTTP transport is implemented in 1C.
- Used `moduleResolution: "bundler"` in tsconfig to support ESM `.js` extension imports alongside `tsup`.

**Key files:** `package.json`, `tsconfig.json`, `src/config.ts`, `src/index.ts`

**Gotchas:** The implementation plan referenced `@modelcontextprotocol/express` but this package is not published. The MCP SDK's `StreamableHTTPServerTransport` is used directly with Express.
