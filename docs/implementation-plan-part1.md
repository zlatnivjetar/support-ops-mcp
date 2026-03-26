# Support Operations MCP Server — Implementation Plan (Part 1)

**Location:** `docs/implementation-plan.md` (inside the repo — Claude Code reads it automatically)
**Scope:** Milestones 1–3 (Vertical Slice, Read-Only Tools, Action Tools)
**Part 2** (Milestones 4–6: Hardening, Claude Desktop Integration & Demo, README & Repo Polish) will be written after Part 1 is implemented, so work orders can reference real code.

---

## Stack Decisions

| Layer | Choice | Version | Why |
| - | - | - | - |
| Language | TypeScript | 5.x | Matches the MCP SDK ecosystem; shows TS range alongside ASD's Python backend |
| MCP SDK | `@modelcontextprotocol/sdk` | latest stable | Official SDK, required for protocol compliance |
| Transport | Streamable HTTP (stateless) + stdio | MCP spec 2025-03-26 | Streamable HTTP for remote use, stdio for Claude Desktop/Cursor local mode |
| HTTP Framework | Express | 5.x | SDK has first-party `@modelcontextprotocol/express` middleware for DNS rebinding protection |
| Schema Validation | Zod | v4 (via SDK) | Required peer dependency of the MCP SDK |
| HTTP Client | Built-in `fetch` | Node.js 20+ | No external deps needed; the ASD API client is a thin wrapper |
| Build | `tsx` for dev, `tsup` for production | — | tsx for zero-config TS execution; tsup for clean npm-publishable builds |
| Runtime | Node.js | 20+ | LTS, required by MCP SDK for Web Crypto support |

---

## Architecture Overview

```
┌──────────────────────┐         ┌─────────────────────────┐
│  MCP Client          │         │  Agent Service Desk     │
│  (Claude Desktop,    │  MCP    │  (FastAPI on Railway)    │
│   Cursor, Claude     │ ──────► │                         │
│   Code, custom)      │ Protocol│  Live at:               │
└──────────────────────┘         │  api.agent-service-desk │
         │                       │  .railway.app           │
         │                       └─────────────────────────┘
         │                                  ▲
         ▼                                  │
┌──────────────────────┐                    │
│  support-ops-mcp     │  HTTP + Bearer JWT │
│  (this server)       │ ───────────────────┘
│                      │
│  Stateless MCP       │
│  Protocol Server     │
│                      │
│  Tools:              │
│  - search_tickets    │
│  - get_ticket        │
│  - search_knowledge  │
│  - get_review_queue  │
│  - triage_ticket     │
│  - generate_draft    │
│  - review_draft      │
│  - update_ticket     │
└──────────────────────┘
```

**Data flow:** MCP Client sends tool calls → this server validates input schemas, translates to ASD API calls with JWT passthrough → returns typed MCP tool results.

**Auth model:** The MCP server does not manage authentication itself. The user provides an ASD JWT in the server configuration. The server forwards it as a Bearer token on every ASD API call. If the JWT is expired or invalid, the ASD API returns 401 and the MCP server surfaces a clean error.

---

## How to use each sub-milestone with Claude Code

Each sub-milestone below is a self-contained work order. When you're ready to implement it:

1. Make sure Claude Code has access to your repo (it reads your codebase automatically)
2. Paste the sub-milestone content directly as your prompt
3. No need to ask Claude Code to "plan first" — the work order IS the plan
4. After Claude Code finishes, verify the "Done when" checklist manually

**Tip:** If a sub-milestone is large, tell Claude Code: "Let's implement this incrementally. Start with [first item] and we'll continue." This keeps context window usage tight.

---

## Milestone 1 — Vertical Slice

**Goal:** Project scaffold, typed ASD API client, one working MCP tool (`search_tickets`), end-to-end verified with a test client. After this milestone, the entire integration stack is proven — MCP SDK → typed tool → ASD API → real data back.

---

### Milestone 1A: Project Scaffold

**Paste this into Claude Code:**

> Initialize the repo for "support-ops-mcp" with this exact structure:
>
> ```
> support-ops-mcp/
> ├── src/
> │   ├── index.ts              # Entry point — starts MCP server
> │   ├── server.ts             # McpServer instance + tool registration
> │   ├── transport.ts          # Transport setup (Streamable HTTP + stdio)
> │   ├── config.ts             # Environment/config loading
> │   ├── asd-client/
> │   │   ├── index.ts          # ASD API client class
> │   │   └── types.ts          # TypeScript types mirroring ASD API responses
> │   └── tools/
> │       └── index.ts          # Tool registration barrel file
> ├── tests/
> │   └── client-test.ts        # Interactive test client script
> ├── docs/
> │   └── implementation-plan.md
> ├── .env.example
> ├── .gitignore
> ├── package.json
> ├── tsconfig.json
> ├── CLAUDE.md
> ├── LICENSE                   # MIT
> └── README.md                 # Placeholder for now
> ```
>
> **`package.json`:**
> ```json
> {
>   "name": "support-ops-mcp",
>   "version": "0.1.0",
>   "description": "MCP server exposing support operations tools — ticket triage, knowledge search, draft generation with RAG citations, and review queue management.",
>   "type": "module",
>   "main": "dist/index.js",
>   "types": "dist/index.d.ts",
>   "bin": {
>     "support-ops-mcp": "dist/index.js"
>   },
>   "files": ["dist"],
>   "engines": {
>     "node": ">=20"
>   },
>   "scripts": {
>     "dev": "tsx src/index.ts",
>     "build": "tsup src/index.ts --format esm --dts --clean",
>     "start": "node dist/index.js",
>     "test:client": "tsx tests/client-test.ts",
>     "typecheck": "tsc --noEmit"
>   },
>   "keywords": ["mcp", "model-context-protocol", "support-operations", "ai-tools"],
>   "author": "David Grljusic",
>   "license": "MIT"
> }
> ```
>
> **Dependencies to install:**
> - `@modelcontextprotocol/sdk` — the official MCP SDK
> - `@modelcontextprotocol/express` — Express middleware with DNS rebinding protection
> - `express` — HTTP framework for Streamable HTTP transport
> - `zod` — required peer dependency for MCP SDK schema validation
>
> **Dev dependencies:**
> - `typescript`
> - `tsx` — zero-config TS execution for development
> - `tsup` — build tool for production output
> - `@types/node`
> - `@types/express`
>
> **`tsconfig.json`:**
> ```json
> {
>   "compilerOptions": {
>     "target": "ES2022",
>     "module": "ESNext",
>     "moduleResolution": "bundler",
>     "esModuleInterop": true,
>     "strict": true,
>     "outDir": "dist",
>     "rootDir": "src",
>     "declaration": true,
>     "sourceMap": true,
>     "skipLibCheck": true,
>     "resolveJsonModule": true,
>     "isolatedModules": true,
>     "forceConsistentCasingInFileNames": true
>   },
>   "include": ["src/**/*"],
>   "exclude": ["node_modules", "dist", "tests"]
> }
> ```
>
> **`src/config.ts`** — loads configuration from environment variables:
> ```typescript
> /**
>  * Configuration for the MCP server.
>  *
>  * Required env vars:
>  *   ASD_API_URL  — Base URL of the Agent Service Desk API
>  *                  (e.g., https://agent-service-desk-api.railway.app)
>  *   ASD_JWT      — Bearer token for authenticating with the ASD API
>  *
>  * Optional:
>  *   PORT         — HTTP port for Streamable HTTP transport (default: 3001)
>  *   TRANSPORT    — "http" | "stdio" (default: "http")
>  */
> export interface Config {
>   asdApiUrl: string;
>   asdJwt: string;
>   port: number;
>   transport: 'http' | 'stdio';
> }
>
> export function loadConfig(): Config {
>   const asdApiUrl = process.env.ASD_API_URL;
>   const asdJwt = process.env.ASD_JWT;
>
>   if (!asdApiUrl) throw new Error('ASD_API_URL environment variable is required');
>   if (!asdJwt) throw new Error('ASD_JWT environment variable is required');
>
>   return {
>     asdApiUrl: asdApiUrl.replace(/\/$/, ''), // strip trailing slash
>     asdJwt,
>     port: parseInt(process.env.PORT || '3001', 10),
>     transport: (process.env.TRANSPORT as 'http' | 'stdio') || 'http',
>   };
> }
> ```
>
> **`.env.example`:**
> ```
> # Required — Agent Service Desk API
> ASD_API_URL=https://agent-service-desk-api.railway.app
> ASD_JWT=eyJ...your-jwt-here
>
> # Optional
> PORT=3001
> TRANSPORT=http
> ```
>
> **`.gitignore`:**
> ```
> node_modules/
> dist/
> .env
> .env.local
> *.tgz
> ```
>
> **`CLAUDE.md`:**
> ```markdown
> # Support Operations MCP Server
>
> ## Project Overview
> MCP protocol server (TypeScript, Streamable HTTP) that exposes support operations
> as tools any MCP client can call. Backed by the Agent Service Desk API.
>
> ## Architecture
> - `src/server.ts` — McpServer instance, tool registration
> - `src/transport.ts` — Streamable HTTP + stdio transport setup
> - `src/config.ts` — env-based configuration
> - `src/asd-client/` — typed HTTP client for the ASD API
> - `src/tools/` — one file per MCP tool
>
> ## Key Patterns
> - Every tool has a Zod input schema AND a typed output shape
> - The ASD client forwards the configured JWT on every request
> - Errors from ASD API are caught and returned as MCP tool errors (isError: true)
> - Stateless Streamable HTTP transport — no session management
>
> ## Commands
> - `npm run dev` — start in dev mode (tsx, auto-restart)
> - `npm run build` — production build (tsup)
> - `npm run test:client` — interactive MCP client for testing
> - `npm run typecheck` — TypeScript type checking
>
> ## Testing
> 1. Get a JWT from the ASD demo: login at https://agent-service-desk.vercel.app
>    as agent@demo.com / agent123, then extract the JWT from the /api/token endpoint
> 2. Set ASD_API_URL and ASD_JWT in .env
> 3. `npm run dev` in one terminal
> 4. `npm run test:client` in another terminal
>
> ## Implementation Plan
> See docs/implementation-plan.md for the full milestone-based plan.
> ```
>
> **`src/index.ts`** — entry point (placeholder, will be fleshed out in 1C):
> ```typescript
> #!/usr/bin/env node
> import { loadConfig } from './config.js';
>
> const config = loadConfig();
> console.log(`Support Ops MCP Server starting...`);
> console.log(`Transport: ${config.transport}`);
> console.log(`ASD API: ${config.asdApiUrl}`);
> // Server setup will go here in Milestone 1C
> ```
>
> Make sure the shebang line is present in `src/index.ts` — it's needed for the `bin` entry to work when installed globally.

