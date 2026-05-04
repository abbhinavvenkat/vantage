---
name: codex-fetch
description: Fetch raw artifacts (letters, blogs, transcripts) for one or all investors from .claude/rules/codex-investors.yml; respects robots.txt and rate-limits per host.
triggers:
  - "/codex-fetch <slug>"
  - "fetch buffett letters"
  - "pull marcellus newsletters"
inputs:
  investor_slug: "string — slug from codex-investors.yml. Use --all to iterate every entry."
  force: "boolean (default false) — re-fetch even if sha256 matches"
outputs:
  - data/codex/raw/<slug>/<filename>
  - data/codex/raw/<slug>/manifest.json
  - data/investor_stalwarts/<slug>.md (stub if missing)
---

# codex-fetch

Pull canonical free public sources for one investor. Respects robots.txt; per-host 1 req/sec; logs but never crashes on partial failure.

## Procedure

1. Load `.claude/rules/codex-investors.yml`.
2. If `--all`, iterate by `priority` ascending. Else select the named slug.
3. For each `seed_url`:
   - Skip if `discovery_mode: youtube-referenced` and the URL is a `youtube.com/results?search_query=` discovery seed (those are for `codex-discover`, not `codex-fetch`).
   - Otherwise: HEAD → fetch → write to `data/codex/raw/<slug>/<sha256-prefix>.<ext>`.
   - PDFs: stream-download.
   - HTML index pages (e.g., Berkshire letters list, Oaktree memos, Damodaran blog): parse links matching `source_kinds`, recurse one level. Cap at 200 artifacts/run.
   - YouTube channels: list videos via the channel's `videos` page; **download transcripts only** (no audio/video unless transcript missing — then queue for whisper later via separate skill). One transcript per video to `data/codex/raw/<slug>/yt-<videoId>.txt`.
4. After every successful fetch, append to `data/codex/raw/<slug>/manifest.json`:
   ```json
   { "title": "...", "url": "...", "kind": "annual_letter|memo|...", "fetched_at": "...", "sha256": "...", "license_note": "..." }
   ```
5. Idempotent: skip URLs whose sha256 already appears in manifest, unless `force: true`.
6. If `data/investor_stalwarts/<slug>.md` does not exist, scaffold a stub with frontmatter from the YAML entry and `## Snapshot _(pending — run /codex-distill to populate)_`.

## Error handling

- 404 / 403 / robots-disallowed → log to manifest's `warnings[]` with reason, continue.
- Rate-limit hit → exponential backoff capped at 60s, max 3 retries.
- Partial write → delete partial file, log, continue.
- Crash → write whatever was completed; manifest is append-only-safe.

## Compliance

- Never bypass paywalls. If a URL returns a paywall page, log `paywall` warning and skip.
- Books listed with `license_note: "Citations only"` are NEVER fetched in full — only catalog metadata if a free index page exists.
- Per-host rate limit: 1 req/sec default; configurable via `FETCH_RATE_LIMIT_PER_HOST` env var.

## Example invocations

```
/codex-fetch buffett
/codex-fetch shankar-nath
/codex-fetch --all
/codex-fetch marks --force
```

## Implementation note

Skill body executed by Claude in this CLI — use Bash for HTTP (curl with rate-limited wrapper), `pdf-parse` or `pdftotext` if conversion is desired (extraction is `codex-extract`'s job), `youtube-transcript` npm CLI for YT.
