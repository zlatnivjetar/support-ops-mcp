# Support Operations MCP Server — Implementation Plan (Part 2)

**Location:** `docs/implementation-plan-part2.md`
**Scope:** Milestones 4–6 (Hardening, Client Integration, README & Repo Polish)
**Prerequisite:** Part 1 (Milestones 1–3) is fully implemented and verified.

---

## Context from Part 1

All 8 tools are implemented and working against the live ASD API. The test client covers 18 unit tests and 4 workflow scenarios. The transport layer supports both session-based Streamable HTTP and stdio. Error handling exists but is inconsistent across tools — some have status-specific messages (404, 403, 504), others use a single generic catch. No request logging, no fetch timeouts, no graceful handling of network failures.

---

## Milestone 4 — Hardening

**Goal:** Make the server production-grade: consistent error shapes across all tools, fetch timeouts so slow AI endpoints can't hang the server, graceful degradation when the ASD backend is unreachable, request logging for observability, and a hardening verification pass.

---

### Milestone 4A: Consistent Error Shapes & MCP Error Codes

**What to do:**

Every tool currently catches `AsdApiError` in its own way. Some tools (e.g. `generate_draft`, `triage_ticket`) have status-specific messages for 404, 403, 504. Others (e.g. `search_tickets`) return a single generic message. Additionally, unexpected errors (non-`AsdApiError`) are re-thrown, which crashes the MCP connection instead of returning a structured error.

1. **Create `src/tools/errors.ts`** — a shared error-formatting utility:

```typescript
import { AsdApiError } from '../asd-client/index.js';

export interface ToolErrorOptions {
  /** Tool name for the error prefix (e.g. "search_tickets") */
  toolName: string;
  /** Custom messages by HTTP status code. Keys not listed fall through to the generic handler. */
  statusMessages?: Record<number, string>;
}

/**
 * Formats any error into a structured MCP tool error response.
 * - AsdApiError: uses statusMessages lookup, falls back to generic "Error: detail (HTTP status)"
 * - Network errors (TypeError with "fetch failed"): returns ASD-unreachable message
 * - All other errors: returns generic internal error message
 *
 * Never throws — always returns a valid MCP response.
 */
export function formatToolError(err: unknown, opts: ToolErrorOptions) {
  let message: string;

  if (err instanceof AsdApiError) {
    message = opts.statusMessages?.[err.status]
      ?? `Error in ${opts.toolName}: ${err.detail} (HTTP ${err.status})`;
  } else if (isNetworkError(err)) {
    message = `ASD API is unreachable — the backend may be down or the URL may be misconfigured. Check ASD_API_URL and try again.`;
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
```

2. **Refactor every tool's catch block** to use `formatToolError`:

   For tools that already have status-specific messages, pass them as `statusMessages`:
   ```typescript
   // generate_draft example:
   catch (err) {
     return formatToolError(err, {
       toolName: 'generate_draft',
       statusMessages: {
         404: `Ticket not found: ${args.ticket_id}`,
         403: 'Draft generation requires agent or lead role',
         504: 'Draft generation timed out — the AI backend may be under load. Try again.',
       },
     });
   }
   ```

   For tools that currently have only a generic catch (`search_tickets`, `search_knowledge`), pass just the `toolName`:
   ```typescript
   catch (err) {
     return formatToolError(err, { toolName: 'search_tickets' });
   }
   ```

3. **Remove the `throw err` fallthrough** from every tool handler. After this change, no tool handler ever throws — `formatToolError` handles everything, including unexpected errors. This prevents a single bad response from crashing the MCP transport.

4. **Add 401 handling to the shared utility.** Every tool should surface expired/invalid JWT as a clear message:
   ```typescript
   // In formatToolError, before the generic fallback:
   if (err.status === 401) {
     message = 'Authentication failed — the ASD JWT may be expired or invalid. Check the ASD_JWT environment variable.';
   }
   ```
   This is a global concern (applies to every tool), so it lives in the shared formatter rather than per-tool `statusMessages`.

**Files to touch:** `src/tools/errors.ts` (new), all 8 files in `src/tools/`, `src/tools/index.ts` (no change needed — barrel only imports register functions)

