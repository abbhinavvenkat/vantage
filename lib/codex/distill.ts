/**
 * codex-distill — read extracted markdown for one investor and emit
 * data/codex/distilled/<slug>.json structured per `.claude/rules/codex-rule-schema.md`.
 *
 * Heuristic, no LLM. Keyword + pattern based extraction. Each emitted entry
 * carries source_url + quote + page_or_anchor, drawn from the extracted
 * markdown's paragraph anchors (`<a id="p-N"></a>`).
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export type DistilledEntry = {
  id: string;
  statement: string;
  source_url: string;
  quote: string;
  page_or_anchor: string;
  confidence: 'high' | 'medium' | 'low';
  applicability_tags: string[];
  formula?: string;
};

export type CaseStudy = {
  id: string;
  company: string;
  ticker?: string;
  year_entered?: number;
  year_exited?: number | null;
  thesis_md: string;
  outcome_md: string;
  rules_demonstrated: string[];
  source_url: string;
  quote: string;
  page_or_anchor: string;
};

export type DistilledInvestor = {
  investor_slug: string;
  investor_name: string;
  version: string;
  generated_at: string;
  principles: DistilledEntry[];
  mental_models: DistilledEntry[];
  valuation_methods: DistilledEntry[];
  position_sizing_rules: DistilledEntry[];
  buy_triggers: DistilledEntry[];
  add_triggers: DistilledEntry[];
  trim_triggers: DistilledEntry[];
  exit_triggers: DistilledEntry[];
  red_flags: DistilledEntry[];
  case_studies: CaseStudy[];
};

type ExtractedDoc = {
  filename: string;
  source_url: string;
  title: string;
  kind: string;
  paragraphs: { anchor: string; text: string }[];
};

const PARA_RE = /<a id="(p-\d+)"><\/a>\s*([\s\S]*?)(?=\n<a id="p-\d+"><\/a>|\n*$)/g;

export function parseExtractedMarkdown(md: string): {
  source_url: string;
  title: string;
  kind: string;
  paragraphs: { anchor: string; text: string }[];
} {
  // Front matter.
  let source_url = 'unknown';
  let title = '';
  let kind = 'unknown';
  const fmMatch = md.match(/^---\n([\s\S]*?)\n---\n/);
  let body = md;
  if (fmMatch) {
    const fm = fmMatch[1] ?? '';
    body = md.slice(fmMatch[0].length);
    const urlMatch = fm.match(/source_url:\s*(\S+)/);
    if (urlMatch) source_url = urlMatch[1] ?? source_url;
    const titleMatch = fm.match(/title:\s*"([^"]*)"/);
    if (titleMatch) title = titleMatch[1] ?? '';
    const kindMatch = fm.match(/kind:\s*(\S+)/);
    if (kindMatch) kind = kindMatch[1] ?? kind;
  }

  const paragraphs: { anchor: string; text: string }[] = [];
  let m: RegExpExecArray | null;
  PARA_RE.lastIndex = 0;
  while ((m = PARA_RE.exec(body)) !== null) {
    const anchor = m[1] ?? '';
    const text = (m[2] ?? '').trim();
    if (text.length === 0) continue;
    paragraphs.push({ anchor, text });
  }
  return { source_url, title, kind, paragraphs };
}

function loadInvestorDocs(slug: string, extractedRoot = 'data/codex/extracted'): ExtractedDoc[] {
  const dir = join(extractedRoot, slug);
  if (!existsSync(dir)) return [];
  const docs: ExtractedDoc[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.md')) continue;
    const md = readFileSync(join(dir, f), 'utf-8');
    const parsed = parseExtractedMarkdown(md);
    docs.push({ filename: f, ...parsed });
  }
  return docs;
}

// ---------------------------------------------------------------------------
// Extraction heuristics
// ---------------------------------------------------------------------------

type CategoryRule = {
  category: keyof Omit<
    DistilledInvestor,
    'investor_slug' | 'investor_name' | 'version' | 'generated_at' | 'case_studies'
  >;
  patterns: RegExp[];
  minLen: number;
  maxLen: number;
  tags?: string[];
};

const CATEGORIES: CategoryRule[] = [
  {
    category: 'principles',
    patterns: [
      /\bcircle of competence\b/i,
      /\bmargin of safety\b/i,
      /\bowner['’]?s? mindset\b/i,
      /\bbusiness quality\b/i,
      /\bintrinsic value\b/i,
      /\blong[- ]term\b.*\b(?:invest|owner|hold)/i,
      /\bMr\.?\s+Market\b/i,
      /\bcompound(?:er|ing)\b/i,
      /\bdurable competitive advantage\b/i,
      /\bmoat\b/i,
      /\bonly buy what you understand\b/i,
      /\bbe (?:fearful|greedy) when\b/i,
      /\bprice is what you pay,? value is what you get\b/i,
    ],
    minLen: 60,
    maxLen: 600,
    tags: ['all-markets'],
  },
  {
    category: 'mental_models',
    patterns: [
      /\bsecond[- ]level thinking\b/i,
      /\binvert(?:,?\s+always invert)?\b/i,
      /\bopportunity cost\b/i,
      /\bbase rate\b/i,
      /\blollapalooza\b/i,
      /\bprobabilistic\b/i,
      /\bcontrarian\b/i,
      /\bcycle\b.*\b(?:bull|bear|market|credit)\b/i,
      /\bnarrative\b.*\b(?:numbers|valuation|story)\b/i,
      /\bQGLP\b/i,
    ],
    minLen: 60,
    maxLen: 600,
    tags: ['all-markets'],
  },
  {
    category: 'valuation_methods',
    patterns: [
      /\bdiscounted cash flow\b/i,
      /\bDCF\b/,
      /\bowner earnings\b/i,
      /\b(?:price[- ]to[- ]earnings|P\/E)\b/i,
      /\bEV\/EBITDA\b/i,
      /\bterminal value\b/i,
      /\bcost of capital\b/i,
      /\bweighted average cost of capital\b|\bWACC\b/,
      /\breturn on (?:equity|capital employed)\b|\bROCE\b|\bROIC\b/i,
      /\bgrowth at (?:a )?reasonable price\b|\bGARP\b/i,
      /\bfair value\b/i,
    ],
    minLen: 60,
    maxLen: 700,
    tags: ['all-markets'],
  },
  {
    category: 'position_sizing_rules',
    patterns: [
      /\bposition siz(?:e|ing)\b/i,
      /\bconcentrat(?:e|ed|ion)\b.*\b(?:bets|positions|portfolio)\b/i,
      /\bdiversif(?:y|ication)\b/i,
      /\bKelly\b/,
      /\bover-?weight\b|\bunder-?weight\b/i,
      /\b\d{1,2}%\s*(?:of|the|in)\s*(?:portfolio|positions?)\b/i,
    ],
    minLen: 50,
    maxLen: 500,
  },
  {
    category: 'buy_triggers',
    patterns: [
      /\bwe (?:bought|added|purchased|established)\b/i,
      /\bbuy when\b/i,
      /\battractive entry\b/i,
      /\bdiscount to (?:intrinsic|fair) value\b/i,
      /\bavailable at (?:a )?(?:reasonable|cheap|attractive)\b/i,
      /\bopportunity to buy\b/i,
      /\bquality (?:business|company) at (?:a )?(?:fair|reasonable)\b/i,
    ],
    minLen: 60,
    maxLen: 600,
  },
  {
    category: 'add_triggers',
    patterns: [
      /\baverage(?:d)? down\b/i,
      /\badd(?:ed)? to (?:our|the) position\b/i,
      /\bincrease(?:d)? our holding\b/i,
      /\btemporary (?:setback|concern|narrative)\b/i,
    ],
    minLen: 60,
    maxLen: 500,
  },
  {
    category: 'trim_triggers',
    patterns: [
      /\btrim(?:med)?\b/i,
      /\breduc(?:e|ed) (?:our|the) position\b/i,
      /\bovervalued\b/i,
      /\bextreme valuation\b/i,
      /\bfroth\b/i,
    ],
    minLen: 60,
    maxLen: 500,
  },
  {
    category: 'exit_triggers',
    patterns: [
      /\bs(?:o|a)ld (?:our|the) (?:position|stake)\b/i,
      /\bexit(?:ed)? (?:the|our) position\b/i,
      /\bthesis (?:broke|broken|invalidated)\b/i,
      /\bmanagement (?:lied|misled|disappointed)\b/i,
      /\bcapital allocation (?:errors?|mistakes?)\b/i,
    ],
    minLen: 60,
    maxLen: 500,
  },
  {
    category: 'red_flags',
    patterns: [
      /\baccounting (?:fraud|irregularit|red flag|gimmick)/i,
      /\bpromoter (?:pledg|sell)/i,
      /\bauditor (?:resign|change|qualif)/i,
      /\brelated[- ]party transaction/i,
      /\bgoodwill (?:write[- ]?off|impair)/i,
      /\bdebt (?:rising|spike|increase)\b.*\b(?:equity|cash)/i,
      /\binventor(?:y|ies) (?:bloat|build)/i,
      /\breceivable(?:s)? (?:rising|spike)/i,
      /\bcash conversion (?:falling|deteriorat)/i,
      /\bchurn (?:rising|increase)/i,
      /\bcorporate governance/i,
      /\bavoid\b.*\b(?:business|company|stock|sector)/i,
    ],
    minLen: 40,
    maxLen: 400,
  },
];

const CASE_STUDY_RE =
  /\b(?:Coca[- ]Cola|See['’]?s Candies|GEICO|American Express|Apple|Wells Fargo|Costco|Berkshire|HDFC|Bajaj|Page Industries|Asian Paints|Pidilite|Eicher|Maruti|Titan|Nestle|Britannia|HUL|TCS|Infosys|Wipro|Reliance|ICICI|Axis|Kotak|SBI|Marico|Dabur|Colgate|Tata|Bajaj|Nalanda)\b/;

function shortQuote(text: string, maxLen = 280): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen).replace(/\s+\S*$/, '') + '…';
}

function statementFromQuote(quote: string, maxLen = 220): string {
  // Try to take first sentence or first chunk.
  const stop = quote.search(/[.!?](?=\s|$)/);
  const first = stop > 0 ? quote.slice(0, stop + 1) : quote;
  if (first.length <= maxLen) return first.trim();
  return first.slice(0, maxLen).replace(/\s+\S*$/, '') + '…';
}

function inferTags(quote: string, defaults: string[] = []): string[] {
  const tags = new Set(defaults);
  if (/\bcompound(?:er|ing)\b|\bquality\b/i.test(quote)) tags.add('compounders');
  if (/\bsmall[- ]cap\b/i.test(quote)) tags.add('small-cap');
  if (/\bcyclical\b|\bcycle\b/i.test(quote)) tags.add('cyclicals');
  if (/\bIndia(?:n)?\b/i.test(quote)) tags.add('indian-equities');
  if (/\bUS|United States\b/i.test(quote)) tags.add('us-equities');
  if (/\bemerging market\b/i.test(quote)) tags.add('emerging-markets');
  if (tags.size === 0) tags.add('all-markets');
  return [...tags];
}

export function distillInvestor(
  slug: string,
  name: string,
  extractedRoot = 'data/codex/extracted',
  opts: { dedupePerCategory?: number } = {},
): DistilledInvestor {
  const dedupePerCategory = opts.dedupePerCategory ?? 12;
  const docs = loadInvestorDocs(slug, extractedRoot);

  const out: DistilledInvestor = {
    investor_slug: slug,
    investor_name: name,
    version: '0.1.0',
    generated_at: new Date().toISOString(),
    principles: [],
    mental_models: [],
    valuation_methods: [],
    position_sizing_rules: [],
    buy_triggers: [],
    add_triggers: [],
    trim_triggers: [],
    exit_triggers: [],
    red_flags: [],
    case_studies: [],
  };

  // For each paragraph, find first matching category. Add to that bucket.
  const seen: Map<string, Set<string>> = new Map();
  for (const cat of CATEGORIES) seen.set(cat.category, new Set());

  let entryCounter = 0;
  for (const doc of docs) {
    for (const p of doc.paragraphs) {
      if (p.text.length < 40) continue;
      for (const rule of CATEGORIES) {
        if (p.text.length < rule.minLen || p.text.length > rule.maxLen) continue;
        const matched = rule.patterns.some((re) => re.test(p.text));
        if (!matched) continue;
        const bucket = out[rule.category];
        const seenSet = seen.get(rule.category)!;
        if (bucket.length >= dedupePerCategory) break;
        // De-dupe by first 60 chars normalised.
        const key = p.text.slice(0, 80).toLowerCase().replace(/\s+/g, ' ');
        if (seenSet.has(key)) break;
        seenSet.add(key);
        entryCounter += 1;
        const quote = shortQuote(p.text);
        const entry: DistilledEntry = {
          id: `${slug}.${rule.category}.${entryCounter}`,
          statement: statementFromQuote(quote),
          source_url: doc.source_url,
          quote,
          page_or_anchor: p.anchor,
          confidence: rule.patterns.length > 5 ? 'high' : 'medium',
          applicability_tags: inferTags(p.text, rule.tags ?? []),
        };
        bucket.push(entry);
        break;
      }

      // Case studies
      if (out.case_studies.length < 8) {
        const m = p.text.match(CASE_STUDY_RE);
        if (m && /\b(?:bought|sold|owned|invested|exited|trimmed|added|holding)\b/i.test(p.text)) {
          const company = m[0];
          out.case_studies.push({
            id: `${slug}.case.${out.case_studies.length + 1}`,
            company,
            year_exited: null,
            thesis_md: shortQuote(p.text, 400),
            outcome_md: '',
            rules_demonstrated: [],
            source_url: doc.source_url,
            quote: shortQuote(p.text),
            page_or_anchor: p.anchor,
          });
        }
      }
    }
  }

  return out;
}

export function writeDistilled(
  distilled: DistilledInvestor,
  outRoot = 'data/codex/distilled',
): string {
  if (!existsSync(outRoot)) mkdirSync(outRoot, { recursive: true });
  const path = join(outRoot, `${distilled.investor_slug}.json`);
  writeFileSync(path, JSON.stringify(distilled, null, 2), 'utf-8');
  return path;
}

export function totalEntries(d: DistilledInvestor): number {
  return (
    d.principles.length +
    d.mental_models.length +
    d.valuation_methods.length +
    d.position_sizing_rules.length +
    d.buy_triggers.length +
    d.add_triggers.length +
    d.trim_triggers.length +
    d.exit_triggers.length +
    d.red_flags.length
  );
}