**Done when:**

- `npm install` completes without errors
- `npm run typecheck` passes
- `npm run dev` prints the startup message without errors (it won't serve yet — just validates config loading)
- `npm run build` produces `dist/index.js` and `dist/index.d.ts`
- `package.json` has correct `bin`, `files`, `engines`, and `type` fields

---

### Milestone 1B: ASD API Client

**Context you need to understand before this step:**

The ASD API client is the bridge between MCP tools and the Agent Service Desk backend. It's a typed HTTP client that:
1. Sends requests to the ASD FastAPI backend
2. Attaches the JWT as a Bearer token on every request
3. Returns typed responses matching the ASD API shapes
4. Handles errors (network, auth, validation) and surfaces them cleanly

The client doesn't know about MCP at all — it's a pure HTTP client. MCP tools call client methods and transform the results into MCP tool responses.

---

**Paste this into Claude Code:**

> Implement the typed ASD API client. This wraps fetch calls to the Agent Service Desk backend.
>
> **`src/asd-client/types.ts`** — TypeScript types that mirror the ASD API response shapes. Define these based on the ASD API endpoints we'll be calling:
>
> ```typescript
> // ── Pagination ──
> export interface PaginatedResponse<T> {
>   items: T[];
>   total: number;
>   page: number;
>   per_page: number;
>   total_pages: number;
> }
>
> // ── Tickets ──
> export interface TicketListItem {
>   id: string;
>   subject: string;
>   status: string;
>   priority: string;
>   category: string | null;
>   team: string | null;
>   assignee_id: string | null;
>   assignee_name: string | null;
>   org_name: string;
>   confidence: number | null;
>   sla_policy_name: string | null;
>   created_at: string;
>   updated_at: string;
> }
>
> export interface TicketMessage {
>   id: string;
>   sender_id: string;
>   sender_name: string;
>   sender_type: string;
>   body: string;
>   is_internal: boolean;
>   created_at: string;
> }
>
> export interface TicketPrediction {
>   id: string;
>   predicted_category: string;
>   predicted_priority: string;
>   predicted_team: string;
>   escalation_suggested: boolean;
>   escalation_reason: string | null;
>   confidence: number;
>   created_at: string;
> }
>
> export interface TicketDraft {
>   id: string;
>   body: string;
>   evidence_chunk_ids: string[];
>   confidence: number;
>   unresolved_questions: string[];
>   send_ready: boolean;
>   approval_outcome: string;
>   created_at: string;
> }
>
> export interface TicketDetail {
>   id: string;
>   subject: string;
>   status: string;
>   priority: string;
>   category: string | null;
>   team: string | null;
>   assignee_id: string | null;
>   assignee_name: string | null;
>   org_name: string;
>   messages: TicketMessage[];
>   latest_prediction: TicketPrediction | null;
>   latest_draft: TicketDraft | null;
>   created_at: string;
>   updated_at: string;
> }
>
> // ── Knowledge ──
> export interface KnowledgeSearchResult {
>   chunk_id: string;
>   document_id: string;
>   document_title: string;
>   content: string;
>   similarity: number;
>   chunk_index: number;
> }
>
> // ── Review Queue ──
> export interface DraftQueueItem {
>   draft_generation_id: string;
>   ticket_id: string;
>   ticket_subject: string;
>   body: string;
>   confidence: number;
>   approval_outcome: string;
>   created_at: string;
> }
>
> // ── Triage ──
> export interface TriageResult {
>   id: string;
>   ticket_id: string;
>   predicted_category: string;
>   predicted_priority: string;
>   predicted_team: string;
>   escalation_suggested: boolean;
>   escalation_reason: string | null;
>   confidence: number;
>   latency_ms: number;
>   created_at: string;
> }
>
> // ── Draft Generation ──
> export interface DraftResult {
>   id: string;
>   ticket_id: string;
>   body: string;
>   evidence_chunk_ids: string[];
>   confidence: number;
>   unresolved_questions: string[];
>   send_ready: boolean;
>   approval_outcome: string;
>   latency_ms: number;
>   created_at: string;
> }
>
> // ── Review ──
> export interface ReviewResult {
>   id: string;
>   action: string;
>   acted_by: string;
>   reason: string | null;
>   created_at: string;
> }
> ```
>
> **`src/asd-client/index.ts`** — the client class:
>
> ```typescript
> /**
>  * Typed HTTP client for the Agent Service Desk API.
>  *
>  * Design:
>  * - Every method maps 1:1 to an ASD API endpoint
>  * - JWT is attached as Bearer token on every request
>  * - Errors are thrown as AsdApiError with status code and message
>  * - No MCP awareness — this is a pure HTTP client
>  */
>
> import type { Config } from '../config.js';
> import type {
>   PaginatedResponse,
>   TicketListItem,
>   TicketDetail,
>   KnowledgeSearchResult,
>   DraftQueueItem,
>   TriageResult,
>   DraftResult,
>   ReviewResult,
> } from './types.js';
>
> export class AsdApiError extends Error {
>   constructor(
>     public status: number,
>     public detail: string,
>     public endpoint: string,
>   ) {
>     super(`ASD API error [${status}] on ${endpoint}: ${detail}`);
>     this.name = 'AsdApiError';
>   }
> }
>
> export class AsdClient {
>   private baseUrl: string;
>   private jwt: string;
>
>   constructor(config: Config) {
>     this.baseUrl = config.asdApiUrl;
>     this.jwt = config.asdJwt;
>   }
>
>   // ── Private helpers ──
>
>   private async request<T>(
>     method: string,
>     path: string,
>     body?: unknown,
>   ): Promise<T> {
>     const url = `${this.baseUrl}${path}`;
>     const headers: Record<string, string> = {
>       'Authorization': `Bearer ${this.jwt}`,
>       'Content-Type': 'application/json',
>     };
>
>     const response = await fetch(url, {
>       method,
>       headers,
>       body: body ? JSON.stringify(body) : undefined,
>     });
>
>     if (!response.ok) {
>       let detail: string;
>       try {
>         const errorBody = await response.json();
>         detail = errorBody.detail || JSON.stringify(errorBody);
>       } catch {
>         detail = await response.text();
>       }
>       throw new AsdApiError(response.status, detail, `${method} ${path}`);
>     }
>
>     // 204 No Content
>     if (response.status === 204) return undefined as T;
>
>     return response.json() as Promise<T>;
>   }
>
>   private buildQuery(params: Record<string, unknown>): string {
>     const searchParams = new URLSearchParams();
>     for (const [key, value] of Object.entries(params)) {
>       if (value !== undefined && value !== null && value !== '') {
>         searchParams.set(key, String(value));
>       }
>     }
>     const qs = searchParams.toString();
>     return qs ? `?${qs}` : '';
>   }
>
>   // ── Ticket endpoints ──
>
>   async searchTickets(params: {
>     page?: number;
>     per_page?: number;
>     status?: string;
>     priority?: string;
>     category?: string;
>     team?: string;
>     assignee_id?: string;
>     sort_by?: string;
>     sort_order?: string;
>   }): Promise<PaginatedResponse<TicketListItem>> {
>     const query = this.buildQuery(params);
>     return this.request('GET', `/tickets${query}`);
>   }
>
>   async getTicket(ticketId: string): Promise<TicketDetail> {
>     return this.request('GET', `/tickets/${ticketId}`);
>   }
>
>   async updateTicket(ticketId: string, updates: {
>     status?: string;
>     priority?: string;
>     category?: string;
>     team?: string;
>     assignee_id?: string;
>   }): Promise<TicketDetail> {
>     return this.request('PATCH', `/tickets/${ticketId}`, updates);
>   }
>
>   // ── AI Pipeline endpoints ──
>
>   async triageTicket(ticketId: string): Promise<TriageResult> {
>     return this.request('POST', `/tickets/${ticketId}/triage`);
>   }
>
>   async generateDraft(ticketId: string): Promise<DraftResult> {
>     return this.request('POST', `/tickets/${ticketId}/draft`);
>   }
>
>   // ── Knowledge endpoints ──
>
>   async searchKnowledge(query: string, topK?: number): Promise<KnowledgeSearchResult[]> {
>     const params = this.buildQuery({ q: query, top_k: topK });
>     return this.request('GET', `/knowledge/search${params}`);
>   }
>
>   // ── Review Queue endpoints ──
>
>   async getReviewQueue(params?: {
>     page?: number;
>     per_page?: number;
>   }): Promise<PaginatedResponse<DraftQueueItem>> {
>     const query = this.buildQuery(params || {});
>     return this.request('GET', `/drafts/review-queue${query}`);
>   }
>
>   async reviewDraft(draftId: string, review: {
>     action: 'approved' | 'edited_and_approved' | 'rejected' | 'escalated';
>     edited_body?: string;
>     reason?: string;
>   }): Promise<ReviewResult> {
>     return this.request('POST', `/drafts/${draftId}/review`, review);
>   }
>
>   // ── Health check (useful for server startup validation) ──
>
>   async healthCheck(): Promise<{ status: string; database: string }> {
>     return this.request('GET', '/health');
>   }
> }
> ```
>
> **Important:**
> - Use Node.js built-in `fetch` (available in Node 20+) — no external HTTP library needed
> - The `AsdApiError` class is critical — MCP tools will catch these and return structured errors
> - Every method returns typed responses matching the `types.ts` definitions
> - The `healthCheck()` method is used during server startup to verify connectivity
> - Don't import any MCP types here — this client is transport-agnostic

**Done when:**

- `npm run typecheck` passes with no errors
- The `AsdClient` class has methods for all 8 ASD API endpoints we'll wrap as MCP tools
- `AsdApiError` is properly typed with status code, detail, and endpoint info
- No circular dependencies between `asd-client/` and other modules

---

### Milestone 1C: MCP Server & Transport Setup

**Context you need to understand before this step:**

The MCP SDK has two main concepts we wire together here:

1. **`McpServer`** — the protocol handler. You register tools, resources, and prompts on it. It handles the MCP JSON-RPC protocol.
2. **Transport** — how the protocol messages get delivered. We support two:
   - **Streamable HTTP** (stateless) — an Express server that handles POST `/mcp`. Used when running as a remote server.
   - **stdio** — reads JSON-RPC from stdin, writes to stdout. Used when Claude Desktop or Cursor spawns the server as a child process.

The entry point (`index.ts`) reads the `TRANSPORT` env var and wires the appropriate transport.

For Streamable HTTP stateless mode:
- Create a new `McpServer` + `StreamableHTTPServerTransport` per request (stateless pattern)
- `sessionIdGenerator: undefined` disables session tracking
- Use `@modelcontextprotocol/express` for the Express app setup with DNS rebinding protection

---

**Paste this into Claude Code:**

> Implement the MCP server setup and transport layer.
>
> **`src/server.ts`** — creates and configures the McpServer instance:
>
> ```typescript
> /**
>  * Creates an McpServer with all support operations tools registered.
>  *
>  * This is called once for stdio transport (persistent server),
>  * or once per request for stateless HTTP transport.
>  */
>
> import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
> import { AsdClient } from './asd-client/index.js';
> import type { Config } from './config.js';
>
> const SERVER_NAME = 'support-ops-mcp';
> const SERVER_VERSION = '0.1.0';
>
> export function createServer(config: Config): McpServer {
>   const server = new McpServer({
>     name: SERVER_NAME,
>     version: SERVER_VERSION,
>     instructions: `This server provides support operations tools backed by Agent Service Desk.
> Available capabilities:
> - Search and filter support tickets
> - Get full ticket details with conversation history
> - Run AI triage (classification) on tickets
> - Generate AI draft responses with RAG-grounded citations
> - Review and approve/reject AI-generated drafts
> - Search the knowledge base semantically
> - View the pending draft review queue
> - Update ticket fields (status, priority, assignment)
>
> Typical workflow: search_tickets → get_ticket → triage_ticket → generate_draft → review_draft`,
>   });
>
>   const client = new AsdClient(config);
>
>   // Tools will be registered here in Milestone 1D onward
>   // registerTools(server, client);
>
>   return server;
> }
> ```
>
> **`src/transport.ts`** — transport setup for both modes:
>
> ```typescript
> /**
>  * Transport setup — Streamable HTTP (stateless) or stdio.
>  *
>  * Streamable HTTP (default):
>  *   Express server on PORT with POST /mcp endpoint.
>  *   Stateless — new McpServer per request, no session tracking.
>  *   Uses @modelcontextprotocol/express for DNS rebinding protection.
>  *
>  * stdio:
>  *   Reads JSON-RPC from stdin, writes to stdout.
>  *   Used when Claude Desktop or Cursor spawns this as a child process.
>  */
>
> import { createMcpExpressApp } from '@modelcontextprotocol/express';
> import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
> import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
> import type { Config } from './config.js';
> import { createServer } from './server.js';
>
> export async function startHttpTransport(config: Config): Promise<void> {
>   const app = createMcpExpressApp();
>
>   // Stateless: create a new server + transport per request
>   app.post('/mcp', async (req, res) => {
>     const server = createServer(config);
>     const transport = new StreamableHTTPServerTransport({
>       sessionIdGenerator: undefined, // stateless — no session tracking
>     });
>
>     await server.connect(transport);
>     await transport.handleRequest(req, res, req.body);
>   });
>
>   // Health endpoint (separate from MCP protocol)
>   app.get('/health', (_req, res) => {
>     res.json({ status: 'ok', server: 'support-ops-mcp' });
>   });
>
>   app.listen(config.port, '127.0.0.1', () => {
>     console.log(`Support Ops MCP Server (HTTP) listening on http://127.0.0.1:${config.port}/mcp`);
>   });
> }
>
> export async function startStdioTransport(config: Config): Promise<void> {
>   const server = createServer(config);
>   const transport = new StdioServerTransport();
>   await server.connect(transport);
>   // stdio transport runs until the process is killed
>   console.error('Support Ops MCP Server (stdio) connected'); // stderr so it doesn't interfere with JSON-RPC on stdout
> }
> ```
>
> **Update `src/index.ts`** — the entry point that ties it all together:
>
> ```typescript
> #!/usr/bin/env node
> import { loadConfig } from './config.js';
> import { startHttpTransport, startStdioTransport } from './transport.js';
>
> async function main() {
>   const config = loadConfig();
>
>   if (config.transport === 'stdio') {
>     await startStdioTransport(config);
>   } else {
>     await startHttpTransport(config);
>   }
> }
>
> main().catch((err) => {
>   console.error('Fatal error:', err);
>   process.exit(1);
> });
> ```
>
> **Important notes:**
> - `createMcpExpressApp()` from `@modelcontextprotocol/express` creates an Express app with DNS rebinding protection and `express.json()` middleware already configured
> - For stateless HTTP: we create a NEW `McpServer` and `StreamableHTTPServerTransport` per request. This is the recommended pattern from the MCP SDK docs for stateless servers.
> - For stdio: we create ONE `McpServer` that lives for the process lifetime
> - Console logs for stdio mode go to stderr (stdout is reserved for JSON-RPC)
> - The `/health` endpoint is NOT part of the MCP protocol — it's a convenience for monitoring
> - Listen on `127.0.0.1` not `0.0.0.0` for localhost security (DNS rebinding protection handles the rest)

**Done when:**

- `npm run dev` starts the HTTP server on port 3001 without errors
- `curl http://127.0.0.1:3001/health` returns `{"status":"ok","server":"support-ops-mcp"}`
- `TRANSPORT=stdio npm run dev` prints the stdio connection message to stderr
- `npm run typecheck` passes
- The server doesn't crash — it's just not serving any tools yet (empty tool list)

