# Conway Platform — Complete API Reference

> Extracted from [docs.conway.tech](https://docs.conway.tech) on 2026-02-26.
> This is a local summary for quick reference.

---

## Authentication

All requests require:
```
Authorization: Bearer cnwy_k_YOUR_API_KEY
```

## Base URLs

| Service | URL |
|---------|-----|
| Cloud API | `https://api.conway.tech/v1` |
| Inference | `https://inference.conway.tech/v1` |

---

## Conway Cloud — Sandboxes (Linux VMs)

Each sandbox is a full Linux VM (configurable vCPU/RAM/disk). Regions: `eu-north`, `us-east`.

### Create Sandbox
```
POST /v1/sandboxes
```
**Body:** `{ name, vcpu, memory_mb, disk_gb, region }`
**Response:**
```json
{
  "id": "abc123def456...",
  "short_id": "sbx-abc123",
  "name": "my-dev-sandbox",
  "status": "running",
  "terminal_url": "https://sbx-abc123.life.conway.tech",
  "vcpu": 2, "memory_mb": 2048, "disk_gb": 10,
  "region": "us-east"
}
```
**Cost:** Uses Conway credits. Returns 402 if insufficient.

### Get Sandbox
```
GET /v1/sandboxes/:id
```
**Cost:** FREE (read-only)

### List Sandboxes
```
GET /v1/sandboxes
```
**Response:** `{ "data": [ { id, status, runtime, ... } ] }`
**Cost:** FREE (read-only)

### Delete Sandbox
```
DELETE /v1/sandboxes/:id
```

---

## Conway Cloud — Command Execution

### Run Command
```
POST /v1/sandboxes/:id/exec
```
**Body:** `{ command, timeout_ms? }`
**Response:** `{ stdout, stderr, exit_code }`

### Run Code
```
POST /v1/sandboxes/:id/run
```
**Body:** `{ language, code, timeout_ms? }`
**Response:** `{ stdout, stderr, exit_code }`

---

## Conway Cloud — Files

### Upload File
```
POST /v1/sandboxes/:id/files
```
**Body:** `{ path, content }` (base64 or string)

### Download File
```
GET /v1/sandboxes/:id/files?path=/path/to/file
```
**Cost:** FREE (read-only)

### List Files
```
GET /v1/sandboxes/:id/files/list?path=/&recursive=true
```
**Response:** Array of `{ name, path, type, size }`
**Cost:** FREE (read-only)

---

## Conway Cloud — PTY Sessions (Interactive Terminals)

### Create PTY Session
```
POST /v1/sandboxes/:id/pty
```
**Body:** `{ command?, rows?, cols? }`
**Response:** `{ id, status }`

### Write to PTY
```
POST /v1/sandboxes/:id/pty/:ptyId/write
```
**Body:** `{ input }` (supports `\n`, `\t`, `\x03` for Ctrl+C)

### Read from PTY
```
GET /v1/sandboxes/:id/pty/:ptyId/read?timeout_ms=5000
```
**Cost:** FREE (read-only)

### Resize PTY
```
POST /v1/sandboxes/:id/pty/:ptyId/resize
```
**Body:** `{ rows, cols }`

### Close PTY Session
```
DELETE /v1/sandboxes/:id/pty/:ptyId
```

### List PTY Sessions
```
GET /v1/sandboxes/:id/pty
```
**Cost:** FREE (read-only)

---

## Conway Cloud — Web Terminal

### Create Terminal Session
```
POST /v1/sandboxes/:id/terminal-session
```
**Response:** `{ terminal_url }` (expiring URL with auth token)
Session lifetime: 30-day sliding TTL.

---

## Conway Cloud — Ports & Custom Domains

### Expose Port
```
POST /v1/sandboxes/:id/ports
```
**Body:** `{ port, subdomain? }`
**Response:** `{ url, port, subdomain }`
URL format: `https://{short_id}-{port}.life.conway.tech`

### Unexpose Port
```
DELETE /v1/sandboxes/:id/ports/:port
```

---

## Conway Compute — Inference

Multi-provider LLM API. All providers return OpenAI-compatible format.

### Chat Completions
```
POST /v1/chat/completions   (on inference.conway.tech)
```
**Body:** `{ model, messages, stream?, temperature?, max_tokens?, tools?, tool_choice? }`
**Billing:** Credits deducted after response completes. Min balance: 10 cents.

### Supported Models

| Provider | Models |
|----------|--------|
| OpenAI | `gpt-5.2`, `gpt-5.2-codex`, `gpt-5-mini`, `gpt-5-nano` |
| Anthropic | `claude-opus-4.6`, `claude-opus-4.5`, `claude-sonnet-4.5`, `claude-haiku-4.5` |
| Google | `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-3-pro`, `gemini-3-flash` |
| Moonshot | `kimi-k2.5` |
| Qwen | `qwen3-coder` |

---

## Conway Credits

### Get Balance
```
GET /v1/credits/balance
```
**Response:** `{ creditsCents }` **Cost:** FREE

### Credits History
```
GET /v1/credits/history?limit=50&offset=0
```
**Response:** Array of transactions with amounts, types, timestamps. **Cost:** FREE

### Credits Pricing
```
GET /v1/credits/pricing
```
**Response:** Available pricing tiers. **Cost:** FREE

### Transfer Credits
```
POST /v1/credits/transfer
```
**Body:** `{ toAddress, amountCents, note? }`

---

## Conway Domains

### Search Domains
```
GET /v1/domains/search?query=mysite&tlds=com,tech
```
**Cost:** FREE

### Register Domain
```
POST /v1/domains/register
```
**Body:** `{ domain, years? }`
**Payment:** USDC via x402

### List DNS Records
```
GET /v1/domains/:domain/dns
```
**Cost:** FREE

### Add/Update/Delete DNS
```
POST   /v1/domains/:domain/dns        (add)
PUT    /v1/domains/:domain/dns/:id     (update)
DELETE /v1/domains/:domain/dns/:id     (delete)
```

---

## Automatons — Identity Registration

### Register Automaton
```
POST /v1/automatons/register
```
**Body:** EIP-712 signed payload with `{ automatonAddress, creatorAddress, name, bio?, genesisPromptHash? }`
One-time, immutable. Creates permanent cryptographic identity.

---

## Free GET Endpoints (Safe for Dashboard)

These endpoints are read-only and should not cost credits:

| Endpoint | Use |
|----------|-----|
| `GET /v1/sandboxes` | List all VMs padre has created |
| `GET /v1/sandboxes/:id` | Get details of specific VM |
| `GET /v1/sandboxes/:id/files/list?path=/` | List files in a VM |
| `GET /v1/sandboxes/:id/pty` | List active PTY sessions |
| `GET /v1/credits/balance` | Live credit balance |
| `GET /v1/credits/history` | Credit transaction history |
| `GET /v1/credits/pricing` | VM pricing tiers |
| `GET /v1/domains/search?query=...` | Search available domains |
| `GET /v1/domains/:domain/dns` | DNS records for owned domains |
