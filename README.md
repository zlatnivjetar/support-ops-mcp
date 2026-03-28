# Support Ops MCP

TypeScript MCP server that exposes Agent Service Desk support workflows as tools for Claude Code, Codex, and other MCP clients.

## What Is This?

`support-ops-mcp` is a thin MCP adapter around the [Agent Service Desk](https://github.com/zlatnivjetar/agent-service-desk) API. Instead of asking an assistant to click through a UI, you can give it typed tools for ticket search, ticket inspection, knowledge retrieval, AI triage, AI drafting, draft review, and ticket updates.

[Agent Service Desk](https://github.com/zlatnivjetar/agent-service-desk) is a multi-tenant AI-assisted support system for B2B SaaS teams. It gives human agents a ticket workspace, RAG-grounded drafts with citations, review queues, and operational controls; this repo makes those backend capabilities available to MCP-capable assistants through JWT-authenticated API calls.

This is a portfolio and learning project focused on building a clean MCP integration on top of a real backend. The server stays intentionally small: MCP schemas live in `src/tools/`, transport concerns live in `src/transport.ts`, and the HTTP bridge to ASD lives in `src/asd-client/`.

### Typical Workflow

```text
search_tickets -> get_ticket -> triage_ticket -> generate_draft -> review_draft -> update_ticket
```

1. **Search** for tickets matching your criteria (or list the most recent)
2. **Inspect** a ticket to see its full conversation history, latest triage prediction, and draft status
3. **Triage** the ticket with AI to classify category, priority, team, and escalation need
4. **Draft** an AI response grounded in knowledge base articles with citations
5. **Review** the draft — approve, edit, reject, or escalate
6. **Update** the ticket to apply triage results or make manual adjustments

`search_knowledge` and `get_review_queue` are available at any point — use them to look up documentation or monitor pending drafts.

## Tools

### Read Tools

| Tool | Description | Key Parameters |
|---|---|---|
| `search_tickets` | Search and filter support tickets. Returns paginated results with status, priority, category, team, and AI confidence scores. Omit all filters to get the most recent tickets. | `status`, `priority`, `category`, `team`, `assignee_id`, `sort_by`, `sort_order`, `page`, `per_page` |
| `get_ticket` | Fetch one ticket with the full conversation thread, latest AI triage prediction, and latest draft metadata. Use after `search_tickets` to inspect a specific ticket. | `ticket_id` |
| `search_knowledge` | Semantic search over the knowledge base. Returns document chunks ranked by relevance with similarity scores. Use to find FAQs, policies, or product docs relevant to a customer question. | `query`, `top_k` |
| `get_review_queue` | List AI-generated draft responses awaiting human review, oldest first (FIFO). Each item shows a draft preview, confidence score, and associated ticket. | `page`, `per_page` |

### Action Tools

| Tool | Description | Key Parameters |
|---|---|---|
| `triage_ticket` | Run AI triage to predict category, priority, team, and escalation need. Creates a prediction record — does **not** modify the ticket. Use `update_ticket` to apply the predictions. | `ticket_id` |
| `generate_draft` | Generate an AI response draft using RAG-grounded evidence from the knowledge base. Returns draft body, cited evidence count, confidence score, and send-readiness. Draft is created with `pending` approval status. | `ticket_id` |
| `review_draft` | Submit a review decision on a pending draft. Actions: `approved` (send as-is), `edited_and_approved` (send with edits), `rejected` (discard), `escalated` (flag for senior review). | `draft_id`, `action`, `edited_body`, `reason` |
| `update_ticket` | Update ticket fields after triage or manual review. All fields optional — only provided fields are changed. | `ticket_id`, `status`, `priority`, `category`, `team`, `assignee_id` |

### Parameter Reference

<details>
<summary><strong>Enum values accepted by tools</strong></summary>

**Status:** `open`, `in_progress`, `pending_customer`, `pending_internal`, `resolved`, `closed`

**Priority:** `low`, `medium`, `high`, `critical`

**Category:** `billing`, `bug_report`, `feature_request`, `account_access`, `integration`, `api_issue`, `onboarding`, `data_export`

**Review action:** `approved`, `edited_and_approved`, `rejected`, `escalated`

**Sort by:** `created_at`, `updated_at`, `priority`, `status`

**Sort order:** `asc`, `desc`

</details>

## Architecture

```text
MCP Client ── MCP over stdio or Streamable HTTP ──> support-ops-mcp ── HTTPS + JWT ──> Agent Service Desk API
```

The server supports two transport modes:

- **Streamable HTTP** (default) — Express server on the configured port. Exposes `POST /mcp` for MCP requests and `GET /health` for monitoring. The MCP SDK manages session state in memory via `mcp-session-id` headers; each client session gets its own `McpServer` and transport instance, automatically cleaned up on disconnect.
- **stdio** — JSON-RPC over stdin/stdout. Used when Claude Code or Codex spawns the server as a child process. All log output goes to stderr to keep stdout reserved for the protocol.

Each tool invocation is a stateless, JWT-authenticated HTTPS request to the ASD API. The MCP server holds no ticket data — it formats requests, forwards them, and shapes responses for the LLM.

## Setup

### Prerequisites

- Node.js 20+
- An ASD JWT token (see [Getting an ASD JWT](#getting-an-asd-jwt))

### Install

```bash
git clone https://github.com/zlatnivjetar/support-ops-mcp.git
cd support-ops-mcp
npm install
```

### Configure

```bash
cp .env.example .env
```

Set these values in `.env`:

| Variable | Required | Default | Description |
|---|---|---|---|
| `ASD_API_URL` | Yes | — | Base URL of the Agent Service Desk API |
| `ASD_JWT` | Yes | — | Raw JWT token (without the `Bearer ` prefix) |
| `TRANSPORT` | No | `http` | Transport mode: `http` or `stdio` |
| `PORT` | No | `3001` | HTTP listen port (ignored in stdio mode) |
| `ASD_TIMEOUT_MS` | No | `30000` | Request timeout in milliseconds |

Example `.env`:

```env
ASD_API_URL=https://agent-service-desk-production.up.railway.app
ASD_JWT=paste-your-jwt-here
TRANSPORT=http
PORT=3001
```

### Run

HTTP mode is the default:

```bash
npm run dev
```

The MCP endpoint will be available at `http://127.0.0.1:3001/mcp`, and the health check at `http://127.0.0.1:3001/health`.

To run in stdio mode instead:

macOS / Linux:

```bash
TRANSPORT=stdio npm run dev
```

PowerShell:

```powershell
$env:TRANSPORT="stdio"
npm run dev
```

### Verify Locally

With the server running in HTTP mode in one terminal, exercise all tools from another:

```bash
npm run test:client
```

Or start the server and run the client automatically:

```bash
npm run test
```

The test client runs 18 unit-level checks and 4 end-to-end workflow scenarios covering the full triage-to-review pipeline.

### Use with Claude Code

```bash
cp .mcp.json.example .mcp.json
```

Edit `.mcp.json` and replace `YOUR_JWT_HERE` with your ASD JWT. Keep `TRANSPORT` set to `stdio`. Restart Claude Code and the server will appear as `support-ops` in the MCP tool list.

### Use with Codex

```bash
cp .codex/config.toml.example .codex/config.toml
```

Edit `.codex/config.toml` and replace `YOUR_JWT_HERE` with your ASD JWT. Keep `TRANSPORT = "stdio"`. Restart Codex and the server will appear as `support-ops`.

## Getting an ASD JWT

### Quick path: copy a browser token

1. Open the live ASD app at <https://agent-service-desk.vercel.app>.
2. Sign in with a demo account such as `agent@demo.com` / `agent123` or `lead@demo.com` / `lead123`.
3. Open browser DevTools and switch to the **Network** tab.
4. Trigger any authenticated API request (e.g., navigate to the tickets list).
5. Find a request to the API backend and copy the `Authorization` header value.
6. Remove the leading `Bearer ` prefix and paste the remaining token into `ASD_JWT`.

> **Note:** Demo JWTs expire after 1 hour. For longer sessions, use the method below.

### Longer-lived path: mint a token from the ASD repo

If you have the [Agent Service Desk repo](https://github.com/zlatnivjetar/agent-service-desk) set up locally with demo data, you can mint a JWT directly:

```bash
git clone https://github.com/zlatnivjetar/agent-service-desk.git
cd agent-service-desk
python seed/mint_tokens.py agent
```

The script reads `JWT_SECRET` and `DATABASE_URL` from `api/.env.local` and prints a token for the requested demo user. Replace `agent` with `lead` or `client`, or omit the argument to print tokens for all demo users.

## Development

| Command | Description |
|---|---|
| `npm run dev` | Start the development server with `tsx` (auto-reload, loads `.env`) |
| `npm run build` | Build the production bundle into `dist/` with `tsup` |
| `npm run start` | Run the built server from `dist/index.js` |
| `npm run typecheck` | Run TypeScript type checking without emitting files |
| `npm run test` | Start the HTTP server and run the end-to-end client workflow against it |
| `npm run test:client` | Run the MCP client test suite against an already-running local server |

### Structured Logging

All log output goes to stderr as JSON lines. Each entry includes a timestamp, log level, and message. ASD API calls also log the endpoint, HTTP status, and response time in milliseconds.

```jsonl
{"ts":"2026-03-27T12:00:00.000Z","level":"info","msg":"ASD API call","endpoint":"GET /tickets","status":200,"durationMs":142}
```

In stdio mode, stdout is reserved for JSON-RPC — all diagnostic output is on stderr only.

### Error Handling

Every tool handler catches errors and returns structured MCP responses — no tool ever throws an unhandled exception. Error formatting is centralized in `src/tools/errors.ts`:

- **401** — JWT expired or invalid (check `ASD_JWT`)
- **403** — insufficient role permissions
- **404** — resource not found (tool-specific message)
- **504** — AI pipeline timeout (retry)
- **Network errors** — ASD API unreachable (check `ASD_API_URL`)
- **Timeouts** — configurable via `ASD_TIMEOUT_MS` (default 30s, AI endpoints use 55s)

## Project Structure

```text
src/
|-- index.ts           # Entry point
|-- server.ts          # McpServer factory and tool registration
|-- transport.ts       # Streamable HTTP and stdio transport startup
|-- config.ts          # Environment configuration
|-- logger.ts          # Structured JSON logging to stderr
|-- asd-client/        # Typed ASD API client
|   |-- index.ts       # HTTP client with JWT auth, timeouts, error handling
|   `-- types.ts       # TypeScript types mirroring ASD API response shapes
`-- tools/             # MCP tool implementations (one file per tool)
    |-- index.ts       # Registration barrel
    |-- errors.ts      # Shared error formatting utility
    |-- search-tickets.ts
    |-- get-ticket.ts
    |-- search-knowledge.ts
    |-- get-review-queue.ts
    |-- triage-ticket.ts
    |-- generate-draft.ts
    |-- review-draft.ts
    `-- update-ticket.ts
```

## About Agent Service Desk

[Agent Service Desk](https://github.com/zlatnivjetar/agent-service-desk) is a multi-tenant AI-assisted support system for B2B SaaS teams. The full product uses a Next.js frontend, a FastAPI backend, Neon Postgres with `pgvector` for tenant-scoped data and retrieval, OpenAI for triage and drafting, BetterAuth for session and JWT flows, and Upstash Redis for supporting infrastructure.

`support-ops-mcp` does not re-implement that product. It exposes a focused subset of ASD's operational surfaces as MCP tools so coding assistants and other MCP clients can search support data, retrieve context, and participate in agent workflows programmatically.

## License

MIT