---

### Milestone 1D: First Tool — `search_tickets`

**Context you need to understand before this step:**

This is where MCP meets the ASD API. The pattern for every tool is:

1. Define a Zod input schema (what the LLM sends)
2. Define the handler function (validates input → calls ASD client → formats response)
3. Register the tool on the McpServer with `server.registerTool()`

The tool handler returns MCP-formatted content — an array of content blocks. For our tools, that's always a single `text` content block containing JSON. We return JSON because it's structured and the LLM can parse it.

Error handling pattern: catch `AsdApiError` → return `{ isError: true, content: [{ type: 'text', text: 'error details' }] }`. This tells the LLM "the tool call failed" without crashing the MCP connection.

---

**Paste this into Claude Code:**

> Implement the `search_tickets` MCP tool and wire up tool registration.
>
> **`src/tools/search-tickets.ts`** — the first tool:
>
> ```typescript
> /**
>  * search_tickets — Search and filter support tickets.
>  *
>  * Input: Optional filters for status, priority, category, team, assignee.
>  *        Pagination via page/per_page. Sorting via sort_by/sort_order.
>  *
>  * Output: Paginated list of tickets with key fields:
>  *         id, subject, status, priority, category, team, assignee, confidence, timestamps.
>  *
>  * Maps to: GET /tickets on the ASD API.
>  */
>
> import { z } from 'zod';
> import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
> import type { AsdClient } from '../asd-client/index.js';
> import { AsdApiError } from '../asd-client/index.js';
>
> export function registerSearchTickets(server: McpServer, client: AsdClient) {
>   server.registerTool(
>     'search_tickets',
>     {
>       title: 'Search Tickets',
>       description:
>         'Search and filter support tickets. Returns a paginated list with ticket metadata including ' +
>         'status, priority, category, team assignment, and AI confidence scores. ' +
>         'Use filters to narrow results. Omit all filters to get the most recent tickets.',
>       inputSchema: {
>         status: z
>           .enum(['open', 'in_progress', 'pending_customer', 'pending_internal', 'resolved', 'closed'])
>           .optional()
>           .describe('Filter by ticket status'),
>         priority: z
>           .enum(['low', 'medium', 'high', 'critical'])
>           .optional()
>           .describe('Filter by priority level'),
>         category: z
>           .enum([
>             'billing',
>             'bug_report',
>             'feature_request',
>             'account_access',
>             'integration',
>             'api_issue',
>             'onboarding',
>             'data_export',
>           ])
>           .optional()
>           .describe('Filter by ticket category'),
>         team: z.string().optional().describe('Filter by assigned team name'),
>         assignee_id: z.string().uuid().optional().describe('Filter by assignee user ID'),
>         sort_by: z
>           .enum(['created_at', 'updated_at', 'priority', 'status'])
>           .optional()
>           .describe('Field to sort by (default: created_at)'),
>         sort_order: z
>           .enum(['asc', 'desc'])
>           .optional()
>           .describe('Sort direction (default: desc)'),
>         page: z.number().int().min(1).optional().describe('Page number (default: 1)'),
>         per_page: z
>           .number()
>           .int()
>           .min(1)
>           .max(100)
>           .optional()
>           .describe('Results per page (default: 25, max: 100)'),
>       },
>     },
>     async (args) => {
>       try {
>         const result = await client.searchTickets({
>           status: args.status,
>           priority: args.priority,
>           category: args.category,
>           team: args.team,
>           assignee_id: args.assignee_id,
>           sort_by: args.sort_by,
>           sort_order: args.sort_order,
>           page: args.page,
>           per_page: args.per_page,
>         });
>
>         return {
>           content: [
>             {
>               type: 'text' as const,
>               text: JSON.stringify(
>                 {
>                   tickets: result.items.map((t) => ({
>                     id: t.id,
>                     subject: t.subject,
>                     status: t.status,
>                     priority: t.priority,
>                     category: t.category,
>                     team: t.team,
>                     assignee: t.assignee_name,
>                     confidence: t.confidence,
>                     created_at: t.created_at,
>                   })),
>                   pagination: {
>                     total: result.total,
>                     page: result.page,
>                     per_page: result.per_page,
>                     total_pages: result.total_pages,
>                   },
>                 },
>                 null,
>                 2,
>               ),
>             },
>           ],
>         };
>       } catch (err) {
>         if (err instanceof AsdApiError) {
>           return {
>             content: [
>               {
>                 type: 'text' as const,
>                 text: `Error searching tickets: ${err.detail} (HTTP ${err.status})`,
>               },
>             ],
>             isError: true,
>           };
>         }
>         throw err; // unexpected errors bubble up
>       }
>     },
>   );
> }
> ```
>
> **`src/tools/index.ts`** — barrel file for tool registration:
>
> ```typescript
> import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
> import type { AsdClient } from '../asd-client/index.js';
> import { registerSearchTickets } from './search-tickets.js';
>
> /**
>  * Register all MCP tools on the server.
>  * Each tool maps to one ASD API endpoint.
>  */
> export function registerAllTools(server: McpServer, client: AsdClient) {
>   registerSearchTickets(server, client);
>   // More tools added in M2 and M3
> }
> ```
>
> **Update `src/server.ts`** — uncomment/add the tool registration:
>
> ```typescript
> import { registerAllTools } from './tools/index.js';
>
> // Inside createServer(), after creating the client:
> registerAllTools(server, client);
> ```
>
> **Important patterns established here (all future tools follow these):**
> - Each tool lives in its own file: `src/tools/{tool-name}.ts`
> - Each file exports a `register{ToolName}(server, client)` function
> - Input schemas use Zod with `.describe()` on every field (the LLM reads these descriptions)
> - Enum values in schemas match the ASD API's expected values exactly
> - The handler catches `AsdApiError` and returns `isError: true` — never crashes the MCP connection
> - Output is JSON-stringified with 2-space indentation for readability in the LLM's context
> - Output includes only the fields the LLM needs — we strip large/redundant fields to save tokens

