'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/Button';

// ── Event types emitted by research-refresh.py ──────────────────────────────

type ProgressEvent =
  | { type: 'step_start'; step: number; name: string }
  | { type: 'step_done'; step: number; name: string }
  | { type: 'step_skipped'; step: number; name: string; reason: string }
  | { type: 'step_error'; step: number; name: string; message: string }
  | { type: 'done' }
  | { type: 'close'; code: number | null }
  | { type: 'error'; message: string };

// ── Per-row state ─────────────────────────────────────────────────────────────

type RowStatus = 'running' | 'done' | 'skipped' | 'error';

type Row = {
  id: string;
  step: number;
  name: string;
  status: RowStatus;
  note?: string;
};

const STEP_GROUP: Record<number, string> = {
  1: 'Sources',
  2: 'AR',
  3: 'ECD',
  4: 'Accountability',
  5: 'Stress test',
};

const STATUS_GLYPH: Record<RowStatus, string> = {
  running: '⟳',
  done: '✓',
  skipped: '–',
  error: '✗',
};

const STATUS_COLOR: Record<RowStatus, string> = {
  running: 'var(--color-accent)',
  done: 'var(--color-pos)',
  skipped: 'var(--color-muted)',
  error: 'var(--color-neg)',
};

// ── Component ─────────────────────────────────────────────────────────────────

export function RefreshResearchButton({
  portfolioId,
  symbol,
}: {
  portfolioId: string;
  symbol: string;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<'idle' | 'running' | 'done'>('idle');
  const [rows, setRows] = useState<Row[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  // Upsert a row by (step, name) key.
  function upsertRow(step: number, name: string, patch: Partial<Row>) {
    const id = `${step}:${name}`;
    setRows((prev) => {
      const idx = prev.findIndex((r) => r.id === id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx]!, ...patch };
        return next;
      }
      return [...prev, { id, step, name, status: 'running', ...patch }];
    });
  }

  function applyEvent(ev: ProgressEvent) {
    if (ev.type === 'step_start') {
      upsertRow(ev.step, ev.name, { status: 'running' });
    } else if (ev.type === 'step_done') {
      upsertRow(ev.step, ev.name, { status: 'done' });
    } else if (ev.type === 'step_skipped') {
      upsertRow(ev.step, ev.name, { status: 'skipped', note: ev.reason });
    } else if (ev.type === 'step_error') {
      upsertRow(ev.step, ev.name, { status: 'error', note: ev.message });
    }
    // 'done' / 'close' / 'error' handled in the finally block
  }

  async function run() {
    if (phase === 'running') {
      abortRef.current?.abort();
      return;
    }
    setRows([]);
    setPhase('running');

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const res = await fetch(
        `/api/p/${portfolioId}/research/${encodeURIComponent(symbol)}/refresh`,
        { method: 'POST', signal: ctrl.signal },
      );

      if (!res.ok || !res.body) {
        setPhase('done');
        return;
      }

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';

      // SSE frame loop: each frame is "data: <json>\n\n"
      reading: while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const frames = buf.split('\n\n');
        buf = frames.pop() ?? '';
        for (const frame of frames) {
          const dataLine = frame.split('\n').find((l) => l.startsWith('data: '));
          if (!dataLine) continue;
          const raw = dataLine.slice(6).trim();
          if (!raw) continue;
          try {
            const ev = JSON.parse(raw) as ProgressEvent;
            applyEvent(ev);
            if (ev.type === 'done' || ev.type === 'close') break reading;
          } catch {
            // malformed JSON — skip
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
    } finally {
      setPhase('done');
      // Re-render the server component tree so new research data is shown.
      router.refresh();
    }
  }

  const btnLabel = phase === 'running' ? 'Cancel' : phase === 'done' ? 'Re-run all' : 'Refresh all';

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs text-[var(--color-muted)]">
            Checks sources for new data, then runs all 5 research skills in order.
          </p>
        </div>
        <Button
          type="button"
          variant={phase === 'running' ? 'secondary' : 'primary'}
          size="sm"
          onClick={run}
        >
          {btnLabel}
        </Button>
      </div>

      {rows.length > 0 && (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card-hover)] px-3 py-2">
          <ul className="flex flex-col gap-1.5">
            {rows.map((row) => (
              <li key={row.id} className="flex min-w-0 items-center gap-2 text-xs">
                {/* Status glyph */}
                <span
                  className={row.status === 'running' ? 'animate-spin' : ''}
                  style={{
                    color: STATUS_COLOR[row.status],
                    display: 'inline-block',
                    width: '1ch',
                    textAlign: 'center',
                    flexShrink: 0,
                  }}
                >
                  {STATUS_GLYPH[row.status]}
                </span>
                {/* Step group badge */}
                <span className="shrink-0 rounded bg-[var(--color-card)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-muted)]">
                  {STEP_GROUP[row.step] ?? `Step ${row.step}`}
                </span>
                {/* Name */}
                <span
                  className={
                    row.status === 'skipped'
                      ? 'truncate text-[var(--color-muted)]'
                      : row.status === 'error'
                        ? 'truncate text-[var(--color-neg)]'
                        : 'truncate text-[var(--color-fg)]'
                  }
                >
                  {row.name}
                </span>
                {/* Optional note */}
                {row.note && (
                  <span className="shrink-0 text-[10px] text-[var(--color-muted)]">
                    — {row.note}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {phase === 'done' && (
            <p className="mt-2 text-[10px] text-[var(--color-muted)]">
              Page data reloaded. Scroll up to see updated research.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
