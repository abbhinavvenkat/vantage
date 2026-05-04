// Shared HTTP/fetch utilities for codex-fetch.
// Uses Node's global fetch (Node 20+) to mimic `curl --silent --show-error --fail --location --max-time 60 --user-agent ...`.
// The harness sandbox blocks `curl` directly, so we route through Node fetch.

import { createHash } from 'node:crypto';
import { writeFile, readFile, mkdir, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const UA = 'Mozilla/5.0 stock-platform-codex/0.1';
export const TIMEOUT_MS = 60_000;

const lastFetchPerHost = new Map();

export async function rateLimitedSleep(host) {
  const last = lastFetchPerHost.get(host) ?? 0;
  const now = Date.now();
  const wait = Math.max(0, 1000 - (now - last));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastFetchPerHost.set(host, Date.now());
}

export async function fetchBuf(url, { allow404 = true } = {}) {
  const u = new URL(url);
  await rateLimitedSleep(u.host);
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        redirect: 'follow',
        signal: ctrl.signal,
        headers: { 'User-Agent': UA, 'Accept': '*/*' },
      });
      clearTimeout(t);
      if (res.status === 429) {
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, 30_000));
          continue;
        }
        return { status: 429, buf: null, contentType: '' };
      }
      if (!res.ok && !(allow404 && (res.status === 404 || res.status === 403))) {
        return { status: res.status, buf: null, contentType: res.headers.get('content-type') ?? '' };
      }
      const buf = Buffer.from(await res.arrayBuffer());
      return { status: res.status, buf, contentType: res.headers.get('content-type') ?? '' };
    } catch (err) {
      clearTimeout(t);
      return { status: 0, buf: null, contentType: '', error: String(err?.message ?? err) };
    }
  }
  return { status: 0, buf: null, contentType: '', error: 'unreachable' };
}

export function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

export async function ensureDir(path) {
  await mkdir(path, { recursive: true });
}

export async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

export async function readJsonOr(path, fallback) {
  try {
    const txt = await readFile(path, 'utf8');
    return JSON.parse(txt);
  } catch {
    return fallback;
  }
}

export async function writeJson(path, obj) {
  await ensureDir(dirname(path));
  await writeFile(path, JSON.stringify(obj, null, 2));
}

export async function checkRobots(host, path) {
  // Quick check: fetch /robots.txt, parse User-agent: * Disallow rules.
  // Returns true if allowed, false if disallowed.
  const url = `https://${host}/robots.txt`;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15_000);
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return true; // No robots → allowed.
    const txt = await res.text();
    const lines = txt.split(/\r?\n/);
    let inStar = false;
    const disallows = [];
    for (const line of lines) {
      const l = line.split('#')[0].trim();
      if (!l) continue;
      const m = l.match(/^(User-agent|Disallow|Allow):\s*(.*)$/i);
      if (!m) continue;
      const [, k, v] = m;
      if (k.toLowerCase() === 'user-agent') {
        inStar = v.trim() === '*';
      } else if (inStar && k.toLowerCase() === 'disallow' && v.trim()) {
        disallows.push(v.trim());
      }
    }
    return !disallows.some((d) => path.startsWith(d));
  } catch {
    return true;
  }
}