**Done when:**
- `npm run typecheck` passes
- Every tool handler's catch block uses `formatToolError` — no raw `throw err` remaining
- Network errors (ASD unreachable) return a structured `isError` response, not a crash
- 401 errors return a JWT-specific message from any tool

---

### Milestone 4B: Fetch Timeout & Graceful Degradation

**What to do:**

The `AsdClient.request()` method has no timeout. If the ASD backend hangs (especially `generate_draft` which calls OpenAI), the MCP server waits indefinitely. Node.js fetch supports `AbortSignal.timeout()` natively.

1. **Add a timeout to `AsdClient.request()`:**

```typescript
private async request<T>(
  method: string,
  path: string,
  body?: unknown,
  timeoutMs?: number,
): Promise<T> {
  const url = `${this.baseUrl}${path}`;
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${this.jwt}`,
    'Content-Type': 'application/json',
  };

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs ?? this.defaultTimeoutMs),
  });
  // ... rest of existing error handling
}
```

2. **Add `defaultTimeoutMs` to the `AsdClient` constructor**, sourced from config:

```typescript
// In src/config.ts — add to Config interface and loadConfig():
export interface Config {
  // ... existing fields
  requestTimeoutMs: number;  // default: 30_000
}

// In loadConfig():
requestTimeoutMs: parseInt(process.env.ASD_TIMEOUT_MS || '30000', 10),
```

   **30 seconds** is the default — high enough for `generate_draft` (observed 21s) with headroom, low enough to fail before Railway's 60s gateway timeout.

3. **Per-endpoint timeout overrides.** The `generateDraft` and `triageTicket` methods should pass a longer timeout (e.g. 55_000ms) since they call the AI pipeline:

```typescript
async generateDraft(ticketId: string): Promise<DraftResult> {
  return this.request('POST', `/tickets/${ticketId}/draft`, undefined, 55_000);
}

async triageTicket(ticketId: string): Promise<TriageResult> {
  return this.request('POST', `/tickets/${ticketId}/triage`, undefined, 55_000);
}
```

4. **Handle `AbortError` in `formatToolError`** (from 4A):

```typescript
// Add to formatToolError:
if (err instanceof DOMException && err.name === 'TimeoutError') {
  message = `${opts.toolName} timed out — the ASD backend took too long to respond. Try again.`;
}
// Also handle the older AbortError name:
if (err instanceof DOMException && err.name === 'AbortError') {
  message = `${opts.toolName} request was aborted.`;
}
```

5. **Add `.env.example` entry:**
```
# Optional — request timeout in milliseconds (default: 30000)
ASD_TIMEOUT_MS=30000
```

**Files to touch:** `src/asd-client/index.ts`, `src/config.ts`, `src/tools/errors.ts`, `.env.example`

**Done when:**
- `npm run typecheck` passes
- `AsdClient.request()` uses `AbortSignal.timeout()`
- AI pipeline endpoints (`triageTicket`, `generateDraft`) use a longer timeout than read-only endpoints
- Timeout errors produce a clean `isError` response (not a crash)
- `ASD_TIMEOUT_MS` is documented in `.env.example`

---

### Milestone 4C: Request Logging

**What to do:**

The server currently has no visibility into what's happening — no request logging, no timing, no error tracking. Add lightweight structured logging so that both HTTP and stdio transports produce observable output.

1. **Create `src/logger.ts`** — a minimal structured logger:

```typescript
/**
 * Lightweight structured logger.
 *
 * - Always writes to stderr (stdout is reserved for JSON-RPC in stdio mode)
 * - Logs as JSON lines for machine parseability
 * - Includes timestamp, level, and message
 */
export type LogLevel = 'info' | 'warn' | 'error';

export function log(level: LogLevel, message: string, data?: Record<string, unknown>) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...data,
  };
  process.stderr.write(JSON.stringify(entry) + '\n');
}
```

   No external logging library. The server is a single-purpose process — JSON lines to stderr is sufficient and keeps dependencies at zero.

2. **Log ASD API calls in `AsdClient.request()`:**

```typescript
import { log } from '../logger.js';

