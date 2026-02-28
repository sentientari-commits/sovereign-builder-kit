#!/usr/bin/env node

/**
 * Sovereign Builder Kit — Local AI Dev Server
 *
 * Wraps Ollama into a code-assist API that any frontend can call.
 * No cloud. No API keys. No compliance layer. Runs on your machine.
 */

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PORT = process.env.SBK_PORT || 3776;
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';

// ── Model selection ────────────────────────────────────────────────
// Auto-detect best available model on startup

async function detectBestModel() {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`);
    const data = await res.json();
    const models = data.models?.map(m => m.name) || [];

    // Preference order: best coding model first
    const preferred = [
      'qwen2.5-coder:14b',
      'qwen2.5-coder:7b',
      'codellama:13b',
      'codellama:7b',
      'deepseek-coder-v2:16b',
      'deepseek-r1:14b',
      'deepseek-r1:7b',
      'deepseek-r1:1.5b',
      'llama3.2:latest',
      'mistral:latest',
    ];

    for (const model of preferred) {
      if (models.some(m => m.startsWith(model.split(':')[0]))) {
        const match = models.find(m => m.startsWith(model.split(':')[0]));
        return match;
      }
    }

    // Fall back to whatever is available
    return models[0] || 'qwen2.5-coder:7b';
  } catch {
    return 'qwen2.5-coder:7b';
  }
}

// ── Ollama proxy with code-assist prompts ──────────────────────────

const SYSTEM_PROMPTS = {
  code: `You are a local code assistant. You write clean, working code. No preamble, no apologies, no warnings about AI limitations. Just write the code. If asked to explain, be brief and direct.`,

  review: `You are a code reviewer. Point out bugs, security issues, and improvements. Be direct. No fluff. Format: file:line — issue — fix.`,

  scaffold: `You are a project scaffolder. When asked to create a project, output the complete file contents for each file. Use this format:
--- FILE: path/to/file ---
(contents)
--- END FILE ---

Always include: package.json, main entry point, and a README with one-command setup.`,

  general: `You are a helpful local AI assistant. Be concise and direct.`
};

async function queryOllama(model, messages, stream = false) {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      stream,
      options: {
        temperature: 0.3,
        num_predict: 4096,
      }
    })
  });

  if (!res.ok) {
    throw new Error(`Ollama error: ${res.status} ${await res.text()}`);
  }

  if (stream) {
    return res;
  }

  const data = await res.json();
  return data.message?.content || '';
}

// ── HTTP Server ────────────────────────────────────────────────────

let activeModel = null;

async function handleRequest(req, res) {
  // CORS for local dev
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  // ── GET /health ──
  if (url.pathname === '/health') {
    let ollamaOk = false;
    try {
      const check = await fetch(`${OLLAMA_URL}/api/tags`);
      ollamaOk = check.ok;
    } catch {}

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      model: activeModel,
      ollama: ollamaOk ? 'connected' : 'disconnected',
      port: PORT,
    }));
    return;
  }

  // ── GET /models ──
  if (url.pathname === '/models') {
    try {
      const check = await fetch(`${OLLAMA_URL}/api/tags`);
      const data = await check.json();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        active: activeModel,
        available: data.models?.map(m => ({
          name: m.name,
          size: m.size,
          modified: m.modified_at,
        })) || []
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Ollama not reachable', detail: err.message }));
    }
    return;
  }

  // ── POST /chat ──
  if (url.pathname === '/chat' && req.method === 'POST') {
    const body = await readBody(req);
    const { message, mode = 'general', history = [], model } = body;

    if (!message) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'message required' }));
      return;
    }

    const useModel = model || activeModel;
    const systemPrompt = SYSTEM_PROMPTS[mode] || SYSTEM_PROMPTS.general;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...history.slice(-10), // Keep last 10 for context window management
      { role: 'user', content: message }
    ];

    try {
      const response = await queryOllama(useModel, messages);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        response,
        model: useModel,
        mode,
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // ── POST /chat/stream ──
  if (url.pathname === '/chat/stream' && req.method === 'POST') {
    const body = await readBody(req);
    const { message, mode = 'general', history = [], model } = body;

    const useModel = model || activeModel;
    const systemPrompt = SYSTEM_PROMPTS[mode] || SYSTEM_PROMPTS.general;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...history.slice(-10),
      { role: 'user', content: message }
    ];

    try {
      const ollamaRes = await queryOllama(useModel, messages, true);
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      // Stream Ollama response through as SSE
      const reader = ollamaRes.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n').filter(Boolean);

        for (const line of lines) {
          try {
            const parsed = JSON.parse(line);
            if (parsed.message?.content) {
              res.write(`data: ${JSON.stringify({ token: parsed.message.content })}\n\n`);
            }
            if (parsed.done) {
              res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
            }
          } catch {}
        }
      }

      res.end();
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // ── POST /scaffold ──
  if (url.pathname === '/scaffold' && req.method === 'POST') {
    const body = await readBody(req);
    const { description, framework = 'vanilla' } = body;

    if (!description) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'description required' }));
      return;
    }

    const prompt = `Create a ${framework} web project: ${description}

Requirements:
- Use wallet authentication (SIWE or ethers.js) — NO passwords, NO OAuth
- Deploy-anywhere (works on Vercel, self-hosted, or IPFS)
- No cloud AI dependencies — use local Ollama API at http://localhost:11434 if AI is needed
- Include package.json with exact dependency versions
- Include a one-command setup in README

Output every file needed.`;

    const messages = [
      { role: 'system', content: SYSTEM_PROMPTS.scaffold },
      { role: 'user', content: prompt }
    ];

    try {
      const response = await queryOllama(activeModel, messages);

      // Parse files from response
      const files = parseScaffoldOutput(response);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ files, raw: response }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // ── GET / — serve dashboard ──
  if (url.pathname === '/') {
    try {
      const html = await readFile(join(__dirname, 'dashboard.html'), 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    } catch {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(generateFallbackDashboard());
    }
    return;
  }

  // ── 404 ──
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
}

// ── Helpers ────────────────────────────────────────────────────────

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(data)); }
      catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

function parseScaffoldOutput(text) {
  const files = [];
  const regex = /---\s*FILE:\s*(.+?)\s*---\n([\s\S]*?)(?=---\s*(?:FILE:|END FILE))/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    files.push({ path: match[1].trim(), content: match[2].trim() });
  }
  return files;
}

function generateFallbackDashboard() {
  return `<!DOCTYPE html>
<html><head><title>Sovereign Builder Kit</title>
<style>
  * { margin: 0; box-sizing: border-box; }
  body { background: #0a0a0a; color: #e0e0e0; font-family: 'SF Mono', 'Fira Code', monospace; padding: 2rem; }
  h1 { color: #00ff88; margin-bottom: 0.5rem; }
  .sub { color: #666; margin-bottom: 2rem; }
  .status { padding: 1rem; border: 1px solid #222; border-radius: 4px; margin-bottom: 1rem; }
  .status.ok { border-color: #00ff88; }
  .status.err { border-color: #ff4444; }
  pre { background: #111; padding: 1rem; border-radius: 4px; overflow-x: auto; margin: 1rem 0; }
  code { color: #00ff88; }
</style></head>
<body>
  <h1>SOVEREIGN BUILDER KIT</h1>
  <p class="sub">Local AI + Wallet Auth + No Gatekeepers</p>
  <div class="status" id="status">Checking...</div>
  <h2>API</h2>
  <pre><code>POST /chat          — AI code assist (modes: code, review, scaffold, general)
POST /chat/stream   — Streaming AI response (SSE)
POST /scaffold      — Generate a full project
GET  /health        — Server + Ollama status
GET  /models        — List available local models</code></pre>
  <h2>Quick Test</h2>
  <pre><code>curl -X POST http://localhost:${PORT}/chat \\
  -H "Content-Type: application/json" \\
  -d '{"message": "Write a React component with SIWE login", "mode": "code"}'</code></pre>
  <script>
    fetch('/health').then(r=>r.json()).then(d=>{
      const el = document.getElementById('status');
      el.className = 'status ok';
      el.innerHTML = 'Model: <b>'+d.model+'</b> | Ollama: <b>'+d.ollama+'</b> | Port: <b>'+d.port+'</b>';
    }).catch(()=>{
      document.getElementById('status').className='status err';
      document.getElementById('status').textContent='Server error';
    });
  </script>
</body></html>`;
}

// ── Start ──────────────────────────────────────────────────────────

const server = http.createServer(handleRequest);

activeModel = await detectBestModel();

server.listen(PORT, () => {
  console.log('');
  console.log('  ┌─────────────────────────────────────────┐');
  console.log('  │       SOVEREIGN BUILDER KIT v0.1.0       │');
  console.log('  │   Local AI · No Cloud · No Gatekeepers   │');
  console.log('  └─────────────────────────────────────────┘');
  console.log('');
  console.log(`  Server:  http://localhost:${PORT}`);
  console.log(`  Model:   ${activeModel}`);
  console.log(`  Ollama:  ${OLLAMA_URL}`);
  console.log('');
  console.log('  Endpoints:');
  console.log('    POST /chat          — Code assist');
  console.log('    POST /chat/stream   — Streaming response');
  console.log('    POST /scaffold      — Generate project');
  console.log('    GET  /health        — Status check');
  console.log('    GET  /models        — Available models');
  console.log('');
});
