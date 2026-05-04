// Fetch Aswath Damodaran's blog posts + data page links
// Sources: pages.stern.nyu.edu/~adamodar + aswathdamodaran.blogspot.com
// All content is publicly free.

import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { fetchBuf, sha256, ensureDir, readJsonOr, writeJson } from './fetch-utils.mjs';

const SLUG = 'damodaran';
const ROOT = process.cwd();
const RAW_DIR = join(ROOT, 'data/codex/raw', SLUG);
const MANIFEST = join(RAW_DIR, 'manifest.json');
const LICENSE = 'Aswath Damodaran blog and NYU pages publicly available, free to use';
const CAP_BLOG = 10;

const SEED_PAGES = [
  { url: 'https://aswathdamodaran.blogspot.com/', kind: 'blog_index', title: 'Damodaran on Valuation — Blog Index' },
  { url: 'https://pages.stern.nyu.edu/~adamodar/New_Home_Page/home.htm', kind: 'nyu_home', title: 'NYU Stern Home Page' },
];

function ensureManifest(m) {
  if (!m || typeof m !== 'object') return { entries: [], warnings: [] };
  return {
    entries: Array.isArray(m.entries) ? m.entries : [],
    warnings: Array.isArray(m.warnings) ? m.warnings : [],
  };
}

async function fetchBlogPosts(indexHtml, baseUrl, manifest, knownSha) {
  // Blogspot: post links look like /2024/01/some-title.html
  const re = /href\s*=\s*["'](https?:\/\/aswathdamodaran\.blogspot\.com\/\d{4}\/\d{2}\/[^"'?#]+\.html)["']/gi;
  const seen = new Set();
  const posts = [];
  let m;
  while ((m = re.exec(indexHtml)) !== null) {
    const url = m[1];
    if (!seen.has(url)) { seen.add(url); posts.push(url); }
  }
  console.log(`damodaran: found ${posts.length} blog post links on index`);

  let count = 0;
  for (const url of posts) {
    if (count >= CAP_BLOG) break;
    const r = await fetchBuf(url);
    if (!r.buf || r.status >= 400) {
      manifest.warnings.push({ url, reason: `http ${r.status}` });
      continue;
    }
    const hash = sha256(r.buf);
    if (knownSha.has(hash)) { console.log(`  skip (known) ${url}`); continue; }
    const slug = url.split('/').pop().replace('.html', '');
    const filename = `${hash.slice(0, 12)}.html`;
    await writeFile(join(RAW_DIR, filename), r.buf);
    manifest.entries.push({
      title: `Damodaran Blog: ${slug}`,
      url,
      kind: 'blog_post',
      slug,
      filename,
      fetched_at: new Date().toISOString(),
      sha256: hash,
      bytes: r.buf.length,
      license_note: LICENSE,
    });
    knownSha.add(hash);
    console.log(`  blog post → ${filename} (${r.buf.length} bytes)`);
    count++;
  }
}

async function main() {
  await ensureDir(RAW_DIR);
  const manifest = ensureManifest(await readJsonOr(MANIFEST, null));
  const knownSha = new Set(manifest.entries.map((e) => e.sha256));

  for (const seed of SEED_PAGES) {
    const r = await fetchBuf(seed.url);
    if (!r.buf || r.status >= 400) {
      manifest.warnings.push({ url: seed.url, reason: `http ${r.status} ${r.error ?? ''}` });
      console.log(`  failed: ${seed.url}`);
      continue;
    }
    const hash = sha256(r.buf);
    if (!knownSha.has(hash)) {
      const ext = seed.url.endsWith('.pdf') ? 'pdf' : 'html';
      const filename = `${hash.slice(0, 12)}.${ext}`;
      await writeFile(join(RAW_DIR, filename), r.buf);
      manifest.entries.push({
        title: seed.title,
        url: seed.url,
        kind: seed.kind,
        filename,
        fetched_at: new Date().toISOString(),
        sha256: hash,
        bytes: r.buf.length,
        license_note: LICENSE,
      });
      knownSha.add(hash);
      console.log(`  seed page → ${filename} (${r.buf.length} bytes)`);

      // If this is the blog index, extract and fetch individual posts
      if (seed.kind === 'blog_index') {
        await fetchBlogPosts(r.buf.toString('utf8'), seed.url, manifest, knownSha);
      }
    } else {
      console.log(`  skip (known) ${seed.title}`);

      if (seed.kind === 'blog_index') {
        await fetchBlogPosts(r.buf.toString('utf8'), seed.url, manifest, knownSha);
      }
    }
  }

  await writeJson(MANIFEST, manifest);
  console.log(`damodaran: ${manifest.entries.length} entries, ${manifest.warnings.length} warnings`);
}

main().catch((e) => { console.error(e); process.exit(1); });