private async request<T>(/* ... */): Promise<T> {
  const start = performance.now();
  const endpoint = `${method} ${path}`;

  try {
    const response = await fetch(/* ... */);
    const durationMs = Math.round(performance.now() - start);

    if (!response.ok) {
      // ... existing error handling ...
      log('warn', 'ASD API error', { endpoint, status: response.status, durationMs });
      throw new AsdApiError(/* ... */);
    }

    log('info', 'ASD API call', { endpoint, status: response.status, durationMs });
    // ... rest of handler
  } catch (err) {
    if (!(err instanceof AsdApiError)) {
      const durationMs = Math.round(performance.now() - start);
      log('error', 'ASD API call failed', { endpoint, durationMs, error: String(err) });
    }
    throw err;
  }
}
```

3. **Log transport lifecycle events in `src/transport.ts`:**

```typescript
import { log } from './logger.js';

// In startHttpTransport:
log('info', 'HTTP transport starting', { port: config.port });

// In the session-initialized callback:
log('info', 'MCP session created', { sessionId: id });

// In the transport.onclose callback:
log('info', 'MCP session closed', { sessionId: transport.sessionId });

// In startStdioTransport:
log('info', 'stdio transport connected');
```

4. **Log server startup in `src/index.ts`:**

```typescript
import { log } from './logger.js';

log('info', 'Server starting', { transport: config.transport, port: config.port });
```

**Files to touch:** `src/logger.ts` (new), `src/asd-client/index.ts`, `src/transport.ts`, `src/index.ts`

**Done when:**
- `npm run typecheck` passes
- Every ASD API call logs endpoint, HTTP status, and duration to stderr
- Session create/close events are logged
- Server startup is logged with config summary
- All log output goes to stderr (verified by running in stdio mode — stdout stays clean)

---

### Milestone 4D: Hardening Verification

**What to do:**

Run the full test suite and manually verify the hardening changes work end-to-end. No new code — this is a verification pass like 2D.

1. **Run `npm test`** — all 18 unit tests and 4 workflow scenarios should still pass.

2. **Verify error consistency:** Scan test output to confirm error messages follow the new format:
   - 404 errors → tool-specific "not found" messages
   - Generic errors → "Error in {tool_name}: {detail} (HTTP {status})"
   - No raw exception messages in any test output

3. **Verify logging:** Check stderr during the test run for:
   - JSON-line log entries for every ASD API call
   - Timing data (`durationMs`) on every entry
   - Session lifecycle events (created, closed)

4. **Verify timeout behavior** (manual): Temporarily set `ASD_TIMEOUT_MS=1` in `.env`, start the server, and call any tool. Confirm:
   - The tool returns a clean timeout error message (not a crash)
   - The error is logged to stderr
   - Reset `ASD_TIMEOUT_MS` back to 30000 after testing.

5. **Verify graceful degradation** (manual): Temporarily set `ASD_API_URL=http://localhost:9999` (nothing listening), start the server, call any tool. Confirm:
   - The tool returns "ASD API is unreachable" (not a crash)
   - The error is logged to stderr
   - Reset `ASD_API_URL` back to the real value after testing.

**Files to touch:** None (verification only)

**Done when:**
- `npm test` passes — all existing tests green
- Error messages across all tools follow consistent formatting
- Stderr contains structured JSON logs for every API call
- Timeout and unreachable scenarios produce clean error responses

---

## Milestone 5 — Client Integration

**Goal:** Configure support-ops-mcp to work as an MCP server inside Claude Code and OpenAI Codex. Verify the tools are usable from each client. After this milestone, a user can clone the repo and start using the tools from their AI coding assistant.

---

### Milestone 5A: Claude Code Integration

**What to do:**

Claude Code supports MCP servers via its settings. The server needs to work in both stdio mode (spawned as a child process) and HTTP mode (running separately). Document both paths.

1. **Verify stdio transport works end-to-end.** Set `TRANSPORT=stdio` in `.env`, run `npm run dev`, and confirm:
   - Startup message goes to stderr (not stdout)
   - The process stays alive waiting for JSON-RPC on stdin
   - No errors on startup

2. **Create `.claude/mcp.json`** in the repo root — this is the Claude Code per-project MCP config:

