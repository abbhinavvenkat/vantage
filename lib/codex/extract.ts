/**
 * codex-extract — convert raw fetched artifacts (PDF/HTML) under
 * data/codex/raw/<slug>/ into markdown with paragraph anchors at
 * data/codex/extracted/<slug>/.
 *
 * Each output paragraph is preceded by `<a id="p-N"></a>` so distill can cite
 * specific paragraphs in source.
 *
 * Reads `<rawDir>/manifest.json` to map filename -> source url + title + kind.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import { load as loadHtml } from 'cheerio';

export type ManifestEntry = {
  title: string;
  url: string;
  kind: string;
  filename: string;
  year?: number;
  fetched_at?: string;
  sha256?: string;
  bytes?: number;
  license_note?: string;
};

export type ManifestFile = {
  entries: ManifestEntry[];
  warnings?: unknown[];
};

export type ExtractedDoc = {
  filename: string;
  source_url: string;
  source_title: string;
  source_kind: string;
  paragraphs: string[]; // each paragraph already trimmed, no anchor
  markdown: string; // markdown with anchors
};

const MIN_PARAGRAPH_CHARS = 80;

function normaliseWhitespace(s: string): string {
  return s
    .replace(/ /g, ' ') // nbsp
    .replace(/[\t ]+/g, ' ')
    .replace(/[ ]*\n[ ]*/g, '\n')
    .trim();
}

/**
 * Split a long body of plain text into paragraphs. Heuristic: blank-line
 * separators or single newlines collapsed to spaces if line is short (>>
 * usually wrap-of-paragraph).
 */
export function splitParagraphs(text: string): string[] {
  const cleaned = normaliseWhitespace(text);
  // Treat 2+ newlines as paragraph break
  const blocks = cleaned.split(/\n\s*\n+/);
  const out: string[] = [];
  for (const block of blocks) {
    // Within a block, join wrapped lines (where the previous line did NOT
    // end with sentence-terminator and is short).
    const lines = block.split('\n');
    let current = '';
    for (const ln of lines) {
      const line = ln.trim();
      if (!line) continue;
      if (current.length === 0) {
        current = line;
      } else {
        // If the previous line ends mid-sentence (no period/!/?) and is short,
        // join with space.
        const lastChar = current[current.length - 1] ?? '';
        if (/[.?!:;]/.test(lastChar) && current.length > 80) {
          out.push(current);
          current = line;
        } else {
          current += ' ' + line;
        }
      }
    }
    if (current) out.push(current);
  }
  return out.map((p) => p.trim()).filter((p) => p.length >= MIN_PARAGRAPH_CHARS);
}

export function paragraphsToMarkdown(paragraphs: string[]): string {
  return paragraphs.map((p, i) => `<a id="p-${i + 1}"></a>\n\n${p}\n`).join('\n');
}

export async function extractPdf(filePath: string): Promise<string[]> {
  // Use dynamic import for pdf-parse (ESM with new PDFParse class).
  const mod = await import('pdf-parse');
  const buf = readFileSync(filePath);
  const parser = new mod.PDFParse({ data: buf });
  const r = await parser.getText();
  const text = r.text ?? '';
  return splitParagraphs(text);
}

export function extractHtml(filePath: string): string[] {
  const html = readFileSync(filePath, 'utf-8');
  const $ = loadHtml(html);

  // Strip noise.
  $(
    'script, style, nav, header, footer, aside, form, iframe, .nav, .header, .footer, .sidebar, .menu, .breadcrumb, .navbar, .related, .comments',
  ).remove();

  // Collect text from <article>, <main>, body content blocks. Try article first.
  let root = $('article').first();
  if (root.length === 0) root = $('main').first();
  if (root.length === 0) root = $('body');

  const blocks: string[] = [];
  root.find('h1, h2, h3, h4, p, li, blockquote').each((_, el) => {
    const tag = (el as { tagName?: string }).tagName ?? 'p';
    const txt = $(el).text();
    const cleaned = normaliseWhitespace(txt);
    if (!cleaned) return;
    if (/^h[1-6]$/i.test(tag)) {
      blocks.push(`## ${cleaned}`);
    } else if (tag === 'blockquote') {
      blocks.push(`> ${cleaned}`);
    } else {
      blocks.push(cleaned);
    }
  });

  return blocks.map((b) => b.trim()).filter((b) => b.length >= MIN_PARAGRAPH_CHARS);
}

