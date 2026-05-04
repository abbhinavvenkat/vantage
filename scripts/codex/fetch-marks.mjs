// Fetch Howard Marks memos from Oaktree Capital (oaktreecapital.com/insights/memos)
// All memos are publicly available free PDFs / HTML pages.

import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { fetchBuf, sha256, ensureDir, readJsonOr, writeJson, checkRobots } from './fetch-utils.mjs';

const SLUG = 'marks';
const ROOT = process.cwd();
const RAW_DIR = join(ROOT, 'data/codex/raw', SLUG);
const MANIFEST = join(RAW_DIR, 'manifest.json');
const INDEX_URL = 'https://www.oaktreecapital.com/insights/memos';
const LICENSE = 'Howard Marks memos publicly available on oaktreecapital.com, free to read';
const CAP = 10; // fetch 10 most recent memos

function ensureManifest(m) {
  if (!m || typeof m !== 'object') return { entries: [], warnings: [] };
  return {
    entries: Array.isArray(m.entries) ? m.entries : [],
    warnings: Array.isArray(m.warnings) ? m.warnings : [],
  };
}

async function main() {
  await ensureDir(RAW_DIR);
  const manifest = ensureManifest(await readJsonOr(MANIFEST, null));
  const knownSha = new Set(manifest.entries.map((e) => e.sha256));

  const ok = await checkRobots('www.oaktreecapital.com', '/insights/');
  if (!ok) {
    manifest.warnings.push({ url: INDEX_URL, reason: 'robots-disallowed' });
    await writeJson(MANIFEST, manifest);
    console.log('robots disallow /insights/, exiting');
    return;
  }

  const idx = await fetchBuf(INDEX_URL);
  if (!idx.buf) {
    manifest.warnings.push({ url: INDEX_URL, reason: `index fetch failed: ${idx.status} ${idx.error ?? ''}` });
    await writeJson(MANIFEST, manifest);
    console.log('index fetch failed:', idx.status, idx.error);
    return;
  }

  const html = idx.buf.toString('utf8');

  // Extract memo links — /insights/memo/<slug> (singular)
  const re = /href\s*=\s*["']([^"']*\/insights\/memo\/[^"'?#]+)["']/gi;
  const seen = new Set();
  const candidates = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    let href = m[1];
    let full;
    try { full = new URL(href, INDEX_URL).toString(); } catch { continue; }
    if (seen.has(full)) continue;
    seen.add(full);
    // Extract title from nearby text — use slug as fallback
    const slug = full.split('/').pop() ?? '';
    candidates.push({ url: full, slug });
  }

  console.log(`marks: discovered ${candidates.length} memo links, taking up to ${CAP}`);
  const toFetch = candidates.slice(0, CAP);

  for (const c of toFetch) {
    const r = await fetchBuf(c.url);
    if (!r.buf || r.status >= 400) {
      manifest.warnings.push({ url: c.url, reason: `fetch failed status=${r.status} ${r.error ?? ''}` });
      continue;
    }
    const hash = sha256(r.buf);
    if (knownSha.has(hash)) { console.log(`  skip (known) ${c.slug}`); continue; }

    const isPdf = (r.contentType?.includes('pdf') || c.url.endsWith('.pdf'));
    const ext = isPdf ? 'pdf' : 'html';
    const filename = `${hash.slice(0, 12)}.${ext}`;
    await writeFile(join(RAW_DIR, filename), r.buf);
    manifest.entries.push({
      title: `Howard Marks Memo: ${c.slug}`,
      url: c.url,
      kind: 'memo',
      slug: c.slug,
      filename,
      fetched_at: new Date().toISOString(),
      sha256: hash,
      bytes: r.buf.length,
      license_note: LICENSE,
    });
    knownSha.add(hash);
    console.log(`  fetched ${c.slug} → ${filename} (${r.buf.length} bytes)`);
  }

  await writeJson(MANIFEST, manifest);
  console.log(`marks: ${manifest.entries.length} entries, ${manifest.warnings.length} warnings`);
}

main().catch((e) => { console.error(e); process.exit(1); });
