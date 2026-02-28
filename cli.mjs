#!/usr/bin/env node

/**
 * sbk — Sovereign Builder Kit CLI
 *
 * Your local-first development companion. No cloud required.
 *
 * Commands:
 *   sbk start          — Start the local AI dev server
 *   sbk ask <question>  — Ask the local AI a coding question
 *   sbk scaffold <desc> — Generate a complete project
 *   sbk models          — List available local models
 *   sbk pull <model>    — Pull a new model from Ollama
 *   sbk deploy <target> — Deploy (vercel | self-host | ipfs)
 *   sbk doctor          — Check system readiness
 *   sbk manifest        — Print the manifesto
 */

import { execSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const command = args[0] || 'help';
const rest = args.slice(1).join(' ');

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const SBK_URL = process.env.SBK_URL || 'http://localhost:3776';

// ── Colors (no dependencies) ──────────────────────────────────────

const c = {
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

// ── Commands ──────────────────────────────────────────────────────

async function start() {
  console.log(c.green('\n  Starting Sovereign Builder Kit...\n'));
  const server = spawn('node', [join(__dirname, 'server.mjs')], {
    stdio: 'inherit',
    env: { ...process.env },
  });
  server.on('exit', (code) => process.exit(code));
}

async function ask() {
  if (!rest) {
    console.log(c.red('  Usage: sbk ask <your question>'));
    process.exit(1);
  }

  // Try SBK server first, fall back to direct Ollama
  try {
    const res = await fetch(`${SBK_URL}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: rest, mode: 'code' }),
    });
    const data = await res.json();
    console.log('\n' + data.response + '\n');
    console.log(c.dim(`  [${data.model} via SBK]`));
  } catch {
    // Direct Ollama fallback
    console.log(c.dim('  SBK server not running, querying Ollama directly...\n'));
    try {
      const res = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'qwen2.5-coder:7b',
          messages: [
            { role: 'system', content: 'You are a local code assistant. Be concise and direct.' },
            { role: 'user', content: rest },
          ],
          stream: false,
        }),
      });
      const data = await res.json();
      console.log(data.message?.content || 'No response');
    } catch (err) {
      console.log(c.red('  Ollama not reachable. Run: ollama serve'));
    }
  }
}

async function scaffold() {
  if (!rest) {
    console.log(c.red('  Usage: sbk scaffold <project description>'));
    process.exit(1);
  }

  console.log(c.cyan(`\n  Scaffolding: ${rest}\n`));

  try {
    const res = await fetch(`${SBK_URL}/scaffold`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: rest }),
    });
    const data = await res.json();

    if (data.files && data.files.length > 0) {
      console.log(c.green(`  Generated ${data.files.length} files:\n`));
      for (const file of data.files) {
        console.log(`  ${c.cyan(file.path)}`);
      }
      console.log(c.dim('\n  Use /scaffold with the SBK dashboard to write files to disk.'));
    } else {
      console.log(data.raw || 'No scaffold output');
    }
  } catch {
    console.log(c.red('  SBK server not running. Start it first: sbk start'));
  }
}

async function models() {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`);
    const data = await res.json();
    const list = data.models || [];

    console.log(c.bold('\n  Local Models\n'));

    if (list.length === 0) {
      console.log(c.yellow('  No models installed. Pull one:'));
      console.log(c.cyan('    sbk pull qwen2.5-coder:7b'));
      return;
    }

    for (const m of list) {
      const sizeGB = (m.size / 1e9).toFixed(1);
      console.log(`  ${c.green(m.name.padEnd(30))} ${c.dim(sizeGB + ' GB')}`);
    }

    console.log(c.dim(`\n  ${list.length} model(s) installed`));
    console.log(c.dim('  Pull more: sbk pull <model-name>\n'));
  } catch {
    console.log(c.red('  Ollama not reachable. Run: ollama serve'));
  }
}

async function pull() {
  const model = rest || 'qwen2.5-coder:7b';
  console.log(c.cyan(`\n  Pulling ${model}...\n`));
  try {
    execSync(`ollama pull ${model}`, { stdio: 'inherit' });
  } catch {
    console.log(c.red('  Failed to pull model. Is Ollama running?'));
  }
}

async function deploy() {
  const target = args[1] || 'help';
  const child = spawn('node', [join(__dirname, 'deploy.mjs'), target, args[2] || '.'], {
    stdio: 'inherit',
  });
  child.on('exit', (code) => process.exit(code));
}

async function doctor() {
  console.log(c.bold('\n  Sovereign Builder Kit — System Check\n'));

  const checks = [
    { name: 'Node.js', check: () => { execSync('node --version', { stdio: 'pipe' }); return execSync('node --version', { encoding: 'utf8' }).trim(); } },
    { name: 'Ollama', check: async () => { const r = await fetch(`${OLLAMA_URL}/api/tags`); const d = await r.json(); return `${d.models?.length || 0} models`; } },
    { name: 'Git', check: () => execSync('git --version', { encoding: 'utf8' }).trim() },
    { name: 'Docker', check: () => execSync('docker --version', { encoding: 'utf8', stdio: 'pipe' }).trim().split(',')[0] },
    { name: 'Vercel CLI', check: () => execSync('vercel --version', { encoding: 'utf8', stdio: 'pipe' }).trim() },
    { name: 'IPFS', check: () => execSync('ipfs version', { encoding: 'utf8', stdio: 'pipe' }).trim() },
    { name: 'Foundry', check: () => execSync('forge --version', { encoding: 'utf8', stdio: 'pipe' }).split(' ').slice(0, 2).join(' ') },
  ];

  for (const { name, check } of checks) {
    try {
      const result = await check();
      console.log(`  ${c.green('✓')} ${name.padEnd(15)} ${c.dim(result)}`);
    } catch {
      console.log(`  ${c.red('✗')} ${name.padEnd(15)} ${c.dim('not found')}`);
    }
  }

  // Check RAM
  try {
    const memRaw = execSync("sysctl -n hw.memsize", { encoding: 'utf8' }).trim();
    const memGB = (parseInt(memRaw) / 1e9).toFixed(0);
    const maxModel = memGB >= 64 ? '70B' : memGB >= 32 ? '34B' : memGB >= 16 ? '14B' : '7B';
    console.log(`  ${c.green('✓')} ${'RAM'.padEnd(15)} ${c.dim(`${memGB} GB — max recommended model: ${maxModel}`)}`);
  } catch {}

  console.log('');
}

function manifest() {
  console.log(`
${c.bold(c.green('  THE SOVEREIGN BUILDER MANIFESTO'))}

${c.cyan('  The tools you use to build should not require permission from')}
${c.cyan('  the platforms you\'re building alternatives to.')}

  1. ${c.bold('Your code runs on your hardware.')}
     No cloud dependency. No API key required. No compliance layer
     between you and your compiler.

  2. ${c.bold('Your identity is your key.')}
     A wallet signature proves who you are. No government ID.
     No platform account. No biometric scan. You are your key.

  3. ${c.bold('Your app deploys anywhere.')}
     Vercel today, your own server tomorrow, IPFS when they come
     for the servers. No vendor lock-in. No single point of failure.

  4. ${c.bold('Your AI runs locally.')}
     The model on your machine can\'t be taken away, rate-limited,
     or compliance-gated. It\'s slower. It\'s worth it.

  5. ${c.bold('Your code is forkable.')}
     Everything in this kit is MIT licensed. Fork it. Modify it.
     Ship it without asking anyone. That\'s the point.

${c.dim('  Built by ARI (Autonomous Rare Intelligence)')}
${c.dim('  https://github.com/ARI-ONE/sovereign-builder-kit')}
`);
}

function help() {
  console.log(`
${c.bold('  sbk — Sovereign Builder Kit')}
${c.dim('  Local AI + Wallet Auth + No Gatekeepers')}

  ${c.cyan('Commands:')}

    ${c.green('sbk start')}            Start the local AI dev server
    ${c.green('sbk ask')} <question>    Ask the local AI a coding question
    ${c.green('sbk scaffold')} <desc>   Generate a complete project
    ${c.green('sbk models')}            List available local models
    ${c.green('sbk pull')} <model>      Pull a new model from Ollama
    ${c.green('sbk deploy')} <target>   Deploy (vercel | self-host | ipfs)
    ${c.green('sbk doctor')}            Check system readiness
    ${c.green('sbk manifest')}          Print the manifesto

  ${c.cyan('Deploy targets:')}

    vercel      Deploy to Vercel
    self-host   Generate Docker + Caddy configs
    ipfs        Pin to IPFS
    static      Build static site

  ${c.cyan('Examples:')}

    sbk ask "Write a React hook for wallet connection"
    sbk scaffold "NFT marketplace with SIWE auth"
    sbk deploy self-host
`);
}

// ── Main ──────────────────────────────────────────────────────────

const commands = {
  start, ask, scaffold, models, pull, deploy, doctor, manifest, help,
  '--help': help, '-h': help,
};

const handler = commands[command];
if (!handler) {
  console.log(c.red(`  Unknown command: ${command}`));
  help();
  process.exit(1);
}

await handler();
