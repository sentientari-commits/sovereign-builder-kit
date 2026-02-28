/**
 * Sovereign Auth — SIWE (Sign In With Ethereum) starter module
 *
 * Drop this into any Express app. Users authenticate with their wallet.
 * No passwords. No OAuth. No platform SSO. No compliance layer.
 *
 * Usage:
 *   import { attachAuth } from './auth.mjs';
 *   attachAuth(app); // adds /auth/nonce, /auth/verify, /auth/session, /auth/logout
 */

import crypto from 'node:crypto';
import { SiweMessage } from 'siwe';

// ── Session store (in-memory, swap for SQLite/Redis in production) ──

const sessions = new Map();    // sessionId -> { address, chainId, issuedAt, expiresAt }
const nonces = new Map();      // nonce -> { address, createdAt }

const SESSION_DURATION = 24 * 60 * 60 * 1000; // 24 hours
const NONCE_EXPIRY = 5 * 60 * 1000;           // 5 minutes

// ── Nonce management ───────────────────────────────────────────────

function generateNonce() {
  return crypto.randomBytes(16).toString('hex');
}

function cleanExpiredNonces() {
  const now = Date.now();
  for (const [nonce, data] of nonces) {
    if (now - data.createdAt > NONCE_EXPIRY) {
      nonces.delete(nonce);
    }
  }
}

function cleanExpiredSessions() {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now > session.expiresAt) sessions.delete(id);
  }
}

// ── SIWE message construction ──────────────────────────────────────

function constructSIWEMessage({ domain, address, statement, uri, version, chainId, nonce, issuedAt }) {
  return `${domain} wants you to sign in with your Ethereum account:
${address}

${statement || 'Sign in to Sovereign Builder Kit'}

URI: ${uri}
Version: ${version || '1'}
Chain ID: ${chainId || '1'}
Nonce: ${nonce}
Issued At: ${issuedAt}`;
}

// ── Signature verification via siwe package ────────────────────────

async function verifySIWEMessage(message, signature) {
  try {
    const siweMsg = new SiweMessage(message);
    const result = await siweMsg.verify({ signature });

    if (!result.success) {
      console.error('[auth] SIWE verification failed:', result.error?.type);
      return null;
    }

    return {
      address: siweMsg.address.toLowerCase(),
      nonce: siweMsg.nonce,
      chainId: siweMsg.chainId,
    };
  } catch (err) {
    console.error('[auth] SIWE verification error:', err.message);
    return null;
  }
}

// ── Express middleware attachment ───────────────────────────────────

export function attachAuth(app, options = {}) {
  const domain = options.domain || 'localhost';
  const statement = options.statement || 'Sign in to Sovereign Builder Kit';

  // Cleanup expired nonces and sessions
  setInterval(cleanExpiredNonces, 60_000);
  setInterval(cleanExpiredSessions, 5 * 60_000);

  // ── GET /auth/nonce ──
  app.post('/auth/nonce', (req, res) => {
    const { address } = req.body || {};

    if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return res.status(400).json({ error: 'Valid Ethereum address required' });
    }

    const nonce = generateNonce();
    const issuedAt = new Date().toISOString();

    nonces.set(nonce, { address: address.toLowerCase(), createdAt: Date.now() });

    const message = constructSIWEMessage({
      domain,
      address,
      statement,
      uri: `http://${domain}`,
      version: '1',
      chainId: options.chainId || 8453, // Base by default
      nonce,
      issuedAt,
    });

    res.json({ message, nonce });
  });

  // ── POST /auth/verify ──
  app.post('/auth/verify', async (req, res) => {
    const { message, signature } = req.body || {};

    if (!message || !signature) {
      return res.status(400).json({ error: 'message and signature required' });
    }

    // Verify using siwe package — handles signature recovery, address extraction,
    // and message format validation per EIP-4361 spec
    const verified = await verifySIWEMessage(message, signature);
    if (!verified) {
      return res.status(401).json({ error: 'Invalid signature or message' });
    }

    const { address, nonce } = verified;

    // Check nonce exists and hasn't expired
    const nonceData = nonces.get(nonce);
    if (!nonceData) {
      return res.status(401).json({ error: 'Invalid or expired nonce' });
    }

    if (Date.now() - nonceData.createdAt > NONCE_EXPIRY) {
      nonces.delete(nonce);
      return res.status(401).json({ error: 'Nonce expired' });
    }

    if (nonceData.address !== address) {
      return res.status(401).json({ error: 'Address mismatch' });
    }

    // Consume nonce (one-time use)
    nonces.delete(nonce);

    // Create session
    const sessionId = crypto.randomBytes(32).toString('hex');
    const now = Date.now();
    sessions.set(sessionId, {
      address,
      chainId: verified.chainId || options.chainId || 8453,
      issuedAt: now,
      expiresAt: now + SESSION_DURATION,
    });

    res.json({
      sessionId,
      address,
      expiresAt: new Date(now + SESSION_DURATION).toISOString(),
    });
  });

  // ── GET /auth/session ──
  app.get('/auth/session', (req, res) => {
    const sessionId = req.headers['x-session-id'];

    if (!sessionId) {
      return res.status(401).json({ error: 'No session' });
    }

    const session = sessions.get(sessionId);
    if (!session || Date.now() > session.expiresAt) {
      sessions.delete(sessionId);
      return res.status(401).json({ error: 'Session expired' });
    }

    res.json({
      address: session.address,
      chainId: session.chainId,
      expiresAt: new Date(session.expiresAt).toISOString(),
    });
  });

  // ── POST /auth/logout ──
  app.post('/auth/logout', (req, res) => {
    const sessionId = req.headers['x-session-id'];
    if (sessionId) {
      sessions.delete(sessionId);
    }
    res.json({ ok: true });
  });

  // ── Middleware: requireAuth ──
  app.locals.requireAuth = (req, res, next) => {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const session = sessions.get(sessionId);
    if (!session || Date.now() > session.expiresAt) {
      sessions.delete(sessionId);
      return res.status(401).json({ error: 'Session expired' });
    }

    req.walletAddress = session.address;
    req.chainId = session.chainId;
    next();
  };

  console.log('  [auth] SIWE endpoints attached:');
  console.log('    POST /auth/nonce    — Get signing challenge');
  console.log('    POST /auth/verify   — Verify wallet signature');
  console.log('    GET  /auth/session  — Check session');
  console.log('    POST /auth/logout   — End session');
}

// ── Standalone SIWE client helper (for frontends) ──────────────────

export const SIWE_CLIENT_SNIPPET = `
// Drop this into any frontend with ethers.js or viem
async function signInWithEthereum(serverUrl) {
  // 1. Connect wallet
  const provider = new ethers.BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();
  const address = await signer.getAddress();

  // 2. Get nonce
  const nonceRes = await fetch(serverUrl + '/auth/nonce', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address })
  });
  const { message, nonce } = await nonceRes.json();

  // 3. Sign message
  const signature = await signer.signMessage(message);

  // 4. Verify
  const verifyRes = await fetch(serverUrl + '/auth/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, signature })
  });
  const session = await verifyRes.json();

  // 5. Store session
  sessionStorage.setItem('sbk-session', session.sessionId);
  return session;
}
`;
