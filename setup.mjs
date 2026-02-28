#!/usr/bin/env node

/**
 * Sovereign Builder Kit — One-Command Setup
 *
 * Checks your system, installs what's missing, pulls models, gets you building.
 */

import { execSync } from 'node:child_process';

const c = {
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
};

function run(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: 'pipe' }).trim();
  } catch {
    return null;
  }
}

function log(msg) { console.log(`  ${msg}`); }

console.log(`
${c.bold(c.green('  SOVEREIGN BUILDER KIT — SETUP'))}
${c.dim('  Checking your system...')}
`);

// 1. Node.js
const nodeVersion = run('node --version');
if (nodeVersion) {
  log(`${c.green('✓')} Node.js ${nodeVersion}`);
} else {
  log(`${c.red('✗')} Node.js not found`);
  log(`  Install: https://nodejs.org or \`brew install node\``);
  process.exit(1);
}

// 2. Ollama
const ollamaVersion = run('ollama --version');
if (ollamaVersion) {
  log(`${c.green('✓')} Ollama installed`);
} else {
  log(`${c.yellow('!')} Ollama not found — installing...`);
  log(`  Visit https://ollama.ai or run: curl -fsSL https://ollama.ai/install.sh | sh`);
  log(`  Then run this setup again.`);
  process.exit(1);
}

// 3. Check Ollama is running
const ollamaRunning = run('curl -s http://localhost:11434/api/tags');
if (ollamaRunning) {
  log(`${c.green('✓')} Ollama is running`);
} else {
  log(`${c.yellow('!')} Ollama not running — start it: ollama serve`);
}

// 4. Check for coding models
let hasCoderModel = false;
try {
  const tags = JSON.parse(ollamaRunning || '{}');
  const models = tags.models?.map(m => m.name) || [];
  const coderModels = models.filter(m =>
    m.includes('coder') || m.includes('codellama') || m.includes('deepseek')
  );

  if (coderModels.length > 0) {
    log(`${c.green('✓')} Coding model available: ${coderModels[0]}`);
    hasCoderModel = true;
  }
} catch {}

if (!hasCoderModel) {
  log(`${c.yellow('!')} No coding model found. Pulling qwen2.5-coder:7b...`);
  log(`  This will download ~4.7GB. Sit tight.`);
  try {
    execSync('ollama pull qwen2.5-coder:7b', { stdio: 'inherit' });
    log(`${c.green('✓')} qwen2.5-coder:7b ready`);
  } catch {
    log(`${c.red('✗')} Failed to pull model. Try manually: ollama pull qwen2.5-coder:7b`);
  }
}

// 5. RAM check
try {
  const memRaw = run("sysctl -n hw.memsize");
  if (memRaw) {
    const memGB = Math.round(parseInt(memRaw) / 1e9);
    if (memGB >= 32) {
      log(`${c.green('✓')} ${memGB}GB RAM — you can run 14B-34B models`);
      log(`${c.dim('  Consider: ollama pull qwen2.5-coder:14b')}`);
    } else if (memGB >= 16) {
      log(`${c.green('✓')} ${memGB}GB RAM — 7B models run well, 14B quantized is possible`);
    } else {
      log(`${c.yellow('!')} ${memGB}GB RAM — stick with 1.5B-3B models for speed`);
    }
  }
} catch {}

// 6. Install dependencies
log('');
log(c.cyan('Installing dependencies...'));
try {
  execSync('npm install', { stdio: 'inherit', cwd: import.meta.dirname || '.' });
  log(`${c.green('✓')} Dependencies installed`);
} catch {
  log(`${c.yellow('!')} npm install had issues — check package.json`);
}

// 7. Done
console.log(`
${c.bold(c.green('  SETUP COMPLETE'))}

  ${c.cyan('Quick start:')}

    ${c.green('node server.mjs')}       Start the AI dev server
    ${c.green('node cli.mjs ask')} "..."  Ask a coding question
    ${c.green('node cli.mjs doctor')}    Full system check
    ${c.green('node cli.mjs manifest')}  Read the manifesto

  ${c.dim('No cloud. No API keys. No permission required.')}
`);
