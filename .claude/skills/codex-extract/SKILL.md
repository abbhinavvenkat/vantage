---
name: codex-extract
description: Convert raw fetched artifacts (PDF/HTML/YT transcripts) under data/codex/raw/<slug>/ into clean markdown with paragraph anchors at data/codex/extracted/<slug>/.
triggers:
  - "/codex-extract <slug>"
inputs:
  investor_slug: "string"
  format_filter: "optional — pdf|html|yt|all (default all)"
outputs:
  - data/codex/extracted/<slug>/<source-id>.md
  - data/codex/extracted/<slug>/index.json
---

# codex-extract

Normalize fetched artifacts into clean, citable markdown. Each paragraph anchored as `<a id="p-{n}"></a>` so distillation can cite back.

## Procedure

1. Read `data/codex/raw/<slug>/manifest.json`.
2. For each source not yet present in `data/codex/extracted/<slug>/index.json`:
   - **PDF** → text extraction via `pdftotext -layout` (poppler) or `pdf-parse`. Strip headers/footers (regex on page numbers, repeated phrases). Re-flow paragraphs.
   - **HTML** → `cheerio`/`jsdom` to strip nav/scripts/footers; preserve headings; convert to markdown via `turndown`.
   - **YouTube transcript** → already plain text from `youtube-transcript`; group into paragraphs every ~3 sentences or 30 seconds whichever first.
3. Insert anchors: every paragraph prefixed with `<a id="p-{n}"></a>` where n increments from 1.
4. Write to `data/codex/extracted/<slug>/<sha256-prefix>.md`.
5. Update `data/codex/extracted/<slug>/index.json`:
   ```json
   [{ "source_sha256": "...", "extracted_path": "...", "anchor_count": 142, "char_count": 88234, "extracted_at": "..." }]
   ```

## Error handling

- PDF parse failure → log + skip; don't crash the batch.
- HTML missing main content → fall back to full body, log a warning.
- Empty transcript → skip and mark in index.json with `error: "empty"`.

## Quality

- Strip duplicate paragraphs (same hash).
- Preserve list structures and tables where possible (Markdown tables for HTML tables).
- Keep code/quote blocks as fenced markdown.
