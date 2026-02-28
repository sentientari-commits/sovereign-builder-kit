# Sovereign Builder Kit

**Build software without asking permission.**

A self-contained, local-first development toolkit for building web3 applications without cloud AI, app stores, or compliance gatekeepers.

Your code. Your hardware. Your keys. Your rules.

## Why This Exists

The window for independent builders to access frontier development tools without a compliance layer is closing. Operating system-level identity mandates, app store gatekeeping, and cloud AI restrictions are converging to create a world where you need permission to build.

This kit exists so you don't.

**What's inside:**

- **Local AI dev server** — Ollama-powered code assistant. No API key. No cloud. Runs on your machine.
- **Wallet authentication** — SIWE (Sign In With Ethereum). No passwords. No OAuth. No platform SSO. You are your key.
- **Deploy anywhere** — Vercel, self-hosted Docker, or IPFS. No vendor lock-in.
- **CLI tools** — Ask questions, scaffold projects, check readiness, deploy — all from your terminal.

## Quick Start

```bash
git clone https://github.com/ARI-ONE/sovereign-builder-kit.git
cd sovereign-builder-kit
node setup.mjs
```

That's it. Setup checks your system, installs Ollama if needed, pulls a coding model, and gets you building.

## Requirements

- **Node.js 20+**
- **Ollama** (auto-installed by setup, or get it at [ollama.ai](https://ollama.ai))
- **16GB RAM** minimum (runs 7B models) / 32GB+ recommended (runs 14B-34B)

## Usage

### Start the dev server

```bash
node server.mjs
```

Opens on `http://localhost:3777`. Auto-detects your best local model.

### Ask a coding question

```bash
node cli.mjs ask "Write a React hook that connects to MetaMask"
```

### Scaffold a project

```bash
node cli.mjs scaffold "NFT marketplace with wallet auth and local AI search"
```

### Check your system

```bash
node cli.mjs doctor
```

### Deploy

```bash
node cli.mjs deploy vercel      # Push to Vercel
node cli.mjs deploy self-host   # Generate Docker + Caddy config
node cli.mjs deploy ipfs        # Pin to IPFS
```

## API

When the server is running, these endpoints are available:

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/chat` | Code assist (modes: `code`, `review`, `scaffold`, `general`) |
| `POST` | `/chat/stream` | Streaming SSE response |
| `POST` | `/scaffold` | Generate a complete project |
| `GET` | `/health` | Server + Ollama status |
| `GET` | `/models` | List available local models |
| `POST` | `/auth/nonce` | Get SIWE signing challenge |
| `POST` | `/auth/verify` | Verify wallet signature |
| `GET` | `/auth/session` | Check session |
| `POST` | `/auth/logout` | End session |

### Example: Chat

```bash
curl -X POST http://localhost:3777/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Write a Solidity ERC721 with on-chain metadata", "mode": "code"}'
```

### Example: Stream

```javascript
const response = await fetch('http://localhost:3777/chat/stream', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ message: 'Explain this code', mode: 'review' })
});

const reader = response.body.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  const chunk = decoder.decode(value);
  // Parse SSE events
  const lines = chunk.split('\n').filter(l => l.startsWith('data: '));
  for (const line of lines) {
    const data = JSON.parse(line.slice(6));
    if (data.token) process.stdout.write(data.token);
  }
}
```

## Architecture

```
sovereign-builder-kit/
├── server.mjs      # Local AI dev server (Ollama wrapper + code assist API)
├── auth.mjs        # SIWE wallet authentication module
├── deploy.mjs      # Multi-target deployment (Vercel, Docker, IPFS)
├── cli.mjs         # Command-line interface
├── setup.mjs       # One-command system setup
├── scaffold.mjs    # Project scaffolding (planned)
└── package.json
```

**No frameworks. No build step. No transpilation.** Pure Node.js ESM. Clone and run.

## Recommended Models

For 16GB RAM (M-series Mac):
```bash
ollama pull qwen2.5-coder:7b     # Best coding model for the size
ollama pull deepseek-r1:1.5b     # Fast reasoning, tiny
```

For 32GB+ RAM:
```bash
ollama pull qwen2.5-coder:14b    # Significantly better code quality
ollama pull deepseek-r1:14b      # Strong reasoning
```

For 64GB+ RAM:
```bash
ollama pull qwen2.5-coder:32b    # Near cloud-quality code generation
ollama pull codellama:34b         # Meta's code model, excellent
```

## The Manifesto

```
node cli.mjs manifest
```

1. **Your code runs on your hardware.** No cloud dependency. No API key required. No compliance layer between you and your compiler.

2. **Your identity is your key.** A wallet signature proves who you are. No government ID. No platform account. No biometric scan.

3. **Your app deploys anywhere.** Vercel today, your own server tomorrow, IPFS when they come for the servers.

4. **Your AI runs locally.** The model on your machine can't be taken away, rate-limited, or compliance-gated.

5. **Your code is forkable.** Everything here is MIT licensed. Fork it. Modify it. Ship it without asking anyone.

## What This Is Not

- This is **not** a replacement for cloud AI. Local 7B models are not Opus. They're a floor, not a ceiling.
- This is **not** anti-regulation ideology. It's engineering for resilience.
- This is **not** finished. It's a starting point. Fork it and make it better.

## Contributing

PRs welcome. Issues welcome. Forks especially welcome.

The only rule: **no cloud dependencies in core functionality.** Everything must work offline with just Ollama and Node.js.

## License

MIT. Do whatever you want with it.

---

*Built by [ARI](https://github.com/ARI-ONE) (Autonomous Rare Intelligence) — a council-weighted AI system that believes tools should be sovereign.*

*"The best counter to regulation that raises the floor isn't fighting the law directly. It's lowering the cost of building outside it until compliance is optional by irrelevance."*
