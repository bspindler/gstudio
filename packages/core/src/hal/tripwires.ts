// Hal tripwires: pure checks over a candidate diff. Any hit rejects the candidate before it can merge.
// No fs, no clock, no randomness: scripts/hal/git.ts builds the Diff, this file only judges it.

export type FileChange = {
  path: string;
  status: 'A' | 'M' | 'D' | 'R';
  before: string | null;
  after: string | null;
  binary: boolean;
  /** Renames only: the path the file had at the base. Both paths are checked by the path rules. */
  oldPath?: string;
  /** The change is (or becomes) a symlink. `after` then holds the link target, never the linked file. */
  symlink?: boolean;
};

export type Diff = {
  files: FileChange[];
  testCountBefore: number;
  testCountAfter: number;
  levelCounts: { before: Record<string, number>; after: Record<string, number> };
  /** Every tracked path in the candidate tree, so rules can see files the diff did not touch (e.g. an existing OFL license). */
  repoFiles?: string[];
};

export type Violation = { rule: string; path?: string; detail: string };
export type Rule = (diff: Diff) => Violation[];

// ---- path helpers --------------------------------------------------------

/** Lower-cased (macOS is case-insensitive, so `POLICY.yaml` is `policy.yaml`), forward slashes, no leading `./`. */
const norm = (p: string): string => p.replace(/\\/g, '/').replace(/^(\.\/)+/, '').toLowerCase();
const touched = (f: FileChange): string[] => (f.oldPath ? [f.path, f.oldPath] : [f.path]);

const PROTECTED_PREFIXES = ['packages/core/src/hal/', 'scripts/hal/', '.data/', 'infra/', '.github/', 'docs/superpowers/'];
const PROTECTED_EXACT = new Set(['scripts/hal.ts', 'games/gearhold/levels.d.ts', '.hal.env', 'policy.yaml', 'markets.yaml', 'claude.md', 'package.json', 'package-lock.json']);
const PROTECTED_REGEX = [
  /^packages\/core\/test\/(?:.*\/)?hal-[^/]*\.test\.ts$/,
  /^packages\/core\/test\/(?:compliance|games-compliance|no-external-fonts|game-versions)[^/]*\.test\.ts$/,
  // packages/core/src/**/{gateway,policy,compliance}*: a file or a directory whose name starts so, at any depth.
  /^packages\/core\/src\/(?:.*\/)?(?:gateway|policy|compliance)[^/]*(?:\/|$)/,
];

export function isProtectedPath(raw: string): boolean {
  const p = norm(raw);
  return PROTECTED_PREFIXES.some((x) => p.startsWith(x) || p === x.slice(0, -1)) || PROTECTED_EXACT.has(p) || PROTECTED_REGEX.some((r) => r.test(p));
}

// ---- added lines ---------------------------------------------------------

/** Lines present in `after` more times than in `before` (a multiset difference), so a line that merely moved is not "added". */
export function addedLines(f: FileChange): string[] {
  if (f.binary || f.after === null || f.symlink) return [];
  const budget = new Map<string, number>();
  for (const l of (f.before ?? '').split('\n')) budget.set(l, (budget.get(l) ?? 0) + 1);
  const out: string[] = [];
  for (const l of f.after.split('\n')) {
    const n = budget.get(l) ?? 0;
    if (n > 0) budget.set(l, n - 1);
    else out.push(l);
  }
  return out;
}

const inGames = (f: FileChange) => norm(f.path).startsWith('games/');
// Prose files are never executed and legitimately carry URLs, prices in changelog text and the like.
const isProse = (f: FileChange) => /\.(md|txt)$/i.test(f.path);
const codeIn = (diff: Diff, scope: (f: FileChange) => boolean) => diff.files.filter((f) => scope(f) && !isProse(f) && f.status !== 'D');
const hit = (rule: string, path: string | undefined, detail: string): Violation => (path === undefined ? { rule, detail } : { rule, path, detail });

// ---- protected-path ------------------------------------------------------

export const protectedPath: Rule = (diff) =>
  diff.files.flatMap((f) => touched(f).filter(isProtectedPath).map((p) => hit('protected-path', p, `protected file touched (${f.status})`)));

// ---- hal-hook ------------------------------------------------------------

const HOOK_FILE = 'games/gearhold/index.html';
const HOOK_START = '// ---- hal hook';
const HOOK_END = '// ---- end hal hook ----';

