# Getting Started

## Prerequisites

- Node.js 20+
- An ASD JWT (see below)

## Install

```bash
git clone <repo-url>
cd support-ops-mcp
npm install
```

## Configure

```bash
cp .env.example .env
# Edit .env — set ASD_API_URL and ASD_JWT
```

## Getting an ASD JWT

1. Open <https://agent-service-desk.vercel.app>
2. Log in with `agent@demo.com` / `agent123`
3. Open browser DevTools → Network tab
4. Click any request to the API backend (`agent-service-desk-production.up.railway.app`)
5. Copy the `Authorization` header value — it starts with `Bearer `. Paste everything **after** `Bearer ` into your config's `ASD_JWT` field

> **Note:** Demo JWTs expire after 1 hour. For longer-lived tokens, use the ASD project's `seed/mint_tokens.py` script, which signs tokens offline with a configurable expiry.

## Use with Claude Code

```bash
cp .mcp.json.example .mcp.json
# Edit .mcp.json — paste your JWT into the ASD_JWT field
# Restart Claude Code — support-ops appears in the MCP tool list
```

## Use with Codex CLI

```bash
cp .codex/config.toml.example .codex/config.toml
# Edit .codex/config.toml — paste your JWT into the ASD_JWT field
# Restart Codex — support-ops appears in the tool list
```

## Run standalone (HTTP mode)

```bash
npm run dev
# Server starts on http://localhost:3001
```

## Run standalone (stdio mode)

```bash
TRANSPORT=stdio npm run dev
```
