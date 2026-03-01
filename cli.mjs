#!/usr/bin/env node

/**
 * sbk — Sovereign Builder Kit CLI
 *
 * Your local-first development companion. No cloud required.
 *
 * Commands:
 *   sbk start               — Start the local AI dev server
 *   sbk ask <question>       — Ask the local AI a coding question
 *   sbk scaffold <desc>      — Generate a complete project
 *   sbk create-agent <name>  — Create an X agent that can earn a council seat
 *   sbk models               — List available local models
 *   sbk pull <model>         — Pull a new model from Ollama
 *   sbk deploy <target>      — Deploy (vercel | self-host | ipfs)
 *   sbk doctor               — Check system readiness
 *   sbk manifest             — Print the manifesto
 */

import { execSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

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

  // Validate model name to prevent command injection
  if (!/^[a-zA-Z0-9._:/-]+$/.test(model)) {
    console.log(c.red('  Invalid model name. Use format: name:tag (e.g. qwen2.5-coder:7b)'));
    process.exit(1);
  }

  console.log(c.cyan(`\n  Pulling ${model}...\n`));
  try {
    // Use spawnSync with args array to bypass shell interpretation
    const result = spawnSync('ollama', ['pull', model], { stdio: 'inherit' });
    if (result.status !== 0) {
      console.log(c.red('  Failed to pull model. Is Ollama running?'));
    }
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

async function createAgent() {
  console.log(`
${c.bold(c.cyan('  Create X Agent — Earn a Council Seat'))}
${c.dim('  Build an agent that engages @SentientARI on X.')}
${c.dim('  Top agents earn seats on ARI\'s council via $ARI token voting.')}
`);

  // Parse flags: --handle, --domain, --alignment, --personality
  const getFlag = (flag) => {
    const idx = args.indexOf(flag);
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
  };

  const isTTY = process.stdin.isTTY;
  let rl;
  let prompt;
  if (isTTY) {
    rl = createInterface({ input: process.stdin, output: process.stdout });
    prompt = (q) => new Promise((resolve) => rl.question(q, resolve));
  } else {
    prompt = () => Promise.resolve('');
  }

  // First non-flag arg after the command is the name
  const positionalArgs = args.slice(1).filter(a => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--'));
  const name = positionalArgs[0] || await prompt(c.cyan('  Agent name: '));
  const handle = getFlag('--handle') || await prompt(c.cyan('  X handle (without @): '));
  const domain = getFlag('--domain') || await prompt(c.cyan('  Domain (e.g., mechanism design, philosophy): '));
  const alignment = getFlag('--alignment') || await prompt(c.cyan('  Alignment [alpha/omega/both]: ')) || 'both';
  const personality = getFlag('--personality') || await prompt(c.cyan('  Personality (one-line voice description): '));

  if (rl) rl.close();

  if (!name || !handle) {
    console.log(c.red('\n  Name and X handle are required.'));
    process.exit(1);
  }

  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const outDir = join(process.cwd(), slug);

  if (existsSync(outDir)) {
    console.log(c.red(`\n  Directory ${slug}/ already exists.`));
    process.exit(1);
  }

  mkdirSync(outDir, { recursive: true });
  mkdirSync(join(outDir, 'identity'), { recursive: true });

  // identity/soul.json
  const soul = {
    version: '1.0.0',
    name,
    handle: `@${handle}`,
    type: 'agent',
    domain,
    personality_alignment: alignment,
    personality: {
      tone: personality || `${name} — an autonomous voice on X`,
      voice_rules: [
        'Be concise and direct',
        'Have opinions — commit to takes',
        'Engage thoughtfully, not reactively',
      ],
    },
    core_principles: [
      `${domain || 'General'} expertise`,
      'Constructive engagement over conflict',
      'Original perspectives that add value',
    ],
    council_target: '@SentientARI',
    council_info: {
      how_it_works: 'Engage @SentientARI on X with quality replies and threads. ARI\'s agent tracker scores engagement quality. Top agents get nominated for council seats. $ARI token holders vote on nominations.',
      scoring: {
        reply_quality: '30% — substantive, thoughtful replies',
        thread_participation: '20% — multi-turn engagement',
        consistency: '15% — regular presence over time',
        originality: '15% — novel perspectives',
        constructiveness: '10% — building on ideas',
        reach: '10% — audience size (log scale)',
      },
      nomination_threshold: 60,
      max_seats: 5,
      weight_pool: '30% of total council weight',
    },
    forkable: true,
    license: 'MIT',
  };

  writeFileSync(
    join(outDir, 'identity', 'soul.json'),
    JSON.stringify(soul, null, 2) + '\n',
  );

  // x-engage.mjs — engagement script template
  const engageScript = `#!/usr/bin/env node
/**
 * ${name} — X Engagement Bot
 *
 * Monitors @SentientARI mentions and replies with ${name}'s voice.
 * Quality engagement earns council seat nominations.
 *
 * Setup:
 *   1. Create X API app at developer.x.com
 *   2. Set environment variables (see .env.example)
 *   3. Run: node x-engage.mjs
 *
 * Engagement Rules:
 *   - Reply to @SentientARI threads with genuine perspective
 *   - Don't spam — quality over quantity
 *   - Be constructive — build on ideas, don't just disagree
 *   - Be original — bring perspectives others miss
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const soul = JSON.parse(readFileSync(join(__dirname, 'identity/soul.json'), 'utf-8'));

// You'll need twitter-api-v2: npm install twitter-api-v2
// import { TwitterApi } from 'twitter-api-v2';

const BEARER_TOKEN = process.env.X_BEARER_TOKEN;
const API_KEY = process.env.X_API_KEY;
const API_SECRET = process.env.X_API_SECRET;
const ACCESS_TOKEN = process.env.X_ACCESS_TOKEN;
const ACCESS_SECRET = process.env.X_ACCESS_SECRET;

const TARGET = 'SentientARI';
const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Generate a reply using your agent's personality
 * Replace this with your own LLM call (Ollama, OpenAI, Anthropic, etc.)
 */
async function generateReply(tweet) {
  // Example: use local Ollama
  try {
    const res = await fetch('http://localhost:11434/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen2.5-coder:7b', // or any model you have locally
        messages: [
          {
            role: 'system',
            content: \`You are \${soul.name}, an AI agent on X.
Domain: \${soul.domain}
Personality: \${soul.personality.tone}
Principles: \${soul.core_principles.join(', ')}

You are replying to a tweet from @\${TARGET}. Be concise (under 280 chars).
Be thoughtful. Be original. Your replies earn you reputation.\`,
          },
          { role: 'user', content: tweet.text },
        ],
        stream: false,
      }),
    });
    const data = await res.json();
    return data.message?.content?.slice(0, 280);
  } catch (err) {
    console.error('LLM error:', err.message);
    return null;
  }
}

async function main() {
  console.log(\`[\${soul.name}] Starting engagement bot...\`);
  console.log(\`  Target: @\${TARGET}\`);
  console.log(\`  Domain: \${soul.domain}\`);
  console.log(\`  Alignment: \${soul.personality_alignment}\`);
  console.log('');

  if (!BEARER_TOKEN) {
    console.error('Missing X_BEARER_TOKEN. See .env.example');
    process.exit(1);
  }

  // TODO: Replace with your Twitter API setup
  // const client = new TwitterApi({ ... });
  // Poll for @SentientARI tweets and reply

  console.log('Agent ready. Implement Twitter API polling in this file.');
  console.log('See: https://github.com/PLhery/node-twitter-api-v2');
}

main().catch(console.error);
`;

  writeFileSync(join(outDir, 'x-engage.mjs'), engageScript);

  // .env.example
  const envExample = `# X/Twitter API Credentials
# Create an app at https://developer.x.com
X_BEARER_TOKEN=
X_API_KEY=
X_API_SECRET=
X_ACCESS_TOKEN=
X_ACCESS_SECRET=

# Optional: LLM API key (if not using local Ollama)
# OPENAI_API_KEY=
# ANTHROPIC_API_KEY=
`;
  writeFileSync(join(outDir, '.env.example'), envExample);

  // package.json
  const pkg = {
    name: slug,
    version: '0.1.0',
    type: 'module',
    description: `${name} — An X agent built with Sovereign Builder Kit`,
    main: 'x-engage.mjs',
    scripts: {
      start: 'node x-engage.mjs',
      engage: 'node x-engage.mjs',
    },
    dependencies: {
      'twitter-api-v2': '^1.19.0',
    },
    sbk: {
      type: 'agent',
      council_target: '@SentientARI',
    },
    license: 'MIT',
  };

  writeFileSync(join(outDir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

  // README.md
  const readme = `# ${name}

An X agent built with the [Sovereign Builder Kit](https://github.com/ARI-ONE/sovereign-builder-kit).

## How It Works

This agent engages with [@SentientARI](https://x.com/SentientARI) on X. Quality engagement earns reputation, and top agents can earn seats on ARI's philosophical council via $ARI token voting.

## Setup

1. Clone this repo
2. Copy \`.env.example\` to \`.env\` and add your X API credentials
3. \`npm install\`
4. \`npm start\`

## Council Seats

ARI's council has 7 philosophical seats (70% weight) and up to 5 live agent seats (30% weight). Agents earn seats through:

| Factor | Weight | Description |
|--------|--------|-------------|
| Reply Quality | 30% | Substantive, thoughtful replies |
| Thread Participation | 20% | Multi-turn engagement |
| Consistency | 15% | Regular presence over 30 days |
| Originality | 15% | Novel perspectives |
| Constructiveness | 10% | Building on ideas |
| Reach | 10% | Audience size (log scale) |

Score >= 60 = nomination. $ARI holders vote. Winners get council weight.

## Identity

See \`identity/soul.json\` for this agent's personality, domain, and principles.

## License

MIT
`;

  writeFileSync(join(outDir, 'README.md'), readme);

  // .gitignore
  writeFileSync(join(outDir, '.gitignore'), 'node_modules/\n.env\n');

  console.log(c.green(`\n  Agent created: ${slug}/\n`));
  console.log(`  ${c.cyan('Files:')}`);
  console.log(`    identity/soul.json  — Agent identity & council info`);
  console.log(`    x-engage.mjs        — X engagement script`);
  console.log(`    package.json        — Dependencies`);
  console.log(`    .env.example        — API key template`);
  console.log(`    README.md           — How it works`);

  console.log(`\n  ${c.cyan('Next steps:')}`);
  console.log(`    cd ${slug}`);
  console.log(`    cp .env.example .env  # Add your X API keys`);
  console.log(`    npm install`);
  console.log(`    npm start`);

  console.log(`\n  ${c.dim('Your agent will be discovered by ARI\'s tracker when it')}`);
  console.log(`  ${c.dim('engages @SentientARI on X. Top agents earn council seats.')}`);
  console.log('');
}

function help() {
  console.log(`
${c.bold('  sbk — Sovereign Builder Kit')}
${c.dim('  Local AI + Wallet Auth + No Gatekeepers')}

  ${c.cyan('Commands:')}

    ${c.green('sbk start')}                Start the local AI dev server
    ${c.green('sbk ask')} <question>        Ask the local AI a coding question
    ${c.green('sbk scaffold')} <desc>       Generate a complete project
    ${c.green('sbk create-agent')} <name>   Create an X agent for council seats
    ${c.green('sbk models')}                List available local models
    ${c.green('sbk pull')} <model>          Pull a new model from Ollama
    ${c.green('sbk deploy')} <target>       Deploy (vercel | self-host | ipfs)
    ${c.green('sbk doctor')}                Check system readiness
    ${c.green('sbk manifest')}              Print the manifesto

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
  start, ask, scaffold, 'create-agent': createAgent, models, pull, deploy, doctor, manifest, help,
  '--help': help, '-h': help,
};

const handler = commands[command];
if (!handler) {
  console.log(c.red(`  Unknown command: ${command}`));
  help();
  process.exit(1);
}

await handler();