export async function extractFile(
  rawDir: string,
  entry: ManifestEntry,
): Promise<ExtractedDoc | null> {
  const fp = join(rawDir, entry.filename);
  if (!existsSync(fp)) return null;
  const ext = extname(entry.filename).toLowerCase();
  let paragraphs: string[];
  if (ext === '.pdf') {
    try {
      paragraphs = await extractPdf(fp);
    } catch (err) {
      console.warn(`[extract] PDF failed: ${fp}: ${(err as Error).message}`);
      return null;
    }
  } else if (ext === '.html' || ext === '.htm') {
    paragraphs = extractHtml(fp);
  } else if (ext === '.md' || ext === '.txt') {
    paragraphs = splitParagraphs(readFileSync(fp, 'utf-8'));
  } else {
    return null;
  }
  if (paragraphs.length === 0) return null;
  const md = paragraphsToMarkdown(paragraphs);
  const header = [
    `---`,
    `title: ${JSON.stringify(entry.title)}`,
    `source_url: ${entry.url}`,
    `kind: ${entry.kind}`,
    entry.year ? `year: ${entry.year}` : null,
    `---`,
    '',
  ]
    .filter((x) => x !== null)
    .join('\n');
  const markdown = header + '\n' + md;
  return {
    filename: entry.filename,
    source_url: entry.url,
    source_title: entry.title,
    source_kind: entry.kind,
    paragraphs,
    markdown,
  };
}

export async function extractInvestor(
  slug: string,
  rawRoot = 'data/codex/raw',
  outRoot = 'data/codex/extracted',
): Promise<{ slug: string; n: number; warnings: string[] }> {
  const rawDir = join(rawRoot, slug);
  const outDir = join(outRoot, slug);
  if (!existsSync(rawDir)) throw new Error(`raw dir not found: ${rawDir}`);
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const manifestPath = join(rawDir, 'manifest.json');
  let entries: ManifestEntry[] = [];
  if (existsSync(manifestPath)) {
    const m = JSON.parse(readFileSync(manifestPath, 'utf-8')) as ManifestFile;
    entries = m.entries;
  } else {
    // Synthesise from filenames.
    entries = readdirSync(rawDir)
      .filter((f) => /\.(pdf|html|htm|md|txt)$/i.test(f))
      .map((f) => ({
        title: basename(f, extname(f)),
        url: 'unknown',
        kind: 'unknown',
        filename: f,
      }));
  }

  const index: Array<{
    filename: string;
    out_path: string;
    source_url: string;
    title: string;
    kind: string;
    n_paragraphs: number;
  }> = [];
  const warnings: string[] = [];

  for (const e of entries) {
    const doc = await extractFile(rawDir, e);
    if (!doc) {
      warnings.push(`skip: ${e.filename}`);
      continue;
    }
    const outName = e.filename.replace(/\.(pdf|html|htm)$/i, '.md');
    const outPath = join(outDir, outName);
    writeFileSync(outPath, doc.markdown, 'utf-8');
    index.push({
      filename: e.filename,
      out_path: outPath,
      source_url: doc.source_url,
      title: doc.source_title,
      kind: doc.source_kind,
      n_paragraphs: doc.paragraphs.length,
    });
  }

  writeFileSync(
    join(outDir, 'index.json'),
    JSON.stringify(
      { slug, generated_at: new Date().toISOString(), docs: index, warnings },
      null,
      2,
    ),
    'utf-8',
  );

  return { slug, n: index.length, warnings };
}
