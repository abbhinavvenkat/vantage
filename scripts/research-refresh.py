#!/usr/bin/env python3
"""
research-refresh.py — Full research pipeline for a single symbol.

Emits newline-delimited JSON progress events to stdout (flushed immediately).
The SSE API route streams these as server-sent events to the browser.

Usage:
    python3 scripts/research-refresh.py <SYMBOL> [<PORTFOLIO_ID>]

Each emitted line is a JSON object with a "type" field:
    step_start   {"type":"step_start","step":N,"name":"..."}
    step_done    {"type":"step_done","step":N,"name":"..."}
    step_skipped {"type":"step_skipped","step":N,"name":"...","reason":"..."}
    step_error   {"type":"step_error","step":N,"name":"...","message":"..."}
    done         {"type":"done"}

Staleness rules per step:
  1. company-research-fetch  — always runs; idempotent, checks remote SHA256.
  2. annual-report-summarize — runs per FY in manifest where summary is missing
                               or the source PDF is newer than the summary JSON.
  3. earnings-call-digest    — runs per FQ in manifest where digest is missing
                               or the source transcript is newer than the digest.
  4. management-accountability — runs if any new digest was produced in step 3,
                                 or the newest ECD is newer than latest accountability.
  5. thesis-stress-test      — always runs (reads thesis from DB, needs fresh verdict).
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path


def emit(obj: dict) -> None:
    print(json.dumps(obj), flush=True)


def file_mtime(path: str | Path) -> float:
    p = Path(path)
    try:
        return p.stat().st_mtime if p.exists() else 0.0
    except OSError:
        return 0.0


def newest_mtime(directory: Path) -> float:
    if not directory.is_dir():
        return 0.0
    mtimes = [f.stat().st_mtime for f in directory.glob("*.json") if f.is_file()]
    return max(mtimes, default=0.0)


def run_skill(step: int, name: str, prompt: str) -> bool:
    emit({"type": "step_start", "step": step, "name": name})
    try:
        result = subprocess.run(
            ["claude", "-p", prompt, "--skip-permissions"],
            capture_output=True,
            text=True,
            timeout=600,
        )
        if result.returncode == 0:
            emit({"type": "step_done", "step": step, "name": name})
            return True
        # Grab last few lines of output for the error message.
        raw = (result.stderr or result.stdout or "unknown error").strip()
        last_lines = " | ".join(raw.splitlines()[-3:])
        emit({"type": "step_error", "step": step, "name": name, "message": last_lines})
        return False
    except subprocess.TimeoutExpired:
        emit({"type": "step_error", "step": step, "name": name, "message": "timed out after 10 min"})
        return False
    except FileNotFoundError:
        emit({"type": "step_error", "step": step, "name": name, "message": "'claude' binary not found in PATH"})
        return False


def main() -> None:
    if len(sys.argv) < 2:
        emit({"type": "error", "message": "Usage: research-refresh.py <SYMBOL> [<PORTFOLIO_ID>]"})
        sys.exit(1)

    symbol = sys.argv[1].upper()
    portfolio_id = sys.argv[2] if len(sys.argv) > 2 else ""

    data_root = Path(os.environ.get("RESEARCH_DATA_ROOT", "data"))
    sources_dir = data_root / "sources" / symbol
    research_dir = data_root / "research" / symbol
    manifest_path = sources_dir / "manifest.json"

    # ── Step 1: Fetch sources (always — checks remote SHA256, idempotent) ──
    run_skill(1, "Fetch sources", f"/company-research-fetch symbol={symbol}")

    # ── Load manifest written/updated by Step 1 ───────────────────────────
    sources: list[dict] = []
    if manifest_path.exists():
        try:
            sources = json.loads(manifest_path.read_text()).get("sources", [])
        except Exception:
            pass

    # ── Step 2: Annual report summaries (per FY, staleness-checked) ───────
    ar_sources = [s for s in sources if s.get("type") == "annual_report" and s.get("fy")]
    # Dedupe, sort newest-first, cap at 3 most recent FYs.
    seen_fys: set[str] = set()
    ar_entries: list[tuple[str, str]] = []
    for s in sorted(ar_sources, key=lambda x: x.get("fy", ""), reverse=True):
        fy = s["fy"]
        if fy not in seen_fys:
            seen_fys.add(fy)
            ar_entries.append((fy, s.get("local_path", "")))
        if len(ar_entries) >= 3:
            break

    for fy, local_path in ar_entries:
        summary_path = research_dir / "annual-report-summarize" / f"{fy}.json"
        source_mtime = file_mtime(local_path) if local_path else 0.0
        summary_mtime = file_mtime(summary_path)

        if not summary_path.exists() or source_mtime > summary_mtime:
            run_skill(2, f"AR summary {fy}", f"/annual-report-summarize symbol={symbol} fy={fy}")
        else:
            emit({"type": "step_skipped", "step": 2, "name": f"AR summary {fy}", "reason": "source unchanged"})

    # ── Step 3: Earnings call digests (per FQ, staleness-checked) ─────────
    concall_sources = [s for s in sources if s.get("type") == "concall_transcript" and s.get("fq")]
    seen_fqs: set[str] = set()
    concall_entries: list[tuple[str, str]] = []
    for s in sorted(concall_sources, key=lambda x: x.get("fq", ""), reverse=True):
        fq = s["fq"]
        if fq not in seen_fqs:
            seen_fqs.add(fq)
            concall_entries.append((fq, s.get("local_path", "")))
        if len(concall_entries) >= 6:
            break

    new_digests = 0
    for fq, local_path in concall_entries:
        digest_path = research_dir / "earnings-call-digest" / f"{fq}.json"
        source_mtime = file_mtime(local_path) if local_path else 0.0
        digest_mtime = file_mtime(digest_path)

        if not digest_path.exists() or source_mtime > digest_mtime:
            if run_skill(3, f"ECD {fq}", f"/earnings-call-digest symbol={symbol} fq={fq}"):
                new_digests += 1
        else:
            emit({"type": "step_skipped", "step": 3, "name": f"ECD {fq}", "reason": "source unchanged"})

    # ── Step 4: Management accountability ─────────────────────────────────
    ecd_dir = research_dir / "earnings-call-digest"
    accountability_dir = research_dir / "management-accountability"
    newest_ecd = newest_mtime(ecd_dir)
    newest_accountability = newest_mtime(accountability_dir)

    if new_digests > 0 or newest_ecd > newest_accountability:
        run_skill(4, "Management accountability", f"/management-accountability symbol={symbol}")
    else:
        emit({"type": "step_skipped", "step": 4, "name": "Management accountability", "reason": "no new digests"})

    # ── Step 5: Thesis stress test (always — reads thesis from DB) ─────────
    prompt = f"/thesis-stress-test symbol={symbol}"
    if portfolio_id:
        prompt += f" portfolio_id={portfolio_id}"
    run_skill(5, "Thesis stress test", prompt)

    emit({"type": "done"})


if __name__ == "__main__":
    main()
