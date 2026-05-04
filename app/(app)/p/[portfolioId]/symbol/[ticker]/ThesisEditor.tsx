'use client';

import { useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';

import { CopyButton } from './CopyButton';

type ChecklistItem = { item: string; expected: 'pass' | 'fail' | 'unknown' };

type Props = {
  portfolioId: string;
  symbol: string;
  csrfToken: string;
  initial: {
    thesisMd: string;
    checklist: ChecklistItem[];
    entryDate: string | null;
    targetReviewDate: string | null;
    lastReviewedAt: string | null;
  };
};

function statusBadge(targetReviewDate: string | null, todayISO: string) {
  if (!targetReviewDate) {
    return { tone: 'neutral' as const, text: 'Unscheduled' };
  }
  const due = new Date(targetReviewDate + 'T00:00:00Z').getTime();
  const today = new Date(todayISO + 'T00:00:00Z').getTime();
  const days = Math.round((due - today) / (24 * 60 * 60 * 1000));
  if (days < 0) return { tone: 'neg' as const, text: `Overdue by ${-days}d` };
  if (days <= 14) return { tone: 'warning' as const, text: `Review due in ${days}d` };
  return { tone: 'pos' as const, text: `Up to date · ${days}d to review` };
}

export function ThesisEditor({ portfolioId, symbol, csrfToken, initial }: Props) {
  const [thesisMd, setThesisMd] = useState(initial.thesisMd);
  const [checklist, setChecklist] = useState<ChecklistItem[]>(initial.checklist);
  const [entryDate, setEntryDate] = useState(initial.entryDate ?? '');
  const [targetReviewDate, setTargetReviewDate] = useState(initial.targetReviewDate ?? '');
  const [lastReviewedAt, setLastReviewedAt] = useState(initial.lastReviewedAt);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const today = new Date().toISOString().slice(0, 10);
  const status = statusBadge(targetReviewDate || null, today);

  const stressTestInvocation = `/thesis-stress-test symbol=${symbol}`;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/p/${portfolioId}/theses/${encodeURIComponent(symbol)}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({
          thesisMd,
          checklist,
          entryDate: entryDate || null,
          targetReviewDate: targetReviewDate || null,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? 'save_failed');
      } else {
        const j = (await res.json()) as {
          thesis: { targetReviewDate: string | null; entryDate: string | null };
        };
        setTargetReviewDate(j.thesis.targetReviewDate ?? '');
        setEntryDate(j.thesis.entryDate ?? '');
        setSavedAt(new Date().toISOString());
      }
    } catch {
      setError('network_error');
    } finally {
      setSaving(false);
    }
  }

  async function markReviewed() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/p/${portfolioId}/theses/${encodeURIComponent(symbol)}/reviewed`,
        {
          method: 'POST',
          headers: { 'x-csrf-token': csrfToken },
        },
      );
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? 'failed');
      } else {
        const j = (await res.json()) as {
          thesis: { lastReviewedAt: string | null; targetReviewDate: string | null };
        };
        setLastReviewedAt(j.thesis.lastReviewedAt);
        setTargetReviewDate(j.thesis.targetReviewDate ?? '');
      }
    } catch {
      setError('network_error');
    } finally {
      setSaving(false);
    }
  }

  function addChecklistItem() {
    setChecklist((c) => [...c, { item: '', expected: 'pass' }]);
  }
  function removeChecklistItem(idx: number) {
    setChecklist((c) => c.filter((_, i) => i !== idx));
  }
  function updateChecklistItem(idx: number, patch: Partial<ChecklistItem>) {
    setChecklist((c) => c.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">Thesis</h3>
          <Badge tone={status.tone}>{status.text}</Badge>
        </div>
        <div className="flex items-center gap-2">
          <CopyButton text={stressTestInvocation} label="Copy /thesis-stress-test" />
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={markReviewed}
            disabled={saving || !initial.thesisMd}
          >
            Mark reviewed today
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-[var(--color-muted)]">Entry date</span>
          <Input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-[var(--color-muted)]">Target review date</span>
          <Input
            type="date"
            value={targetReviewDate}
            onChange={(e) => setTargetReviewDate(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-[var(--color-muted)]">Last reviewed</span>
          <Input type="date" value={lastReviewedAt ?? ''} disabled readOnly />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-xs">
        <span className="text-[var(--color-muted)]">Thesis (markdown)</span>
        <textarea
          className="min-h-[160px] w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2 font-mono text-sm focus:border-[var(--color-accent)] focus:outline-none"
          value={thesisMd}
          onChange={(e) => setThesisMd(e.target.value)}
          placeholder="## Why I bought&#10;&#10;## Key checkpoints&#10;&#10;## Exit triggers"
        />
      </label>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs text-[var(--color-muted)]">Checklist</span>
          <Button type="button" size="sm" variant="ghost" onClick={addChecklistItem}>
            + Add item
          </Button>
        </div>
        {checklist.length === 0 ? (
          <p className="text-xs text-[var(--color-muted)]">
            No checklist items. Add a few falsifiable conditions (e.g., "ROCE &gt; 18% next 4
            quarters").
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {checklist.map((c, i) => (
              <li key={i} className="flex items-center gap-2">
                <Input
                  className="flex-1"
                  value={c.item}
                  placeholder="checklist item"
                  onChange={(e) => updateChecklistItem(i, { item: e.target.value })}
                />
                <Select
                  value={c.expected}
                  onChange={(e) =>
                    updateChecklistItem(i, {
                      expected: e.target.value as ChecklistItem['expected'],
                    })
                  }
                >
                  <option value="pass">pass</option>
                  <option value="fail">fail</option>
                  <option value="unknown">unknown</option>
                </Select>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => removeChecklistItem(i)}
                >
                  ×
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs text-[var(--color-muted)]">
          {error ? (
            <span className="text-[var(--color-neg)]">Error: {error}</span>
          ) : savedAt ? (
            `Saved ${savedAt.slice(11, 19)} UTC`
          ) : (
            ''
          )}
        </span>
        <Button type="button" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save thesis'}
        </Button>
      </div>
    </div>
  );
}
