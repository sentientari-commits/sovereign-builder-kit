#!/usr/bin/env node

/**
 * Sovereign Builder Kit — Deploy Anywhere
 *
 * One script, multiple targets. No vendor lock-in.
 *
 * Usage:
 *   node deploy.mjs vercel      — Deploy to Vercel
 *   node deploy.mjs self-host   — Generate self-hosting config (Docker + Caddy)
 *   node deploy.mjs ipfs        — Pin to IPFS via local node or Pinata
 *   node deploy.mjs static      — Build static site to ./dist
 */

import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const target = args[0] || 'help';
const projectDir = args[1] || process.cwd();

function log(msg) { console.log(`  [deploy] ${msg}`); }
function run(cmd, opts = {}) {
  log(`> ${cmd}`);
  return execSync(cmd, { stdio: 'inherit', cwd: projectDir, ...opts });
}

// ── Vercel ─────────────────────────────────────────────────────────

function deployVercel() {
  log('Deploying to Vercel...');

  // Check vercel CLI
  try {
    execSync('which vercel', { stdio: 'pipe' });
  } catch {
    log('Installing Vercel CLI...');
    run('npm i -g vercel');
  }

  run('vercel --prod');
  log('Deployed to Vercel.');
}

// ── Self-Host (Docker + Caddy) ─────────────────────────────────────

function deploySelfHost() {
  log('Generating self-hosting config...');

  const distDir = join(projectDir, 'deploy');
  mkdirSync(distDir, { recursive: true });

  // Dockerfile
  const dockerfile = `FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
EXPOSE 3000
ENV NODE_ENV=production
CMD ["node", "server.mjs"]
`;

  // docker-compose.yml
  const compose = `version: '3.8'
services:
  app:
    build: .
    ports:
      - "\${PORT:-3000}:3000"
    environment:
      - NODE_ENV=production
      - OLLAMA_URL=\${OLLAMA_URL:-http://host.docker.internal:11434}
    restart: unless-stopped
    extra_hosts:
      - "host.docker.internal:host-gateway"

  caddy:
    image: caddy:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
    depends_on:
      - app
    restart: unless-stopped

volumes:
  caddy_data:
`;

  // Caddyfile
  const caddyfile = `{
  # Replace with your domain
  # your-domain.com
}

:80 {
  reverse_proxy app:3000
}
`;

  // Deploy script
  const deployScript = `#!/bin/bash
set -e
echo "Building and deploying..."
docker compose build
docker compose up -d
echo ""
echo "Running at http://localhost:3000"
echo "To use a domain, edit Caddyfile and restart: docker compose restart caddy"
`;

  writeFileSync(join(distDir, 'Dockerfile'), dockerfile);
  writeFileSync(join(distDir, 'docker-compose.yml'), compose);
  writeFileSync(join(distDir, 'Caddyfile'), caddyfile);
  writeFileSync(join(distDir, 'deploy.sh'), deployScript, { mode: 0o755 });

  log(`Self-host configs written to ${distDir}/`);
  log('Run: cd deploy && ./deploy.sh');
}

// ── IPFS ───────────────────────────────────────────────────────────

function deployIPFS() {
  log('Deploying to IPFS...');

  const distDir = join(projectDir, 'dist');
  if (!existsSync(distDir)) {
    log('No dist/ directory found. Building first...');
    deployStatic();
  }

  // Try local IPFS node first
  try {
    execSync('which ipfs', { stdio: 'pipe' });
    log('Using local IPFS node...');
    const result = execSync(`ipfs add -r --quieter ${distDir}`, { encoding: 'utf8' }).trim();
    log(`Pinned to IPFS: ${result}`);
    log(`Gateway: https://ipfs.io/ipfs/${result}`);
    log(`dweb: ipfs://${result}`);
    return;
  } catch {}

  // Try Pinata
  try {
    const pinataJwt = process.env.PINATA_JWT;
    if (pinataJwt) {
      log('Using Pinata...');
      // For Pinata, user needs to use their SDK or API
      log('Pinata JWT found. Use pinata-cli or the Pinata SDK to pin dist/');
      log('  npx pinata-cli pin dist/');
      return;
    }
  } catch {}

  log('No IPFS node or Pinata config found.');
  log('Options:');
  log('  1. Install IPFS: brew install ipfs && ipfs init && ipfs daemon');
  log('  2. Use Pinata: export PINATA_JWT=your-jwt-token');
  log('  3. Use web3.storage: npx w3 put dist/');
}

// ── Static Build ───────────────────────────────────────────────────

function deployStatic() {
  log('Building static site...');

  const distDir = join(projectDir, 'dist');
  mkdirSync(distDir, { recursive: true });

  // Check if there's a build script
  try {
    const pkg = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf8'));
    if (pkg.scripts?.build) {
      run('npm run build');
      log(`Static build complete in ${distDir}/`);
      return;
    }
  } catch {}

  // Minimal static build — copy relevant files
  log('No build script found. Creating minimal static bundle...');

  const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sovereign App</title>
  <script src="https://cdn.ethers.org/lib/ethers-6.13.umd.min.js"></script>
</head>
<body>
  <div id="app"></div>
  <script type="module" src="./app.js"></script>
</body>
</html>`;

  writeFileSync(join(distDir, 'index.html'), indexHtml);
  log(`Minimal static build in ${distDir}/`);
}

// ── Help ───────────────────────────────────────────────────────────

function showHelp() {
  console.log(`
  Sovereign Builder Kit — Deploy Anywhere

  Usage: node deploy.mjs <target> [project-dir]

  Targets:
    vercel      Deploy to Vercel (needs vercel CLI)
    self-host   Generate Docker + Caddy configs
    ipfs        Pin to IPFS (local node or Pinata)
    static      Build static site to ./dist
    help        Show this message

  Examples:
    node deploy.mjs vercel .
    node deploy.mjs self-host /path/to/project
    node deploy.mjs ipfs
`);
}

// ── Main ───────────────────────────────────────────────────────────

const targets = {
  vercel: deployVercel,
  'self-host': deploySelfHost,
  selfhost: deploySelfHost,
  ipfs: deployIPFS,
  static: deployStatic,
  help: showHelp,
};

const handler = targets[target];
if (!handler) {
  log(`Unknown target: ${target}`);
  showHelp();
  process.exit(1);
}

handler();
