// Fetch Shankar Nath's YouTube channel transcripts
// Channel: https://www.youtube.com/@ShankarNath
// Uses the youtube-transcript npm package (already a devDependency)

import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { fetchBuf, sha256, ensureDir, readJsonOr, writeJson } from './fetch-utils.mjs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const SLUG = 'shankar-nath';
const ROOT = process.cwd();
const RAW_DIR = join(ROOT, 'data/codex/raw', SLUG);
const MANIFEST = join(RAW_DIR, 'manifest.json');
const LICENSE = 'Shankar Nath YouTube transcripts — public educational content';
const CHANNEL_HANDLE = '@ShankarNath';
const CAP = 15; // fetch transcripts for up to 15 videos

function ensureManifest(m) {
  if (!m || typeof m !== 'object') return { entries: [], warnings: [] };
  return {
    entries: Array.isArray(m.entries) ? m.entries : [],
    warnings: Array.isArray(m.warnings) ? m.warnings : [],
  };
}

async function getChannelVideoIds(handle) {
  // Fetch channel page and extract video IDs from the HTML
  const channelUrl = `https://www.youtube.com/${handle}/videos`;
  const r = await fetchBuf(channelUrl);
  if (!r.buf) {
    console.log(`  failed to fetch channel page: ${r.status} ${r.error ?? ''}`);
    return [];
  }
  const html = r.buf.toString('utf8');

  // YouTube embeds video IDs in the page as "videoId":"<11chars>"
  const re = /"videoId":"([a-zA-Z0-9_-]{11})"/g;
  const seen = new Set();
  const ids = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      ids.push(m[1]);
    }
  }

  // Also try to get video titles from ytInitialData
  const titleRe = /"title":\{"runs":\[\{"text":"([^"]+)"\}\]/g;
  const titles = [];
  while ((m = titleRe.exec(html)) !== null) {
    titles.push(m[1]);
  }

  return ids.map((id, i) => ({ id, title: titles[i] ?? `Video ${id}` }));
}

async function fetchTranscript(videoId) {
  try {
    // Dynamic import since it's ESM
    const { YoutubeTranscript } = await import('youtube-transcript');
    const segments = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'en' });
    return segments.map((s) => s.text).join(' ');
  } catch (err) {
    // Try without lang restriction
    try {
      const { YoutubeTranscript } = await import('youtube-transcript');
      const segments = await YoutubeTranscript.fetchTranscript(videoId);
      return segments.map((s) => s.text).join(' ');
    } catch (err2) {
      return null;
    }
  }
}

async function main() {
  await ensureDir(RAW_DIR);
  const manifest = ensureManifest(await readJsonOr(MANIFEST, null));
  const knownVideoIds = new Set(manifest.entries.map((e) => e.video_id).filter(Boolean));

  console.log(`shankar-nath: fetching channel video list for ${CHANNEL_HANDLE}`);
  const videos = await getChannelVideoIds(CHANNEL_HANDLE);
  console.log(`  found ${videos.length} video IDs on channel page`);

  let count = 0;
  for (const video of videos) {
    if (count >= CAP) break;
    if (knownVideoIds.has(video.id)) {
      console.log(`  skip (known) ${video.id}`);
      continue;
    }

    console.log(`  fetching transcript for ${video.id}: ${video.title}`);
    const transcript = await fetchTranscript(video.id);
    if (!transcript) {
      manifest.warnings.push({ video_id: video.id, reason: 'no transcript available' });
      console.log(`    no transcript`);
      continue;
    }

    const hash = sha256(Buffer.from(transcript, 'utf8'));
    const filename = `${hash.slice(0, 12)}.txt`;
    await writeFile(join(RAW_DIR, filename), transcript, 'utf8');
    manifest.entries.push({
      title: video.title,
      url: `https://www.youtube.com/watch?v=${video.id}`,
      video_id: video.id,
      kind: 'youtube_transcript',
      filename,
      fetched_at: new Date().toISOString(),
      sha256: hash,
      bytes: Buffer.byteLength(transcript, 'utf8'),
      license_note: LICENSE,
    });
    knownVideoIds.add(video.id);
    console.log(`    → ${filename} (${transcript.length} chars)`);
    count++;

    // Rate limit: 1 req/sec already handled by fetchBuf for HTTP; sleep for transcript API
    await new Promise((r) => setTimeout(r, 1500));
  }

  await writeJson(MANIFEST, manifest);
  console.log(`shankar-nath: ${manifest.entries.length} entries, ${manifest.warnings.length} warnings`);
}

main().catch((e) => { console.error(e); process.exit(1); });