```json
{
  "mcpServers": {
    "support-ops": {
      "type": "stdio",
      "command": "npx",
      "args": ["tsx", "src/index.ts"],
      "env": {
        "ASD_API_URL": "https://agent-service-desk-production.up.railway.app",
        "ASD_JWT": "",
        "TRANSPORT": "stdio"
      }
    }
  }
}
```

   **Notes:**
   - `ASD_JWT` is left empty — users must fill in their own token. Do NOT commit a real JWT.
   - `npx tsx` avoids requiring a global install of tsx.
   - `TRANSPORT=stdio` overrides the default HTTP mode.

3. **Add `.claude/` to `.gitignore`** — the MCP config contains user-specific secrets (JWT). Add a comment explaining why:

```gitignore
# Claude Code MCP config (contains user-specific JWT)
.claude/
```

4. **Create `.claude/mcp.json.example`** — a committed template users can copy:

```json
{
  "mcpServers": {
    "support-ops": {
      "type": "stdio",
      "command": "npx",
      "args": ["tsx", "src/index.ts"],
      "env": {
        "ASD_API_URL": "https://agent-service-desk-production.up.railway.app",
        "ASD_JWT": "YOUR_JWT_HERE",
        "TRANSPORT": "stdio"
      }
    }
  }
}
```

5. **Verify in Claude Code.** Open the project in Claude Code, confirm the MCP server appears in the tool list, and run a simple tool call (e.g. `search_tickets` with no filters). Confirm the response is structured JSON.

**Files to touch:** `.claude/mcp.json.example` (new), `.gitignore`

**Done when:**
- `.claude/mcp.json.example` exists with the correct stdio config
- `.claude/` is gitignored
- Claude Code discovers the server and can call tools (verified manually)
- stdio transport emits no output on stdout except JSON-RPC

---

### Milestone 5B: Codex Integration

**What to do:**

OpenAI Codex CLI supports MCP servers via a `codex.json` or similar config. The integration pattern is nearly identical to Claude Code — stdio transport, environment variables for auth.

1. **Research Codex MCP config format.** Check the Codex CLI documentation for the exact config file location and schema. It is likely one of:
   - `codex.json` in the project root
   - `.codex/config.json`
   - A section in `package.json`

   If the format is close to Claude Code's (command + args + env), this milestone is trivial. If it requires a fundamentally different setup, document the limitation and skip.

2. **Create the Codex config file** (exact name TBD from step 1) with the same pattern:
   - stdio transport
   - `npx tsx src/index.ts` as the command
   - `ASD_JWT` placeholder for user to fill in

3. **Create a `.example` template** (same pattern as Claude Code — committed template, real config gitignored).

4. **Add the config directory to `.gitignore`** if it contains secrets.

5. **Verify in Codex** (if available). If Codex CLI is not installed or MCP support is in preview, document the config and mark verification as deferred.

**Files to touch:** Codex config file (new), `.example` template (new), `.gitignore` (update)

**Done when:**
- Codex MCP config template exists with stdio setup
- Config with secrets is gitignored
- If Codex CLI is available: tools are discoverable and callable
- If Codex CLI is not available: config is documented and ready to test when it is

---

### Milestone 5C: Integration Verification

**What to do:**

End-to-end smoke test from each configured client. No new code.

1. **Claude Code verification:**
   - Open the project directory in Claude Code
   - Confirm `support-ops` appears in the MCP server list
   - Run: "Search for open tickets" → should call `search_tickets` and return results
   - Run: "Get ticket details for {id}" (using an ID from the search) → should call `get_ticket`
   - Confirm stderr shows structured log lines during the calls (from 4C)

2. **Codex verification** (if available):
   - Same smoke test: search tickets, get ticket detail
   - If Codex is not available, skip and note in the implementation log

