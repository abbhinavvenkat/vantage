'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';

import { PortfolioSwitcher } from '@/app/(app)/PortfolioSwitcher';
import { ThemeToggle } from '@/app/(app)/ThemeToggle';
import { Bell, BookOpen, Briefcase, ChevronDown, LogOut, Menu, X } from '@/components/ui/Icons';

type Portfolio = { id: string; name: string };

type NavItem = { key: string; label: string };
type NavGroup =
  | { kind: 'link'; key: string; label: string }
  | { kind: 'group'; id: string; label: string; items: NavItem[] };

const NAV_GROUPS: NavGroup[] = [
  { kind: 'link', key: 'holdings', label: 'Holdings' },
  { kind: 'link', key: 'analytics', label: 'Analytics' },
  { kind: 'link', key: 'research', label: 'Research' },
  { kind: 'link', key: 'actions', label: 'Actions' },
  { kind: 'link', key: 'recommendations', label: 'Recommendations' },
];

function parsePath(pathname: string): { currentId: string | null; sub: string } {
  const m = pathname.match(/^\/p\/([^/]+)\/?([^/?#]*)/);
  if (!m) return { currentId: null, sub: 'holdings' };
  const id = m[1] ?? null;
  const sub = m[2] && m[2].length > 0 ? m[2] : 'holdings';
  return { currentId: id, sub };
}

export function HeaderClient({ portfolios }: { portfolios: Portfolio[] }) {
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [userOpen, setUserOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  const [mobileExpanded, setMobileExpanded] = useState<Set<string>>(new Set());
  const userRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const { currentId, sub } = parsePath(pathname);
  const [unacked, setUnacked] = useState<number>(0);

  useEffect(() => {
    if (!currentId) {
      setUnacked(0);
      return;
    }
    let cancelled = false;
    fetch(`/api/p/${currentId}/alerts/events?count=1`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled) return;
        const n = (j as { unacked?: number } | null)?.unacked ?? 0;
        setUnacked(n);
      })
      .catch(() => {
        if (!cancelled) setUnacked(0);
      });
    return () => {
      cancelled = true;
    };
  }, [currentId, pathname]);

  useEffect(() => {
    if (!userOpen) return;
    function onDoc(e: MouseEvent) {
      if (userRef.current && !userRef.current.contains(e.target as Node)) setUserOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [userOpen]);

  // Close any open dropdown when clicking outside the nav region.
  useEffect(() => {
    if (!openGroupId) return;
    function onDoc(e: MouseEvent) {
      if (navRef.current && !navRef.current.contains(e.target as Node)) setOpenGroupId(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpenGroupId(null);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [openGroupId]);

  // Close menus on route change.
  useEffect(() => {
    setMobileOpen(false);
    setOpenGroupId(null);
  }, [pathname]);

  async function logout() {
    const csrfRes = await fetch('/api/auth/csrf');
    const { token } = (await csrfRes.json().catch(() => ({}))) as { token?: string };
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: token ? { 'x-csrf-token': token } : undefined,
    });
    startTransition(() => {
      router.push('/login');
      router.refresh();
    });
  }

  function toggleMobileGroup(id: string): void {
    setMobileExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="flex flex-1 items-center justify-between gap-3">
      <div className="flex items-center gap-2 sm:gap-4">
        {portfolios.length > 0 ? (
          <PortfolioSwitcher portfolios={portfolios} currentId={currentId} currentSub={sub} />
        ) : (
          <Link
            href="/portfolios"
            className="text-sm text-[var(--color-muted)] hover:text-[var(--color-fg)]"
          >
            No portfolios — create one
          </Link>
        )}
        {currentId ? (
          <nav ref={navRef} className="hidden items-center gap-0.5 lg:flex">
            {NAV_GROUPS.map((g) => {
              if (g.kind === 'link') {
                const href = `/p/${currentId}/${g.key}` as Route;
                const active = sub === g.key;
                return (
                  <Link
                    key={g.key}
                    href={href}
                    className={
                      'rounded-[var(--radius-md)] px-3 py-1.5 text-sm font-medium transition-colors ' +
                      (active
                        ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                        : 'text-[var(--color-muted)] hover:bg-[var(--color-card-hover)] hover:text-[var(--color-fg)]')
                    }
                  >
                    {g.label}
                  </Link>
                );
              }
              const open = openGroupId === g.id;
              const groupActive = g.items.some((it) => it.key === sub);
              return (
                <div key={g.id} className="relative">
                  <button
                    type="button"
                    aria-haspopup="menu"
                    aria-expanded={open}
                    onClick={() => setOpenGroupId(open ? null : g.id)}
                    className={
                      'inline-flex items-center gap-1 rounded-[var(--radius-md)] px-3 py-1.5 text-sm font-medium transition-colors ' +
                      (groupActive || open
                        ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                        : 'text-[var(--color-muted)] hover:bg-[var(--color-card-hover)] hover:text-[var(--color-fg)]')
                    }
                  >
                    {g.label}
                    <ChevronDown
                      size={12}
                      className={'transition-transform ' + (open ? 'rotate-180' : '')}
                    />
                  </button>
                  {open ? (
                    <div
                      role="menu"
                      className="animate-fade-in absolute left-0 z-40 mt-1.5 min-w-[210px] overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-elevated)] p-1 shadow-[var(--shadow-md)]"
                    >
                      {g.items.map((it) => {
                        const href = `/p/${currentId}/${it.key}` as Route;
                        const itemActive = sub === it.key;
                        return (
                          <Link
                            key={it.key}
                            href={href}
                            role="menuitem"
                            className={
                              'block rounded-[6px] px-3 py-2 text-sm transition-colors ' +
                              (itemActive
                                ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                                : 'text-[var(--color-fg)] hover:bg-[var(--color-card-hover)]')
                            }
                          >
                            {it.label}
                          </Link>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </nav>
        ) : null}
      </div>

      <div className="flex items-center gap-1.5">
        <Link
          href="/portfolios"
          className="hidden items-center gap-1.5 rounded-[var(--radius-md)] px-3 py-1.5 text-sm text-[var(--color-muted)] transition-colors hover:bg-[var(--color-card-hover)] hover:text-[var(--color-fg)] sm:inline-flex"
        >
          <Briefcase size={14} />
          Portfolios
        </Link>
        <Link
          href="/codex"
          className={
            'hidden items-center gap-1.5 rounded-[var(--radius-md)] px-3 py-1.5 text-sm transition-colors sm:inline-flex ' +
            (pathname === '/codex'
              ? 'bg-[var(--color-accent-soft)] font-medium text-[var(--color-accent)]'
              : 'text-[var(--color-muted)] hover:bg-[var(--color-card-hover)] hover:text-[var(--color-fg)]')
          }
        >
          <BookOpen size={14} />
          Stalwarts Wisdom Codex
        </Link>

        {currentId ? (
          <Link
            href={`/p/${currentId}/research?section=alerts` as Route}
            aria-label={unacked > 0 ? `${unacked} unacknowledged alerts` : 'Alerts'}
            className="relative inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-fg)] transition-colors hover:bg-[var(--color-card-hover)]"
          >
            <Bell size={16} />
            {unacked > 0 ? (
              <span className="absolute -top-1 -right-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[var(--color-neg)] px-1 text-[10px] font-semibold text-white">
                {unacked > 99 ? '99+' : unacked}
              </span>
            ) : null}
          </Link>
        ) : null}

        <ThemeToggle />

        {/* User menu */}
        <div className="relative hidden sm:block" ref={userRef}>
          <button
            type="button"
            aria-label="User menu"
            onClick={() => setUserOpen((o) => !o)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-card)] text-sm font-semibold text-[var(--color-fg)] transition-colors hover:bg-[var(--color-card-hover)]"
          >
            <span aria-hidden>A</span>
          </button>
          {userOpen ? (
            <div className="animate-fade-in absolute right-0 z-40 mt-1.5 min-w-[180px] overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-elevated)] p-1 shadow-[var(--shadow-md)]">
              <button
                type="button"
                onClick={logout}
                disabled={isPending}
                className="flex w-full items-center gap-2 rounded-[6px] px-2.5 py-2 text-left text-sm text-[var(--color-fg)] transition-colors hover:bg-[var(--color-card-hover)] disabled:opacity-50"
              >
                <LogOut size={14} />
                {isPending ? 'Signing out…' : 'Sign out'}
              </button>
            </div>
          ) : null}
        </div>

        {/* Mobile menu trigger */}
        <button
          type="button"
          aria-label="Open menu"
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen((o) => !o)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-fg)] transition-colors hover:bg-[var(--color-card-hover)] lg:hidden"
        >
          {mobileOpen ? <X size={16} /> : <Menu size={16} />}
        </button>
      </div>

      {/* Mobile drawer */}
      {mobileOpen ? (
        <div className="animate-fade-in absolute top-full right-0 left-0 z-30 border-b border-[var(--color-border)] bg-[var(--color-elevated)] shadow-[var(--shadow-md)] lg:hidden">
          <div className="mx-auto flex w-full max-w-7xl flex-col gap-1 px-4 py-3 sm:px-6">
            {currentId
              ? NAV_GROUPS.map((g) => {
                  if (g.kind === 'link') {
                    const href = `/p/${currentId}/${g.key}` as Route;
                    const active = sub === g.key;
                    return (
                      <Link
                        key={g.key}
                        href={href}
                        className={
                          'rounded-[var(--radius-md)] px-3 py-2 text-sm font-medium transition-colors ' +
                          (active
                            ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                            : 'text-[var(--color-fg)] hover:bg-[var(--color-card-hover)]')
                        }
                      >
                        {g.label}
                      </Link>
                    );
                  }
                  const expanded = mobileExpanded.has(g.id);
                  const groupActive = g.items.some((it) => it.key === sub);
                  return (
                    <div key={g.id} className="flex flex-col">
                      <button
                        type="button"
                        onClick={() => toggleMobileGroup(g.id)}
                        className={
                          'flex items-center justify-between rounded-[var(--radius-md)] px-3 py-2 text-sm font-medium transition-colors ' +
                          (groupActive
                            ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                            : 'text-[var(--color-fg)] hover:bg-[var(--color-card-hover)]')
                        }
                      >
                        {g.label}
                        <ChevronDown
                          size={14}
                          className={'transition-transform ' + (expanded ? 'rotate-180' : '')}
                        />
                      </button>
                      {expanded ? (
                        <div className="mt-0.5 ml-3 flex flex-col gap-0.5 border-l border-[var(--color-border)] pl-2">
                          {g.items.map((it) => {
                            const href = `/p/${currentId}/${it.key}` as Route;
                            const itemActive = sub === it.key;
                            return (
                              <Link
                                key={it.key}
                                href={href}
                                className={
                                  'rounded-[var(--radius-md)] px-3 py-1.5 text-sm transition-colors ' +
                                  (itemActive
                                    ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                                    : 'text-[var(--color-muted)] hover:bg-[var(--color-card-hover)] hover:text-[var(--color-fg)]')
                                }
                              >
                                {it.label}
                              </Link>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  );
                })
              : null}
            <Link
              href="/portfolios"
              className="rounded-[var(--radius-md)] px-3 py-2 text-sm text-[var(--color-muted)] hover:bg-[var(--color-card-hover)] hover:text-[var(--color-fg)]"
            >
              Manage portfolios
            </Link>
            <Link
              href="/codex"
              className="flex items-center gap-2 rounded-[var(--radius-md)] px-3 py-2 text-sm text-[var(--color-muted)] hover:bg-[var(--color-card-hover)] hover:text-[var(--color-fg)]"
            >
              <BookOpen size={14} />
              Stalwarts Wisdom Codex
            </Link>
            <button
              type="button"
              onClick={logout}
              disabled={isPending}
              className="flex w-full items-center gap-2 rounded-[var(--radius-md)] px-3 py-2 text-left text-sm text-[var(--color-fg)] hover:bg-[var(--color-card-hover)] disabled:opacity-50"
            >
              <LogOut size={14} />
              {isPending ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
