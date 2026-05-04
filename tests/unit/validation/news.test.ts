import { describe, expect, it } from 'vitest';

import {
  NewsFileSchema,
  NewsItemSchema,
  NewsSymbolSchema,
  PatchNewsBody,
} from '@/lib/validation/news';

describe('NewsSymbolSchema', () => {
  it('accepts standard NSE-style tickers', () => {
    expect(NewsSymbolSchema.parse('hdfcbank')).toBe('HDFCBANK');
    expect(NewsSymbolSchema.parse('bel')).toBe('BEL');
    expect(NewsSymbolSchema.parse('ACME-EQ')).toBe('ACME-EQ');
    expect(NewsSymbolSchema.parse('MON100-E')).toBe('MON100-E');
    expect(NewsSymbolSchema.parse('SETFNIF50')).toBe('SETFNIF50');
  });

  it('rejects garbage', () => {
    expect(NewsSymbolSchema.safeParse('').success).toBe(false);
    expect(NewsSymbolSchema.safeParse('AB CD').success).toBe(false);
    expect(NewsSymbolSchema.safeParse('@bad').success).toBe(false);
    expect(NewsSymbolSchema.safeParse('a'.repeat(33)).success).toBe(false);
  });
});

describe('NewsItemSchema', () => {
  it('parses a well-formed item', () => {
    const out = NewsItemSchema.parse({
      title: 'BEL bags ₹2,500 cr defence order',
      url: 'https://news.google.com/rss/articles/abc?x=1',
      publishedAt: '2026-04-30T10:00:00Z',
      source: 'Economic Times',
    });
    expect(out.title).toBe('BEL bags ₹2,500 cr defence order');
  });

  it('rejects missing fields', () => {
    expect(NewsItemSchema.safeParse({ title: 'x' }).success).toBe(false);
  });

  it('rejects non-URL', () => {
    expect(
      NewsItemSchema.safeParse({
        title: 't',
        url: 'not-a-url',
        publishedAt: '2026-04-30',
        source: 'src',
      }).success,
    ).toBe(false);
  });

  it('rejects empty title / source', () => {
    expect(
      NewsItemSchema.safeParse({
        title: '',
        url: 'https://example.com/a',
        publishedAt: '2026-04-30',
        source: 'src',
      }).success,
    ).toBe(false);
    expect(
      NewsItemSchema.safeParse({
        title: 't',
        url: 'https://example.com/a',
        publishedAt: '2026-04-30',
        source: '',
      }).success,
    ).toBe(false);
  });
});

describe('NewsFileSchema', () => {
  it('parses an empty items array', () => {
    expect(NewsFileSchema.parse({ items: [] })).toEqual({ items: [] });
  });

  it('parses a multi-item file', () => {
    const out = NewsFileSchema.parse({
      items: [
        {
          title: 'A',
          url: 'https://a.com/1',
          publishedAt: '2026-04-30T10:00:00Z',
          source: 'A News',
        },
        {
          title: 'B',
          url: 'https://b.com/2',
          publishedAt: '2026-04-29T10:00:00Z',
          source: 'B News',
        },
      ],
    });
    expect(out.items).toHaveLength(2);
  });

  it('rejects missing items array', () => {
    expect(NewsFileSchema.safeParse({}).success).toBe(false);
  });

  it('rejects when one item is invalid', () => {
    expect(
      NewsFileSchema.safeParse({
        items: [
          {
            title: 'ok',
            url: 'https://a.com/1',
            publishedAt: '2026-04-30',
            source: 's',
          },
          { title: 'broken' },
        ],
      }).success,
    ).toBe(false);
  });
});

describe('PatchNewsBody', () => {
  it('accepts a valid bool', () => {
    expect(PatchNewsBody.parse({ isRead: true })).toEqual({ isRead: true });
    expect(PatchNewsBody.parse({ isRead: false })).toEqual({ isRead: false });
  });

  it('rejects empty body', () => {
    expect(PatchNewsBody.safeParse({}).success).toBe(false);
  });
});
