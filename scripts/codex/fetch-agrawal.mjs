// Fetch Raamdeo Agrawal's Wealth Creation Studies from MOSL
// Source: motilaloswal.com/wealth-creation-study — public free PDFs (wc21–wc30 confirmed)
// Studies are numbered: wc1 = 1st study (1996–97), wc30 = 30th study (2025)

import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { fetchBuf, sha256, ensureDir, readJsonOr, writeJson } from './fetch-utils.mjs';

const SLUG = 'agrawal';
const ROOT = process.cwd();
const RAW_DIR = join(ROOT, 'data/codex/raw', SLUG);
const MANIFEST = join(RAW_DIR, 'manifest.json');
const LICENSE = 'MOSL Wealth Creation Studies — publicly available free PDFs on motilaloswal.com';
const BASE = 'https://www.motilaloswal.com';
const CAP = 10; // most recent studies

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

  // Fetch the index page to get all study links
  const idxR = await fetchBuf(`${BASE}/wealth-creation-study`);
  if (!idxR.buf || idxR.status >= 400) {
    manifest.warnings.push({ url: `${BASE}/wealth-creation-study`, reason: `index http ${idxR.status}` });
    await writeJson(MANIFEST, manifest);
    return;
  }

  const html = idxR.buf.toString('utf8');
  const re = /href="(\/content\/dam\/mofsl-website-adobe\/investor-relations\/wealth-creation\/wc(\d+)\.pdf)"/gi;
  const seen = new Set();
  const items = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    const path = m[1];
    const num = parseInt(m[2], 10);
    if (!seen.has(path)) {
      seen.add(path);
      items.push({ path, num, url: `${BASE}${path}` });
    }
  }

  // Sort descending (most recent = highest number) and cap
  items.sort((a, b) => b.num - a.num);
  const toFetch = items.slice(0, CAP);
  console.log(`agrawal: found ${items.length} studies, fetching most recent ${toFetch.length}`);

  for (const item of toFetch) {
    const r = await fetchBuf(item.url, { allow404: true });
    if (!r.buf || r.status >= 400) {
      manifest.warnings.push({ url: item.url, reason: `http ${r.status} ${r.error ?? ''}` });
      console.log(`  miss: wc${item.num} (${r.status})`);
      continue;
    }
    const hash = sha256(r.buf);
    if (knownSha.has(hash)) { console.log(`  skip (known) wc${item.num}`); continue; }
    const filename = `${hash.slice(0, 12)}.pdf`;
    await writeFile(join(RAW_DIR, filename), r.buf);
    manifest.entries.push({
      title: `MOSL Wealth Creation Study #${item.num}`,
      url: item.url,
      kind: 'wealth_creation_study',
      study_number: item.num,
      filename,
      fetched_at: new Date().toISOString(),
      sha256: hash,
      bytes: r.buf.length,
      license_note: LICENSE,
    });
    knownSha.add(hash);
    console.log(`  fetched wc${item.num} → ${filename} (${r.buf.length} bytes)`);
  }

  await writeJson(MANIFEST, manifest);
  console.log(`agrawal: ${manifest.entries.length} entries, ${manifest.warnings.length} warnings`);
}

main().catch((e) => { console.error(e); process.exit(1); });