3. **Document the JWT acquisition flow** — users need to know how to get their `ASD_JWT`. Add a section to the README (or a standalone `SETUP.md` if the README isn't written yet):

   > **Getting your ASD JWT:**
   > 1. Open https://agent-service-desk.vercel.app
   > 2. Log in with `agent@demo.com` / `agent123`
   > 3. Open browser DevTools → Network tab
   > 4. Look for any request to the API backend — the `Authorization: Bearer <token>` header contains your JWT
   > 5. Copy the token (without the "Bearer " prefix) into your MCP config's `ASD_JWT` field
   >
   > **Note:** Demo JWTs expire after 1 hour. For longer sessions, see the ASD project's `seed/mint_tokens.py` script.

**Files to touch:** README.md or SETUP.md (JWT instructions)

**Done when:**
- Claude Code can call at least 2 tools successfully via stdio
- JWT acquisition steps are documented
- Codex is either verified or documented as deferred

---

## Milestone 6 — README & Repo Polish

**Goal:** Portfolio-grade README, clean `package.json`, verified `npm pack` output, and a presentable repository. After this milestone, the repo is ready to share.

---

### Milestone 6A: README

**What to do:**

Replace the placeholder README with a complete, portfolio-grade README. Structure:

```markdown
# support-ops-mcp

One-line description.

## What is this?

2–3 paragraphs: what the server does, what ASD is, how they connect.
Link to the ASD repo. Mention this is a portfolio/learning project.

## Tools

Table of all 8 tools with name, description, and key parameters.
Group into "Read" (search_tickets, get_ticket, search_knowledge, get_review_queue)
and "Action" (triage_ticket, generate_draft, review_draft, update_ticket).

## Architecture

```
MCP Client ──MCP Protocol──► support-ops-mcp ──HTTP + JWT──► Agent Service Desk API
```

Short description of the data flow. Mention stateless HTTP and stdio transports.
Mention session-based transport for Streamable HTTP.

## Setup

### Prerequisites
- Node.js 20+
- An ASD JWT (link to JWT acquisition section)

### Install
```bash
git clone <repo-url>
cd support-ops-mcp
npm install
```

### Configure
```bash
cp .env.example .env
# Edit .env — set ASD_API_URL and ASD_JWT
```

### Run
```bash
npm run dev          # HTTP mode (default)
TRANSPORT=stdio npm run dev  # stdio mode
```

### Use with Claude Code
```bash
cp .claude/mcp.json.example .claude/mcp.json
# Edit .claude/mcp.json — set your ASD_JWT
# Restart Claude Code — the server appears in the MCP tool list
```

### Use with Codex
(Same pattern, referencing the Codex config template)

## Getting an ASD JWT

Step-by-step instructions (browser login + DevTools, or mint_tokens.py for long-lived tokens).

## Development

| Command | Description |
|---|---|
| `npm run dev` | Start dev server (auto-reload) |
| `npm run build` | Production build |
| `npm run start` | Run production build |
| `npm run typecheck` | Type check |
| `npm run test` | Run full test suite |
| `npm run test:client` | Run test client only |

## Project Structure

```
src/
├── index.ts           # Entry point
├── server.ts          # McpServer factory
├── transport.ts       # HTTP + stdio transports
├── config.ts          # Environment config
├── logger.ts          # Structured logging
├── asd-client/        # Typed ASD API client
│   ├── index.ts
│   └── types.ts
└── tools/             # MCP tool implementations
    ├── index.ts       # Registration barrel
    ├── errors.ts      # Shared error formatting
    ├── search-tickets.ts
    ├── get-ticket.ts
    ├── search-knowledge.ts
    ├── get-review-queue.ts
    ├── triage-ticket.ts
    ├── generate-draft.ts
    ├── review-draft.ts
    └── update-ticket.ts
```

## About Agent Service Desk

Brief description of ASD: what it is, tech stack highlights (FastAPI, Neon/pgvector, OpenAI, BetterAuth), link to the ASD repo. Mention that support-ops-mcp exposes ASD's capabilities as MCP tools so AI coding assistants can interact with the support system programmatically.

## License

MIT
```

**Key README principles:**
- No GIF (demo was skipped) — the tool table and architecture diagram do the presenting
- Setup instructions must be copy-paste-able — a reader should go from clone to working tools in under 5 minutes
- Don't duplicate the implementation plan or concepts log — the README is for users, those docs are for developers

**Files to touch:** `README.md`

**Done when:**
- README covers all sections listed above
- Setup instructions work end-to-end when followed from scratch (clone → install → configure → run → call a tool)
- Tool table includes all 8 tools with accurate descriptions
- ASD is described and linked

---

### Milestone 6B: Package & Repo Polish

**What to do:**

Clean up `package.json`, verify the build output, and tidy the repo for sharing.

1. **`package.json` audit:**
   - Verify `name`, `version`, `description`, `author`, `license` are correct
   - Verify `engines.node` matches actual requirement (>=20)
   - Verify `files` array includes only `dist` (no source, no tests, no docs in the npm package)
   - Verify `bin` entry points to `dist/index.js` and the file has a shebang
   - Pin `@modelcontextprotocol/sdk` to the exact version currently installed (replace `latest` — published packages must not depend on `latest`)
   - Pin `@types/node` to the major version currently installed (replace `latest`)
   - Pin `tsup` and `tsx` to the exact versions currently installed (replace `latest`)
   - Add `repository` field pointing to the GitHub repo
   - Add `homepage` field (GitHub repo URL)

2. **Verify `npm run build` output:**
   - `dist/index.js` exists and has the shebang line
   - `dist/index.d.ts` exists
   - No source maps leak source code (source maps are fine — they reference local paths, not code)

3. **Verify `npm pack --dry-run`:**
   - Only `dist/`, `package.json`, `README.md`, and `LICENSE` are included
   - No `.env`, no `src/`, no `tests/`, no `docs/`, no `.claude/`
   - Package size is reasonable (under 100KB)

4. **Clean up `.gitignore`:**
   - Ensure `dist/` is ignored (build artifacts shouldn't be committed)
   - Ensure `.env` and `.env.local` are ignored
   - Ensure `.claude/` is ignored (from 5A)
   - Ensure `node_modules/` is ignored

5. **Verify `LICENSE` exists** and is MIT with the correct author name.

6. **Update CLAUDE.md** — sync the "Current Milestone" to reflect completed status, and update any architecture notes that changed during hardening (e.g. `src/tools/errors.ts`, `src/logger.ts`).

**Files to touch:** `package.json`, `CLAUDE.md`, `.gitignore` (if needed), `LICENSE` (if needed)

**Done when:**
- `npm run build` succeeds and produces correct output
- `npm pack --dry-run` includes only intended files
- All `latest` version specifiers in `package.json` are pinned to exact versions
- `package.json` has `repository` and `homepage` fields
- `.gitignore` covers all sensitive and generated files
- CLAUDE.md reflects the current state of the project

---

### Milestone 6C: Final Verification

**What to do:**

Full end-to-end pass. No new code.

1. **Fresh clone test** (simulate a new user):
   - Clone to a temp directory
   - `npm install`
   - Copy `.env.example` to `.env`, fill in real values
   - `npm run build` → verify dist output
   - `npm run dev` → verify server starts
   - `npm run test` → verify all tests pass

2. **README walkthrough:** Follow every step in the README from top to bottom. Flag any step that doesn't work or is unclear.

3. **Claude Code smoke test:** Follow the "Use with Claude Code" section. Confirm the server appears and tools are callable.

4. **`npm run typecheck`** — no errors.

5. **`git status`** — working tree is clean (all changes committed).

**Files to touch:** None (verification only)

**Done when:**
- Fresh clone → install → test passes without manual intervention
- README instructions are accurate end-to-end
- Claude Code integration works from the documented steps
- Repo is clean, buildable, and ready to share

---

## Risk Register (Part 2)

| Risk | Impact | Mitigation |
| - | - | - |
| `AbortSignal.timeout()` not available in older Node.js | Timeout feature breaks | `engines.node` requires >=20, which supports it. Verified in Node.js docs |
| Codex CLI MCP support is in preview or undocumented | 5B can't be completed | Document the intended config; mark verification as deferred. Claude Code is the primary client |
| `formatToolError` changes error messages that tests assert on | Tests break | Update test assertions in 4D to match new message format |
| `npm pack` includes unexpected files | Package bloat | `files: ["dist"]` in package.json is an allowlist — only listed paths are included |
| Session-based HTTP transport leaks memory under long-running use | Server OOM | Acceptable for portfolio use. Document in README that production deployments should add session TTLs |

---

## What's NOT in Part 2

- **Production deployment** (Docker, Railway, CI/CD) — out of scope for a portfolio piece
- **Authentication layer on the MCP server itself** — the server trusts whoever connects. MCP auth is an evolving spec area
- **Rate limiting** — the ASD API has its own rate limits; the MCP server is a passthrough
- **Additional tools beyond the 8 already implemented** — the tool set covers the full ASD support workflow
