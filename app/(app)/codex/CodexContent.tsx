'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import { useMemo } from 'react';
import { CodexNav } from '@/app/(app)/codex/CodexNav';

function slugify(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

type TocEntry = { level: 2 | 3; text: string; id: string };

function extractToc(content: string): TocEntry[] {
  const toc: TocEntry[] = [];
  for (const line of content.split('\n')) {
    const h2 = line.match(/^## (.+)/);
    const h3 = line.match(/^### (.+)/);
    if (h2?.[1]) {
      const raw = h2[1].trim();
      toc.push({ level: 2, text: raw, id: slugify(raw) });
    } else if (h3?.[1]) {
      const raw = h3[1].trim();
      toc.push({ level: 3, text: raw, id: slugify(raw) });
    }
  }
  return toc;
}

function sectionBadge(text: string) {
  const m = text.match(/^(\d+(?:\.\d+)?)\.\s+(.+)/);
  return m ? { num: m[1], label: m[2] } : { num: null, label: text };
}

const components: Components = {
  h1: ({ children }) => (
    <h1 className="mb-2 text-2xl font-extrabold text-[var(--color-fg)]">{children}</h1>
  ),
  h2: ({ children }) => {
    const text = String(children ?? '');
    const { num, label } = sectionBadge(text);
    return (
      <h2
        id={slugify(text)}
        className="mt-12 mb-4 flex scroll-mt-20 items-center gap-2.5 border-b border-[var(--color-border)] pb-3 text-xl font-bold text-[var(--color-fg)] first:mt-0"
      >
        {num && (
          <span className="shrink-0 rounded bg-[var(--color-accent-soft)] px-1.5 py-0.5 text-[11px] font-bold tracking-wider text-[var(--color-accent)] uppercase ring-1 ring-[var(--color-accent)]/30">
            §{num}
          </span>
        )}
        {label}
      </h2>
    );
  },
  h3: ({ children }) => {
    const text = String(children ?? '');
    return (
      <h3
        id={slugify(text)}
        className="mt-8 mb-3 scroll-mt-20 text-base font-semibold text-[var(--color-fg)]"
      >
        {children}
      </h3>
    );
  },
  h4: ({ children }) => (
    <h4 className="mt-5 mb-2 text-[11px] font-bold tracking-widest text-[var(--color-muted)] uppercase">
      {children}
    </h4>
  ),
  p: ({ children }) => <p className="mb-3.5 leading-relaxed text-[var(--color-fg)]">{children}</p>,
  strong: ({ children }) => (
    <strong className="font-semibold text-[var(--color-fg)]">{children}</strong>
  ),
  em: ({ children }) => <em className="text-[var(--color-muted)] not-italic">{children}</em>,
  ul: ({ children }) => (
    <ul className="mb-4 ml-5 list-disc space-y-1.5 text-[var(--color-fg)]">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-4 ml-5 list-decimal space-y-1.5 text-[var(--color-fg)]">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="my-4 border-l-4 border-[var(--color-accent)] bg-[var(--color-accent-soft)]/30 py-2 pl-4 text-[var(--color-muted)] italic">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-8 border-[var(--color-border)]" />,
  // Tables
  table: ({ children }) => (
    <div className="my-5 overflow-x-auto rounded-[var(--radius-md)] border border-[var(--color-border)]">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-[var(--color-card)]">{children}</thead>,
  th: ({ children }) => (
    <th className="border-b border-[var(--color-border)] px-4 py-2.5 text-left text-[11px] font-bold tracking-wider text-[var(--color-muted)] uppercase">
      {children}
    </th>
  ),
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => (
    <tr className="border-b border-[var(--color-border)] transition-colors last:border-0 hover:bg-[var(--color-card-hover)]">
      {children}
    </tr>
  ),
  td: ({ children }) => (
    <td className="px-4 py-3 align-top text-[var(--color-fg)] [&:first-child]:font-medium">
      {children}
    </td>
  ),
  code: ({ children }) => (
    <code className="rounded bg-[var(--color-card)] px-1.5 py-0.5 font-mono text-xs text-[var(--color-accent)]">
      {children}
    </code>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-[var(--color-accent)] underline underline-offset-2 hover:text-[var(--color-accent-hover)]"
    >
      {children}
    </a>
  ),
};

export function CodexContent({ content }: { content: string }) {
  const toc = useMemo(() => extractToc(content), [content]);

  return (
    <div className="-mx-4 flex min-h-screen gap-0 sm:-mx-6">
      {/* Sticky TOC sidebar */}
      <aside className="sticky top-[57px] hidden h-[calc(100vh-57px)] w-56 shrink-0 overflow-y-auto border-r border-[var(--color-border)] py-6 pr-4 xl:block">
        <p className="mb-3 text-[10px] font-bold tracking-widest text-[var(--color-accent)] uppercase">
          Stalwarts Wisdom Codex
        </p>
        <nav className="space-y-0.5 text-xs">
          {toc.map((entry) => (
            <a
              key={entry.id}
              href={`#${entry.id}`}
              className={
                'block truncate rounded px-2 py-1 transition-colors ' +
                (entry.level === 2
                  ? 'font-semibold text-[var(--color-fg)] hover:bg-[var(--color-card-hover)]'
                  : 'pl-4 text-[var(--color-muted)] hover:bg-[var(--color-card-hover)] hover:text-[var(--color-fg)]')
              }
            >
              {sectionBadge(entry.text).label}
            </a>
          ))}
        </nav>
      </aside>

      {/* Main content */}
      <main className="min-w-0 flex-1 px-6 py-6 sm:px-8">
        {/* Page header */}
        <div className="mb-8 border-b border-[var(--color-border)] pb-6">
          <h1 className="text-2xl font-extrabold text-[var(--color-fg)]">Stalwarts Wisdom Codex</h1>
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            Consensus synthesis across 63 investor frameworks · Indian equities
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="rounded-full bg-[var(--color-accent-soft)] px-3 py-1 text-[11px] font-semibold text-[var(--color-accent)]">
              63 Investors
            </span>
            <span className="rounded-full bg-[var(--color-pos-soft)] px-3 py-1 text-[11px] font-semibold text-[var(--color-pos)]">
              Indian Equities
            </span>
            <span className="rounded-full bg-[var(--color-card)] px-3 py-1 text-[11px] font-semibold text-[var(--color-muted)] ring-1 ring-[var(--color-border)]">
              2026-05-03
            </span>
          </div>
          <CodexNav />
        </div>

        <div className="max-w-3xl">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
            {/* Strip the top-level h1 since we render our own header above */}
            {content.replace(
              /^# .+\n## A Cross.+\n\n\*\*Generated.+\n\*\*Source.+\n\*\*Purpose.+\n\n---\n\n/,
              '',
            )}
          </ReactMarkdown>
        </div>
      </main>
    </div>
  );
}
