// Fetch the 5 most recent Berkshire Hathaway annual letters.
// Index: https://www.berkshirehathaway.com/letters/letters.html
// Letters live at /letters/<year>ltr.pdf or /letters/<year>.html

import { join, extname } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { fetchBuf, sha256, ensureDir, readJsonOr, writeJson, checkRobots } from './fetch-utils.mjs';

const SLUG = 'buffett';
const ROOT = process.cwd();
const RAW_DIR = join(ROOT, 'data/codex/raw', SLUG);
const MANIFEST = join(RAW_DIR, 'manifest.json');
const INDEX_URL = 'https://www.berkshirehathaway.com/letters/letters.html';
const LICENSE = 'All Berkshire annual letters publicly available, free to use for personal research';
const CAP = 5;

function ensureManifest(m) {
  if (!m || typeof m !== 'object') return { entries: [], warnings: [] };
  return {
    entries: Array.isArray(m.entries) ? m.entries : (Array.isArray(m) ? m : []),
    warnings: Array.isArray(m.warnings) ? m.warnings : [],
  };
}

async function main() {
  await ensureDir(RAW_DIR);
  const manifest = ensureManifest(await readJsonOr(MANIFEST, null));
  const knownSha = new Set(manifest.entries.map((e) => e.sha256));

  // robots.txt check
  const ok = await checkRobots('www.berkshirehathaway.com', '/letters/');
  if (!ok) {
    manifest.warnings.push({ url: INDEX_URL, reason: 'robots-disallowed' });
    await writeJson(MANIFEST, manifest);
    console.log('robots disallow /letters/, exiting');
    return;
  }

  // Fetch the index
  const idx = await fetchBuf(INDEX_URL);
  if (!idx.buf) {
    manifest.warnings.push({ url: INDEX_URL, reason: `index fetch failed: ${idx.status} ${idx.error ?? ''}` });
    await writeJson(MANIFEST, manifest);
    console.log('index fetch failed');
    return;
  }
  const html = idx.buf.toString('utf8');

  // Find letter links — match patterns like 2024ltr.pdf, 2023ltr.pdf, 2024ar.html, 2023ar/2023ar.pdf
  const re = /href\s*=\s*["']([^"']*?(\d{4})(?:ltr\.pdf|ar\.html|ar\/\2ar\.pdf|\.html))["']/gi;
  const seen = new Set();
  const candidates = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    let href = m[1];
    const year = parseInt(m[2], 10);
    if (year < 1977 || year > 2099) continue;
    // resolve relative
    let full;
    try { full = new URL(href, INDEX_URL).toString(); } catch { continue; }
    const key = `${year}|${full}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ year, url: full });
  }

  // Prefer PDFs over HTML for the same year
  const byYear = new Map();
  for (const c of candidates) {
    const cur = byYear.get(c.year);
    const isPdf = c.url.toLowerCase().endsWith('.pdf');
    if (!cur || (isPdf && !cur.url.toLowerCase().endsWith('.pdf'))) {
      byYear.set(c.year, c);
    }
  }
  const sorted = [...byYear.values()].sort((a, b) => b.year - a.year).slice(0, CAP);
  console.log(`buffett: discovered ${candidates.length} candidates → ${sorted.length} unique years selected`);

  for (const c of sorted) {
    const r = await fetchBuf(c.url);
    if (!r.buf) {
      manifest.warnings.push({ url: c.url, reason: `fetch failed status=${r.status} ${r.error ?? ''}` });
      continue;
    }
    if (r.status >= 400) {
      manifest.warnings.push({ url: c.url, reason: `http ${r.status}` });
      continue;
    }
    const hash = sha256(r.buf);
    if (knownSha.has(hash)) { console.log(`  skip (known) ${c.year}`); continue; }
    const ext = c.url.toLowerCase().endsWith('.pdf') ? 'pdf' : 'html';
    const filename = `${hash.slice(0, 12)}.${ext}`;
    await writeFile(join(RAW_DIR, filename), r.buf);
    manifest.entries.push({
      title: `Berkshire Hathaway Chairman's Letter ${c.year}`,
      url: c.url,
      kind: 'annual_letter',
      year: c.year,
      filename,
      fetched_at: new Date().toISOString(),
      sha256: hash,
      bytes: r.buf.length,
      license_note: LICENSE,
    });
    knownSha.add(hash);
    console.log(`  fetched ${c.year} → ${filename} (${r.buf.length} bytes)`);
  }

  await writeJson(MANIFEST, manifest);
  console.log(`buffett: ${manifest.entries.length} entries, ${manifest.warnings.length} warnings`);
}

main().catch((e) => { console.error(e); process.exit(1); });