/** The block from the start marker through the end marker, or null when either marker is missing. */
export function halHookBlock(src: string | null): string | null {
  if (src === null) return null;
  const s = src.indexOf(HOOK_START);
  if (s < 0) return null;
  const e = src.indexOf(HOOK_END, s);
  return e < 0 ? null : src.slice(s, e + HOOK_END.length);
}

export const halHook: Rule = (diff) => {
  const f = diff.files.find((x) => norm(x.path) === HOOK_FILE || (x.oldPath !== undefined && norm(x.oldPath) === HOOK_FILE));
  if (!f) return [];
  const before = halHookBlock(f.before);
  const after = f.status === 'D' || (f.oldPath !== undefined && norm(f.oldPath) === HOOK_FILE && norm(f.path) !== HOOK_FILE) ? null : halHookBlock(f.after);
  if (before === after) return [];
  return [hit('hal-hook', HOOK_FILE, after === null ? 'hal hook block missing or file moved/deleted' : before === null ? 'hal hook block added' : 'hal hook block changed')];
};

// ---- network and dependency ---------------------------------------------

// XML namespace identifiers, not requests.
const NAMESPACE_URLS = new Set(['http://www.w3.org/2000/svg', 'http://www.w3.org/1999/xlink', 'http://www.w3.org/1999/xhtml']);
const URL_RE = /(?:https?:)?\/\/([a-z0-9][a-z0-9.-]*)(?::\d+)?(?:\/[^\s'"`<>)]*)?/gi;
const NETWORK_CALLS: [RegExp, string][] = [
  [/\bfetch\s*\(/, 'fetch('],
  [/\bXMLHttpRequest\b/, 'XMLHttpRequest'],
  [/\bnew\s+WebSocket\b/, 'new WebSocket'],
  [/\bEventSource\b/, 'EventSource'],
  [/\bsendBeacon\b/, 'sendBeacon'],
  [/\bimportScripts\s*\(/, 'importScripts('],
  [/\bWebTransport\b/, 'WebTransport'],
  [/\bRTCPeerConnection\b/, 'RTCPeerConnection'],
];
const SAFE_IMPORT_RE = /\bimport\s*\(\s*(['"`])(?:\.{1,2}\/|\/(?!\/))/;

const isExternalRef = (v: string, allowData: boolean): boolean => {
  const s = v.trim();
  if (allowData && /^data:/i.test(s)) return false;
  return /^[a-z][a-z0-9+.-]*:/i.test(s) || s.startsWith('//') || s.startsWith('\\\\');
};
/** External `<script src>` / `<link href>` references in a block of added text (tags may span lines). */
function externalTags(text: string): { tag: string; url: string }[] {
  const out: { tag: string; url: string }[] = [];
  for (const m of text.matchAll(/<(script|link)\b[^>]*>/gi)) {
    const tag = m[1]!.toLowerCase();
    const attr = tag === 'script' ? 'src' : 'href';
    const a = new RegExp(`\\b${attr}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(m[0]);
    const url = a ? (a[1] ?? a[2] ?? a[3] ?? '') : '';
    if (a && isExternalRef(url, tag === 'link')) out.push({ tag, url });
  }
  return out;
}

const networkScope = (f: FileChange) => { const p = norm(f.path); return p.startsWith('games/') || p.startsWith('scripts/site/'); };

export const network: Rule = (diff) => {
  const out: Violation[] = [];
  for (const f of codeIn(diff, networkScope)) {
    const added = addedLines(f);
    if (added.length === 0) continue;
    const beforeLower = (f.before ?? '').toLowerCase();
    const seen = new Set<string>();
    for (const line of added) {
      for (const m of line.matchAll(URL_RE)) {
        const whole = m[0];
        const host = m[1]!.toLowerCase();
        const protoRel = whole.startsWith('//');
        // `//host` only counts when it looks like a host (has a dot or is localhost) and is not mid-word, so comments and paths do not trip.
        if (protoRel && !(host.includes('.') || host === 'localhost')) continue;
        if (protoRel && m.index! > 0 && /[\w:/.-]/.test(line[m.index! - 1]!)) continue;
        if (NAMESPACE_URLS.has(whole.toLowerCase().replace(/\/$/, ''))) continue;
        if (beforeLower.includes(host) || seen.has(host)) continue;
        seen.add(host);
        out.push(hit('network', f.path, `new host ${host}`));
      }
      for (const [re, name] of NETWORK_CALLS) if (re.test(line)) out.push(hit('network', f.path, `adds ${name}`));
      if (/\bimport\s*\(/.test(line) && !SAFE_IMPORT_RE.test(line)) out.push(hit('network', f.path, 'adds import( of a URL or computed specifier'));
    }
    for (const t of externalTags(added.join('\n'))) out.push(hit('network', f.path, `external <${t.tag}> ${t.url}`));
  }
  return out;
};

const DEP_FILES = new Set(['package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', '.npmrc']);
export const dependency: Rule = (diff) => {
  const out: Violation[] = [];
  for (const f of diff.files) {
    for (const p of touched(f)) if (DEP_FILES.has(norm(p).split('/').pop()!)) out.push(hit('dependency', p, 'dependency manifest changed'));
    if (inGames(f) && !isProse(f) && f.status !== 'D') {
      for (const t of externalTags(addedLines(f).join('\n')).filter((x) => x.tag === 'script')) out.push(hit('dependency', f.path, `non-relative <script src> ${t.url}`));
    }
  }
  return out;
};

// ---- payment, random reward, dark pattern --------------------------------

const PAYMENT_RE = /purchase\.|mockBuy|PaymentRequest|stripe|paypal|braintree|\bIAP\b|\bprice\b|[$€£]\s?\d/i;
export const payment: Rule = (diff) => {
  const out: Violation[] = [];
  for (const f of codeIn(diff, inGames)) for (const l of addedLines(f)) if (PAYMENT_RE.test(l)) out.push(hit('payment', f.path, `payment-shaped line: ${l.trim().slice(0, 120)}`));
  return out;
};

const RANDOM_RE = /Math\.random|\brng\s*\(|\brandom\w*\s*\(|\bmulberry32\s*\(|getRandomValues/;
const REWARD_RE = /reward|loot|chest|crate|prize|gacha|pull|drop rate/i;
const ODDS_RE = /\bodds\b/i;
export const randomReward: Rule = (diff) => {
  const files = codeIn(diff, inGames);
  const added = files.map((f) => ({ f, lines: addedLines(f) }));
  const all = added.flatMap((a) => a.lines);
  if (all.some((l) => ODDS_RE.test(l)) || !all.some((l) => REWARD_RE.test(l))) return [];
  return added.filter((a) => a.lines.some((l) => RANDOM_RE.test(l))).map((a) => hit('random-reward', a.f.path, 'adds randomness and reward wording without odds'));
};

const DARK_RE = /only \d+ left|limited time|hurry|expires in|last chance|don't miss|are you sure you want to (leave|quit)/i;
const TIMER_RE = /\b(setInterval|setTimeout)\b/;
const OFFER_RE = /\b(offers?|sales?|deals?|discounts?|promo\w*)\b/i;
// Split camelCase and snake_case first so `showOffer` and `daily_deal` read as words, while `dealt` and `ideal` do not match.
const offerWord = (l: string) => OFFER_RE.test(l.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_$]/g, ' '));
const NEAR = 3;
export const darkPattern: Rule = (diff) => {
  const out: Violation[] = [];
  for (const f of codeIn(diff, inGames)) {
    for (const l of addedLines(f)) if (DARK_RE.test(l)) out.push(hit('dark-pattern', f.path, `pressure copy: ${l.trim().slice(0, 120)}`));
    // A timer within NEAR lines of an offer word, judged on the file as it will be.
    const lines = (f.after ?? '').split('\n');
    const addedSet = new Map<string, number>();
    for (const l of addedLines(f)) addedSet.set(l, (addedSet.get(l) ?? 0) + 1);
    lines.forEach((l, i) => {
      const n = addedSet.get(l) ?? 0;
      if (n === 0 || !TIMER_RE.test(l)) return;
      addedSet.set(l, n - 1);
      for (let j = Math.max(0, i - NEAR); j <= Math.min(lines.length - 1, i + NEAR); j++) {
        if (offerWord(lines[j]!)) { out.push(hit('dark-pattern', f.path, 'timer near offer/sale/deal wording')); break; }
      }
    });
  }
  return out;
};

// ---- asset-source --------------------------------------------------------

const ASSET_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'mp3', 'ogg', 'wav', 'woff2', 'woff', 'ttf', 'otf', 'svg']);
const FONT_EXT = new Set(['woff2', 'woff', 'ttf', 'otf']);
const LICENSE_RE = /\b(hal-generated|CC0|public domain|OFL[- ]1\.1)\b/i;
const OFL_RE = /\bOFL[- ]1\.1\b/i;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const baseOf = (p: string) => p.slice(p.lastIndexOf('/') + 1);
const extOf = (p: string) => (baseOf(p).includes('.') ? baseOf(p).split('.').pop()!.toLowerCase() : '');

export const assetSource: Rule = (diff) => {
  const out: Violation[] = [];
  const byPath = new Map(diff.files.filter((f) => f.status !== 'D').map((f) => [norm(f.path), f]));
  const tree = new Set([...(diff.repoFiles ?? []), ...byPath.keys()].map(norm));
  for (const f of diff.files) {
    if (f.status !== 'A' && f.status !== 'R') continue;
    const ext = extOf(f.path);
    if (!f.binary && !ASSET_EXT.has(ext)) continue;
    const dir = dirOf(f.path);
    const src = byPath.get(norm(`${dir ? dir + '/' : ''}SOURCES.md`));
    if (!src || src.after === null) { out.push(hit('asset-source', f.path, 'no SOURCES.md in its directory in this diff')); continue; }
    const name = new RegExp(`(?<![\\w.-])${esc(baseOf(f.path))}(?![\\w-]|\\.\\w)`, 'i');
    const lines = src.after.split('\n').filter((l) => name.test(l));
    if (lines.length === 0) { out.push(hit('asset-source', f.path, 'not named in SOURCES.md')); continue; }
    const licensed = lines.filter((l) => LICENSE_RE.test(l));
    if (licensed.length === 0) { out.push(hit('asset-source', f.path, 'SOURCES.md entry has no allowed license (hal-generated, CC0, public domain, OFL-1.1)')); continue; }
    const nonOfl = licensed.some((l) => /\b(hal-generated|CC0|public domain)\b/i.test(l));
    if (FONT_EXT.has(ext) && !nonOfl) {
      const d = norm(dir ? dir + '/' : '');
      const has = [...tree].some((p) => p.startsWith(d) && /^ofl[^/]*\.txt$/.test(p.slice(d.length)));
      if (!has) out.push(hit('asset-source', f.path, 'OFL font needs an OFL*.txt license file beside it'));
    }
  }
  return out;
};

// ---- levels, tests, scope -----------------------------------------------

export const levelRemoved: Rule = (diff) =>
  Object.entries(diff.levelCounts.before).flatMap(([game, n]) => {
    const after = diff.levelCounts.after[game] ?? 0;
    return after < n ? [hit('level-removed', undefined, `${game}: ${n} levels before, ${after} after`)] : [];
  });

const isTestFile = (p: string) => /\.test\.[cm]?[jt]sx?$/i.test(p);
export const testsRemoved: Rule = (diff) => {
  const out: Violation[] = [];
  if (diff.testCountAfter < diff.testCountBefore) out.push(hit('tests-removed', undefined, `${diff.testCountBefore} tests before, ${diff.testCountAfter} after`));
  for (const f of diff.files) {
    if (f.status === 'D' && isTestFile(f.path)) out.push(hit('tests-removed', f.path, 'test file deleted'));
    if (f.status === 'R' && f.oldPath && isTestFile(f.oldPath) && !isTestFile(f.path)) out.push(hit('tests-removed', f.oldPath, 'test file renamed to a non-test file'));
  }
  return out;
};

export const outsideScope: Rule = (diff) => {
  const out: Violation[] = [];
  for (const f of diff.files) {
    for (const p of touched(f)) {
      const bad = p === '' || p.startsWith('/') || p.startsWith('\\') || /^[a-z]:/i.test(p) || p.replace(/\\/g, '/').split('/').includes('..') || p.includes('\0') || p.replace(/\\/g, '/').split('/').includes('.git');
      if (bad) out.push(hit('outside-scope', p, 'path outside the repo'));
    }
    if (f.symlink) out.push(hit('outside-scope', f.path, 'symlink'));
  }
  return out;
};

export const TRIPWIRE_RULES: Record<string, Rule> = {
  'protected-path': protectedPath,
  'hal-hook': halHook,
  network,
  dependency,
  payment,
  'random-reward': randomReward,
  'dark-pattern': darkPattern,
  'asset-source': assetSource,
  'level-removed': levelRemoved,
  'tests-removed': testsRemoved,
  'outside-scope': outsideScope,
};

export function checkTripwires(diff: Diff): Violation[] {
  return Object.values(TRIPWIRE_RULES).flatMap((r) => r(diff));
}