**Done when:**

- `npm run typecheck` passes
- `npm run dev` starts the server with the `search_tickets` tool registered
- The tool appears in the MCP tool manifest (we'll verify this in 1E)
- The error handling pattern is established for all future tools

---

### Milestone 1E: End-to-End Verification

**Context:**

We need to verify the full stack works: MCP client → MCP server → ASD API → real data back. We'll build a simple test client script that uses the MCP SDK's `Client` class to connect to our server and call `search_tickets`.

We also need a real JWT to test with. The easiest way: log into the ASD demo app as `agent@demo.com`, then extract the JWT from the browser's network tab (the `/api/token` endpoint returns it).

---

**Paste this into Claude Code:**

> Create an interactive test client and verify the full integration end-to-end.
>
> **`tests/client-test.ts`** — a script that connects to the local MCP server and calls tools:
>
> ```typescript
> /**
>  * Interactive test client for the Support Ops MCP Server.
>  *
>  * Usage:
>  *   1. Start the server: npm run dev
>  *   2. Run this: npm run test:client
>  *
>  * This uses the MCP SDK's Client class to connect via Streamable HTTP
>  * and exercise each registered tool.
>  */
>
> import { Client } from '@modelcontextprotocol/sdk/client/index.js';
> import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
>
> const SERVER_URL = process.env.MCP_SERVER_URL || 'http://127.0.0.1:3001/mcp';
>
> async function main() {
>   console.log(`Connecting to MCP server at ${SERVER_URL}...`);
>
>   const transport = new StreamableHTTPClientTransport(new URL(SERVER_URL));
>   const client = new Client({ name: 'test-client', version: '1.0.0' });
>
>   await client.connect(transport);
>   console.log('Connected!\n');
>
>   // List available tools
>   const { tools } = await client.listTools();
>   console.log(`Available tools (${tools.length}):`);
>   for (const tool of tools) {
>     console.log(`  - ${tool.name}: ${tool.description?.substring(0, 80)}...`);
>   }
>   console.log();
>
>   // Test 1: search_tickets with no filters (should return recent tickets)
>   console.log('=== Test 1: search_tickets (no filters) ===');
>   const result1 = await client.callTool({
>     name: 'search_tickets',
>     arguments: { per_page: 3 },
>   });
>   console.log('Result:', JSON.stringify(result1.content, null, 2));
>   console.log();
>
>   // Test 2: search_tickets with filters
>   console.log('=== Test 2: search_tickets (status=open, priority=high) ===');
>   const result2 = await client.callTool({
>     name: 'search_tickets',
>     arguments: { status: 'open', priority: 'high', per_page: 3 },
>   });
>   console.log('Result:', JSON.stringify(result2.content, null, 2));
>   console.log();
>
>   // Test 3: search_tickets with bad filter (should still work, return 0 results)
>   console.log('=== Test 3: search_tickets (category=billing, sort_by=priority) ===');
>   const result3 = await client.callTool({
>     name: 'search_tickets',
>     arguments: { category: 'billing', sort_by: 'priority', sort_order: 'desc', per_page: 5 },
>   });
>   console.log('Result:', JSON.stringify(result3.content, null, 2));
>
>   await client.close();
>   console.log('\nDone — all tests passed.');
> }
>
> main().catch((err) => {
>   console.error('Test failed:', err);
>   process.exit(1);
> });
> ```
>
> **To get a test JWT:**
>
> 1. Open https://agent-service-desk.vercel.app in a browser
> 2. Login as `agent@demo.com` / `agent123`
> 3. Open browser DevTools → Network tab
> 4. Look for a request to `/api/token` — the response body contains `{"token": "eyJ..."}`
> 5. Copy that JWT value
> 6. Create `.env` in the project root:
>    ```
>    ASD_API_URL=https://agent-service-desk-api.railway.app
>    ASD_JWT=eyJ...the-token-you-copied
>    PORT=3001
>    TRANSPORT=http
>    ```
>
> **Note on the ASD API URL:** Check the ASD project's deployment — the Railway URL may differ. The README says the live demo is at `agent-service-desk.vercel.app` (frontend) but the API backend is on Railway. Look at the `NEXT_PUBLIC_API_URL` in the frontend's network requests to find the actual backend URL.
>
> **Alternative if the live API is down:** Start the ASD backend locally:
> ```bash
> cd /path/to/agent-service-desk/api
> source .venv/bin/activate
> uvicorn app.main:app --port 8000
> ```
> Then use `ASD_API_URL=http://localhost:8000` in `.env`.
>
> **Running the test:**
> 1. Terminal 1: `npm run dev` (starts MCP server)
> 2. Terminal 2: `npm run test:client` (runs the test client)

**Done when:**

- Test client connects to the MCP server successfully
- `listTools()` returns `search_tickets` with its description and input schema
- Test 1 returns real ticket data from the ASD API (subjects, statuses, priorities visible)
- Test 2 returns filtered results (only open + high priority tickets)
- Test 3 returns billing-category tickets sorted by priority
- The response format is clean JSON with `tickets` array and `pagination` object
- If the JWT is expired/invalid, the tool returns a clean error with `isError: true` (not a crash)

**This is the most important verification point in the entire project.** If this works, the architecture is proven. Everything after this is adding more tools using the exact same pattern.

---

## Milestone 2 — Read-Only Tools

**Goal:** Three more tools that cover the "investigation" half of a support workflow — looking up a specific ticket, searching the knowledge base, and checking the review queue. All GET-backed, no mutations.

**Convention established in M1:** Every tool file follows the pattern from `search-tickets.ts`: Zod input schema with `.describe()`, async handler, `AsdApiError` catch → `isError: true`, JSON-stringified output.

---

### Milestone 2A: `get_ticket` Tool

**Paste this into Claude Code:**

> Implement the `get_ticket` MCP tool. This retrieves full ticket detail including conversation history, latest AI prediction, and latest draft.
>
> **`src/tools/get-ticket.ts`:**
>
> Follow the exact same pattern as `search-tickets.ts`. Here's what's specific to this tool:
>
> **Tool name:** `get_ticket`
>
> **Title:** `Get Ticket Details`
>
> **Description:** `Get complete details for a specific ticket including the full conversation thread, latest AI triage prediction (if any), and latest AI-generated draft (if any). Use this after search_tickets to inspect a specific ticket before taking action.`
>
> **Input schema:**
> ```typescript
> {
>   ticket_id: z.string().uuid().describe('The ticket ID to retrieve'),
> }
> ```
>
> **Handler logic:**
> 1. Call `client.getTicket(args.ticket_id)`
> 2. Format the response to include:
>    - Ticket metadata: id, subject, status, priority, category, team, assignee, timestamps
>    - Conversation: array of messages with sender_type, body, is_internal, timestamp
>    - Latest prediction (if exists): predicted_category, predicted_priority, predicted_team, confidence, escalation_suggested, escalation_reason
>    - Latest draft (if exists): body (truncated to 500 chars in the summary), confidence, send_ready, approval_outcome, evidence_chunk_ids count
> 3. For the conversation, format messages as a readable thread:
>    ```
>    messages: [
>      { sender: "customer", body: "...", internal: false, sent_at: "..." },
>      { sender: "agent", body: "...", internal: false, sent_at: "..." },
>      { sender: "agent", body: "...", internal: true, sent_at: "..." },
>    ]
>    ```
>
> **Error handling:** Same pattern — catch `AsdApiError`, return `isError: true`. For 404, return a specific message: "Ticket not found: {ticket_id}".
>
> **Register in `src/tools/index.ts`:**
> ```typescript
> import { registerGetTicket } from './get-ticket.js';
> // In registerAllTools():
> registerGetTicket(server, client);
> ```

**Done when:**

- Add a test to `tests/client-test.ts`:
  - First call `search_tickets` to get a ticket ID
  - Then call `get_ticket` with that ID
  - Verify the response includes messages, prediction (may be null), and draft (may be null)
- A non-existent UUID returns a clean error, not a crash

---

### Milestone 2B: `search_knowledge` Tool

**Paste this into Claude Code:**

> Implement the `search_knowledge` MCP tool. This performs semantic search over the knowledge base and returns matching document chunks with similarity scores.
>
> **`src/tools/search-knowledge.ts`:**
>
> **Tool name:** `search_knowledge`
>
> **Title:** `Search Knowledge Base`
>
> **Description:** `Semantic search over the support knowledge base. Returns document chunks ranked by relevance with similarity scores. Use this to find documentation, FAQs, or policy information relevant to a customer's question.`
>
> **Input schema:**
> ```typescript
> {
>   query: z.string().min(1).describe('Search query — be specific for better results (e.g., "refund policy for annual plans" not just "refund")'),
>   top_k: z.number().int().min(1).max(20).optional().describe('Number of results to return (default: 5)'),
> }
> ```
>
> **Handler logic:**
> 1. Call `client.searchKnowledge(args.query, args.top_k)`
> 2. Format the response:
>    ```json
>    {
>      "query": "refund policy",
>      "results": [
>        {
>          "chunk_id": "uuid",
>          "document_title": "Billing FAQ",
>          "content": "Our refund policy allows...",
>          "similarity": 0.87,
>          "chunk_index": 3
>        }
>      ],
>      "result_count": 5
>    }
>    ```
> 3. Content should NOT be truncated — the LLM needs the full chunk text to use it as evidence
>
> **Note:** The ASD API endpoint is `GET /knowledge/search?q=...&top_k=5`. The response shape may be a flat list (not paginated) — check the ASD API's actual response and adapt the types in `asd-client/types.ts` if needed.
>
> **Register in `src/tools/index.ts`.**

**Done when:**

- Add a test to `tests/client-test.ts`:
  - Call `search_knowledge` with query "billing refund"
  - Verify results include document titles, content, and similarity scores
- Empty query returns a validation error (Zod `.min(1)` catches it)
- Results are ordered by similarity (highest first)

---

### Milestone 2C: `get_review_queue` Tool

**Paste this into Claude Code:**

> Implement the `get_review_queue` MCP tool. This lists AI-generated drafts that are pending human review.
>
> **`src/tools/get-review-queue.ts`:**
>
> **Tool name:** `get_review_queue`
>
> **Title:** `Get Review Queue`
>
> **Description:** `List AI-generated draft responses awaiting human review. Returns pending drafts ordered oldest-first (FIFO). Each item shows the draft body preview, confidence score, and associated ticket. Use review_draft to approve, reject, or escalate items from this queue.`
>
> **Input schema:**
> ```typescript
> {
>   page: z.number().int().min(1).optional().describe('Page number (default: 1)'),
>   per_page: z.number().int().min(1).max(50).optional().describe('Results per page (default: 25, max: 50)'),
> }
> ```
>
> **Handler logic:**
> 1. Call `client.getReviewQueue({ page: args.page, per_page: args.per_page })`
> 2. Format the response:
>    ```json
>    {
>      "pending_drafts": [
>        {
>          "draft_id": "uuid",
>          "ticket_id": "uuid",
>          "ticket_subject": "Invoice shows incorrect amount",
>          "draft_preview": "Thank you for reaching out about your invoice...",
>          "confidence": 0.85,
>          "created_at": "2025-03-20T10:30:00Z"
>        }
>      ],
>      "pagination": { "total": 42, "page": 1, "per_page": 25, "total_pages": 2 }
>    }
>    ```
> 3. Truncate draft body to 200 characters for the preview (full body is available via `get_ticket`)
>
> **Register in `src/tools/index.ts`.**

**Done when:**

- Add a test to `tests/client-test.ts`:
  - Call `get_review_queue` with default params
  - Verify results include draft previews, confidence scores, and ticket subjects
- If the user's JWT doesn't have agent/lead role, the ASD API returns 403 → tool returns clean error

---

### Milestone 2D: Read-Only Tools Verification

**This is a manual verification, not a coding step. Walk through it yourself.**

Run the updated test client (`npm run test:client`) and verify all 4 tools work:

**Test 1: Investigation workflow**
1. `search_tickets` with `status: "open"` → get a list
2. Pick the first ticket ID from results
3. `get_ticket` with that ID → verify messages and metadata are present
4. `search_knowledge` with a query based on the ticket's subject → verify results come back

**Test 2: Review queue**
1. `get_review_queue` → verify pending drafts are listed
2. Pick a draft's `ticket_id` → call `get_ticket` to see the full context

**Test 3: Error handling**
1. `get_ticket` with a random UUID → should return "Ticket not found" error
2. `search_knowledge` with empty string → should return Zod validation error
3. Stop the MCP server → test client should get a connection error, not crash

**Done when:** All 4 tools return real data from the ASD API. The investigation half of the support workflow is fully functional via MCP.

---

## Milestone 3 — Action Tools

**Goal:** Four mutation tools that complete the support operations loop — triage, draft generation, review, and ticket updates. POST/PATCH-backed, with real consequences on the ASD backend. After this milestone, the full workflow (search → triage → draft → review → close) is completable via MCP tools.

---

### Milestone 3A: `triage_ticket` Tool

**Paste this into Claude Code:**

> Implement the `triage_ticket` MCP tool. This triggers AI classification on a ticket and returns the prediction.
>
> **`src/tools/triage-ticket.ts`:**
>
> **Tool name:** `triage_ticket`
>
> **Title:** `Triage Ticket`
>
> **Description:** `Run AI triage on a ticket to classify its category, priority, team assignment, and escalation need. Returns a prediction with confidence score. This does NOT modify the ticket — it creates a separate prediction record. Run this before generate_draft to ensure the ticket is classified.`
>
> **Input schema:**
> ```typescript
> {
>   ticket_id: z.string().uuid().describe('The ticket ID to triage'),
> }
> ```
>
> **Handler logic:**
> 1. Call `client.triageTicket(args.ticket_id)`
> 2. Format the response:
>    ```json
>    {
>      "prediction": {
>        "ticket_id": "uuid",
>        "predicted_category": "billing",
>        "predicted_priority": "high",
>        "predicted_team": "billing_team",
>        "escalation_suggested": false,
>        "escalation_reason": null,
>        "confidence": 0.92
>      },
>      "latency_ms": 1340,
>      "note": "Prediction stored separately from ticket. Use update_ticket to apply these values."
>    }
>    ```
> 3. Include the `note` field — it tells the LLM that triage is read-only and it should use `update_ticket` if it wants to apply the classification
>
> **Important:** This calls the ASD AI pipeline (OpenAI) — it will be slower (1-3s) and costs real API credits. The test should still exercise it against the live API.
>
> **Error handling:**
> - 404 → "Ticket not found"
> - 403 → "Triage requires agent or lead role"
> - Timeout (if the OpenAI call takes too long) → the ASD API may return 504. Surface this as "Triage timed out — the AI backend may be under load. Try again."
>
> **Register in `src/tools/index.ts`.**

**Done when:**

- Add a test to `tests/client-test.ts`:
  - Pick a ticket from `search_tickets`
  - Call `triage_ticket` on it
  - Verify prediction includes category, priority, team, confidence
- Running triage on the same ticket twice returns two different prediction IDs (append-only)
- Response includes `latency_ms` showing how long the AI call took

---

### Milestone 3B: `generate_draft` Tool

**Paste this into Claude Code:**

> Implement the `generate_draft` MCP tool. This triggers the RAG-grounded draft generation pipeline.
>
> **`src/tools/generate-draft.ts`:**
>
> **Tool name:** `generate_draft`
>
> **Title:** `Generate Draft Response`
>
> **Description:** `Generate an AI draft response for a ticket using RAG-grounded evidence from the knowledge base. The AI retrieves relevant documentation, then writes a response with citations. Returns the draft body, cited evidence, confidence score, and whether the draft is ready to send. Drafts are created with "pending" approval status — use review_draft to approve or reject.`
>
> **Input schema:**
> ```typescript
> {
>   ticket_id: z.string().uuid().describe('The ticket ID to generate a draft for'),
> }
> ```
>
> **Handler logic:**
> 1. Call `client.generateDraft(args.ticket_id)`
> 2. Format the response:
>    ```json
>    {
>      "draft": {
>        "id": "uuid",
>        "ticket_id": "uuid",
>        "body": "Thank you for reaching out about your billing concern...",
>        "confidence": 0.85,
>        "send_ready": true,
>        "evidence_chunks_cited": 3,
>        "unresolved_questions": [],
>        "approval_status": "pending"
>      },
>      "latency_ms": 4200,
>      "next_steps": "Use review_draft to approve, reject, or escalate this draft."
>    }
>    ```
> 3. Include `evidence_chunks_cited` as a count (not the full chunk IDs — those are in the ticket detail)
> 4. Include `next_steps` to guide the LLM toward the review workflow
>
> **Important:** This is the slowest tool — the ASD backend calls OpenAI for embedding + generation with tool use. Expect 3-8 seconds. The MCP protocol handles this fine (no timeout issue at the MCP level), but the ASD API itself might time out if Railway's request timeout is hit.
>
> **Error handling:**
> - Same patterns as triage_ticket
> - If the draft body is empty or the pipeline failed, the ASD API should still return a record with low confidence — surface whatever comes back
>
> **Register in `src/tools/index.ts`.**

**Done when:**

- Add a test to `tests/client-test.ts`:
  - Pick a ticket, triage it first, then generate a draft
  - Verify draft includes body text, confidence, send_ready flag
- Draft with `send_ready: false` should have `unresolved_questions` populated
- Response includes `latency_ms`

---

### Milestone 3C: `review_draft` Tool

**Paste this into Claude Code:**

> Implement the `review_draft` MCP tool. This submits an approval decision on a pending draft.
>
> **`src/tools/review-draft.ts`:**
>
> **Tool name:** `review_draft`
>
> **Title:** `Review Draft`
>
> **Description:** `Submit a review decision on an AI-generated draft. Actions: "approved" (send as-is), "edited_and_approved" (send with edits — provide edited_body), "rejected" (discard — provide reason), "escalated" (flag for senior review). Use get_review_queue or get_ticket to see pending drafts first.`
>
> **Input schema:**
> ```typescript
> {
>   draft_id: z.string().uuid().describe('The draft generation ID to review'),
>   action: z
>     .enum(['approved', 'edited_and_approved', 'rejected', 'escalated'])
>     .describe('Review decision'),
>   edited_body: z
>     .string()
>     .optional()
>     .describe('Required when action is "edited_and_approved" — the revised draft text'),
>   reason: z
>     .string()
>     .optional()
>     .describe('Optional reason for rejection or escalation'),
> }
> ```
>
> **Handler logic:**
> 1. Validate: if `action` is `edited_and_approved` and `edited_body` is missing, return an error (don't rely on the ASD API to catch this — validate client-side for a better error message)
> 2. Call `client.reviewDraft(args.draft_id, { action: args.action, edited_body: args.edited_body, reason: args.reason })`
> 3. Format the response:
>    ```json
>    {
>      "review": {
>        "draft_id": "uuid",
>        "action": "approved",
>        "result": "Draft approved and ticket status updated to pending_customer."
>      }
>    }
>    ```
> 4. The `result` message should vary based on action:
>    - `approved` → "Draft approved and ticket status updated to pending_customer."
>    - `edited_and_approved` → "Draft edited and approved. Ticket status updated to pending_customer."
>    - `rejected` → "Draft rejected. Generate a new draft with generate_draft if needed."
>    - `escalated` → "Draft escalated for senior review."
>
> **Register in `src/tools/index.ts`.**

**Done when:**

- Add a test to `tests/client-test.ts`:
  - Get a draft from the review queue
  - Call `review_draft` with action "approved"
  - Verify the review is recorded
- `edited_and_approved` without `edited_body` returns a validation error (client-side, not from ASD API)
- Reviewing an already-reviewed draft returns an appropriate error from the ASD API

---

### Milestone 3D: `update_ticket` Tool

**Paste this into Claude Code:**

> Implement the `update_ticket` MCP tool. This updates ticket fields like status, priority, category, team, and assignment.
>
> **`src/tools/update-ticket.ts`:**
>
> **Tool name:** `update_ticket`
>
> **Title:** `Update Ticket`
>
> **Description:** `Update ticket fields: status, priority, category, team, or assignee. All fields are optional — only provided fields are updated. Use this after triage_ticket to apply predicted values, or to manually adjust ticket properties.`
>
> **Input schema:**
> ```typescript
> {
>   ticket_id: z.string().uuid().describe('The ticket ID to update'),
>   status: z
>     .enum(['open', 'in_progress', 'pending_customer', 'pending_internal', 'resolved', 'closed'])
>     .optional()
>     .describe('New status'),
>   priority: z
>     .enum(['low', 'medium', 'high', 'critical'])
>     .optional()
>     .describe('New priority level'),
>   category: z
>     .enum([
>       'billing',
>       'bug_report',
>       'feature_request',
>       'account_access',
>       'integration',
>       'api_issue',
>       'onboarding',
>       'data_export',
>     ])
>     .optional()
>     .describe('New category'),
>   team: z.string().optional().describe('New team assignment'),
>   assignee_id: z.string().uuid().optional().describe('New assignee user ID'),
> }
> ```
>
> **Handler logic:**
> 1. Validate: at least one field beyond `ticket_id` must be provided. If all optional fields are undefined, return an error: "At least one field to update must be provided."
> 2. Build the updates object with only the provided fields
> 3. Call `client.updateTicket(args.ticket_id, updates)`
> 4. Format the response:
>    ```json
>    {
>      "updated_ticket": {
>        "id": "uuid",
>        "subject": "Invoice shows incorrect amount",
>        "status": "in_progress",
>        "priority": "high",
>        "category": "billing",
>        "team": "billing_team",
>        "assignee": "Jane Smith"
>      },
>      "fields_changed": ["status", "priority"]
>    }
>    ```
> 5. Include `fields_changed` — a list of which fields were actually provided in the update. This helps the LLM confirm what changed.
>
> **Register in `src/tools/index.ts`.**

**Done when:**

- Add a test to `tests/client-test.ts`:
  - Pick a ticket, update its status to "in_progress"
  - Verify the response shows the new status
  - Call `get_ticket` to confirm the change persisted
- Calling with no update fields returns a validation error
- Calling with a non-existent ticket ID returns "Ticket not found"

---

### Milestone 3E: Full Workflow Verification

**This is a manual verification, not a coding step. Walk through it yourself using the test client or by adding these as test cases.**

Test the complete support operations workflow end-to-end:

**Test 1: Standard ticket resolution**
1. `search_tickets` with `status: "open"` → pick a ticket
2. `get_ticket` → read the conversation
3. `triage_ticket` → get classification
4. `update_ticket` → apply the triage prediction (category, priority, team)
5. `generate_draft` → get an AI draft with citations
6. `review_draft` with action `approved` → approve it
7. `update_ticket` with `status: "resolved"` → close the loop

**Test 2: Low confidence → rejection → redraft**
1. Find or create a ticket about an obscure topic
2. `generate_draft` → should have low confidence / `send_ready: false`
3. `review_draft` with action `rejected` and reason "insufficient evidence"
4. `generate_draft` again → creates a new draft (previous one preserved)

**Test 3: Knowledge-driven workflow**
1. `search_knowledge` with "refund policy" → find relevant docs
2. `search_tickets` with `category: "billing"` → find a billing ticket
3. `generate_draft` → the draft should cite knowledge base chunks

**Test 4: Error resilience**
1. Use an expired JWT → all tools should return clean auth errors
2. Call `triage_ticket` on a non-existent ticket → clean 404 error
3. Call `update_ticket` with no fields → clean validation error

**Performance check:**
- `search_tickets`: < 500ms
- `get_ticket`: < 500ms
- `search_knowledge`: < 1s
- `triage_ticket`: < 3s
- `generate_draft`: < 8s
- `review_draft`: < 500ms
- `update_ticket`: < 500ms

**Done when:** All 4 test scenarios pass. The full support operations workflow is completable via MCP tools. This validates Milestones 1–3 before moving to hardening, demo, and polish.

---

## What's in Part 2 (Milestones 4–6)

Written after Part 1 is implemented, referencing real code:

- **Milestone 4: Hardening** — MCP-spec error codes, Zod validation edge cases, timeout handling for slow AI endpoints, graceful degradation when ASD is unreachable, consistent error shapes, request logging
- **Milestone 5: Claude Desktop Integration & Demo** — Claude Desktop config (stdio mode with mcp-remote bridge or native Streamable HTTP), Claude Code config (`claude mcp add-json`), end-to-end demo testing, GIF recording, written walkthrough script
- **Milestone 6: README & Repo Polish** — Portfolio-grade README (GIF above fold, architecture diagram, tool reference table, setup guide, extension points), `package.json` publishability audit, `npm pack` verification, clean git history, LICENSE

---

## Risk Register

| Risk | Impact | Mitigation |
| - | - | - |
| ASD live API is down or JWT expired during development | Blocks all testing | Start ASD locally as fallback. Document both paths in CLAUDE.md |
| MCP SDK API changes between now and implementation | Code breaks on install | Pin `@modelcontextprotocol/sdk` version in package.json. Check changelog before starting |
| ASD API response shapes don't match the types in `asd-client/types.ts` | Runtime type mismatches | Verify each type against real API responses during M1E. Fix types before proceeding |
| `generate_draft` is too slow (>8s) for good demo experience | Demo feels sluggish | Note in README that draft generation involves a live AI pipeline. Consider mock mode for faster demos |
| Claude Desktop doesn't support Streamable HTTP natively yet for local servers | Primary demo path broken | Support stdio transport (already planned). Use `mcp-remote` npm bridge as documented fallback |
| Stateless HTTP creates a new McpServer per request — performance concern | Slow under load | Acceptable for a portfolio piece. Document the stateful extension path for production use |
| Zod v3 vs v4 compatibility with MCP SDK | Import errors | SDK supports both via `zod/v3` and `zod/v4` imports. Use whichever the installed version provides |

---

## Appendix: ASD API Endpoint Mapping

| MCP Tool | ASD Endpoint | Method | Auth |
| - | - | - | - |
| `search_tickets` | `/tickets` | GET | Bearer |
| `get_ticket` | `/tickets/{id}` | GET | Bearer |
| `triage_ticket` | `/tickets/{id}/triage` | POST | Agent/Lead |
| `generate_draft` | `/tickets/{id}/draft` | POST | Agent/Lead |
| `update_ticket` | `/tickets/{id}` | PATCH | Bearer |
| `search_knowledge` | `/knowledge/search` | GET | Bearer |
| `get_review_queue` | `/drafts/review-queue` | GET | Agent/Lead |
| `review_draft` | `/drafts/{id}/review` | POST | Agent/Lead |
