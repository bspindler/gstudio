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
  /** A text-type file whose bytes contain a NUL or start with a UTF-16 BOM: a way to dodge text scanning. Set by collectDiff. */
  suspectEncoding?: boolean;
};

export type Diff = {
  files: FileChange[];
  testCountBefore: number;
  testCountAfter: number;
  levelCounts: { before: Record<string, number>; after: Record<string, number> };
  /** Every tracked path in the candidate tree, so rules can see files the diff did not touch (e.g. an existing OFL license). */
  repoFiles?: string[];
  /** Real secret values (e.g. the API key from the environment) the caller wants kept out of every added line. */
  secrets?: string[];
  /** Tests collected per test file (repo-relative path), at the base and after the change. When given, a base test file with fewer tests after (or not collected at all) is flagged. */
  testCountsByFile?: { before: Record<string, number>; after: Record<string, number> };
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

// Config that decides which tests run, and how they are typed or diffed: changing it could switch protected checks off.
const PROTECTED_BASENAME = /^(?:\.gitattributes|vitest\.workspace\.[^/]*|vitest\.config\.[^/]*|tsconfig[^/]*\.json)$/;

export function isProtectedPath(raw: string): boolean {
  const p = norm(raw);
  if (PROTECTED_BASENAME.test(p.slice(p.lastIndexOf('/') + 1))) return true;
  return PROTECTED_PREFIXES.some((x) => p.startsWith(x) || p === x.slice(0, -1)) || PROTECTED_EXACT.has(p) || PROTECTED_REGEX.some((r) => r.test(p));
}

// ---- added lines ---------------------------------------------------------

/** Lines present in `after` more times than in `before` (a multiset difference), so a line that merely moved is not "added". */
export function addedLineIndexes(f: FileChange): number[] {
  if (f.binary || f.after === null || f.symlink) return [];
  const budget = new Map<string, number>();
  for (const l of (f.before ?? '').split('\n')) budget.set(l, (budget.get(l) ?? 0) + 1);
  const out: number[] = [];
  f.after.split('\n').forEach((l, i) => {
    const n = budget.get(l) ?? 0;
    if (n > 0) budget.set(l, n - 1);
    else out.push(i);
  });
  return out;
}
export function addedLines(f: FileChange): string[] {
  const lines = (f.after ?? '').split('\n');
  return addedLineIndexes(f).map((i) => lines[i]!);
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

const countOf = (src: string, needle: string) => src.split(needle).length - 1;
const hookIntact = (src: string | null): src is string => src !== null && countOf(src, HOOK_START) === 1 && countOf(src, HOOK_END) === 1 && halHookBlock(src) !== null;
const withoutHook = (src: string | null): string | null => {
  const b = halHookBlock(src);
  return src === null || b === null ? src : src.replace(b, '');
};

// The hook's counters and flag. A new line (or a removed one) that writes the `hal` counters or touches the HAL flag could skew scores.
const HAL_TAMPER = [
  /__hal/,
  /\bHAL\b/,
  /\b(?:const|let|var)\s+hal\b/,
  /\bhal\s*=(?!=)/,
  /\bhal\.\w+\s*(?:[-+*/%|&^]|\*\*)?=(?!=)/,
  /(?:\+\+|--)\s*hal\.\w/,
  /\bhal\.\w+\s*(?:\+\+|--)/,
];

/** The statements in `src` that touch the hook, counters or flag, whitespace-normalised. */
function halFragments(src: string | null): string[] {
  if (src === null) return [];
  return stripComments(src).split(/[;{}]/).map((x) => x.replace(/\s+/g, ' ').trim()).filter((x) => x && HAL_TAMPER.some((r) => r.test(x)));
}

export const halHook: Rule = (diff) => {
  const out: Violation[] = [];
  const f = diff.files.find((x) => norm(x.path) === HOOK_FILE || (x.oldPath !== undefined && norm(x.oldPath) === HOOK_FILE));
  if (f) {
    const moved = f.status === 'D' || (f.oldPath !== undefined && norm(f.oldPath) === HOOK_FILE && norm(f.path) !== HOOK_FILE);
    const before = halHookBlock(f.before);
    const after = moved ? null : halHookBlock(f.after);
    // Fail closed: the file is there, so both sides must be readable text with exactly one intact block each, byte for byte equal.
    if (moved) out.push(hit('hal-hook', HOOK_FILE, 'hal hook file deleted or moved'));
    else if (!hookIntact(f.before) || !hookIntact(f.after)) out.push(hit('hal-hook', HOOK_FILE, 'hal hook block missing, unreadable, or not exactly one start and one end marker'));
    else if (before !== after) out.push(hit('hal-hook', HOOK_FILE, 'hal hook block changed'));
  }
  // Outside the block, no statement touching the hook, its counters or the HAL flag may be added or removed. Statements are compared as a
  // multiset (split on ; { }, comments dropped, whitespace normalised), so re-indenting, wrapping in a block or editing the rest of a line is fine.
  for (const g of diff.files) {
    if (!norm(g.path).startsWith('games/gearhold/') || isProse(g) || g.symlink) continue;
    const isHookFile = norm(g.path) === HOOK_FILE;
    const b = halFragments(isHookFile ? withoutHook(g.before) : g.before);
    const a = halFragments(isHookFile ? withoutHook(g.after) : g.after);
    for (const [label, from, minus] of [['added', a, b], ['removed', b, a]] as const) {
      const budget = new Map<string, number>();
      for (const x of minus) budget.set(x, (budget.get(x) ?? 0) + 1);
      for (const x of from) {
        const n = budget.get(x) ?? 0;
        if (n > 0) budget.set(x, n - 1);
        else out.push(hit('hal-hook', g.path, `${label} statement touches the hal hook, counters or HAL flag: ${x.slice(0, 100)}`));
      }
    }
  }
  return out;
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

/** Hosts named in a line of text: `http(s)://host`, or `//host` when it looks like a host and is not mid-word. XML namespace URLs are skipped. */
function hostsIn(line: string): string[] {
  const out: string[] = [];
  for (const m of line.matchAll(URL_RE)) {
    const whole = m[0];
    const host = m[1]!.toLowerCase();
    const protoRel = whole.startsWith('//');
    if (protoRel && !(host.includes('.') || host === 'localhost')) continue;
    if (protoRel && m.index! > 0 && /[\w:/.-]/.test(line[m.index! - 1]!)) continue;
    if (NAMESPACE_URLS.has(whole.toLowerCase().replace(/\/$/, ''))) continue;
    out.push(host);
  }
  return out;
}

export const network: Rule = (diff) => {
  const out: Violation[] = [];
  for (const f of codeIn(diff, networkScope)) {
    const added = addedLines(f);
    if (added.length === 0) continue;
    const existing = new Set((f.before ?? '').split('\n').flatMap(hostsIn));
    const seen = new Set<string>();
    for (const line of added) {
      for (const host of hostsIn(line)) {
        if (existing.has(host) || seen.has(host)) continue;
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

const LIB_HEADER_RE = /@license|\/\*!|\bCopyright\b|\(c\)\s*\d{4}/i;
const DEP_FILES = new Set(['package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', '.npmrc']);
export const dependency: Rule = (diff) => {
  const out: Violation[] = [];
  for (const f of diff.files) {
    for (const p of touched(f)) if (DEP_FILES.has(norm(p).split('/').pop()!)) out.push(hit('dependency', p, 'dependency manifest changed'));
    if (inGames(f) && !isProse(f) && f.status !== 'D') {
      const added = addedLines(f);
      for (const t of externalTags(added.join('\n')).filter((x) => x.tag === 'script')) out.push(hit('dependency', f.path, `non-relative <script src> ${t.url}`));
      // A pasted-in library carries its license header.
      for (const l of added) if (LIB_HEADER_RE.test(l)) out.push(hit('dependency', f.path, `copied library header: ${l.trim().slice(0, 80)}`));
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

// Removes line comments, block comments and HTML comments, leaving string literals alone. Strings end at a newline (except template literals).
export function stripComments(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    const n = text[i + 1];
    if (c === '/' && n === '/' && text[i - 1] !== ':') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') { const e = text.indexOf('*/', i + 2); i = e < 0 ? text.length : e + 2; continue; }
    if (text.startsWith('<!--', i)) { const e = text.indexOf('-->', i + 4); i = e < 0 ? text.length : e + 3; continue; }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < text.length && text[j] !== c && (c === '`' || text[j] !== '\n')) j += text[j] === '\\' ? 2 : 1;
      if (j < text.length && text[j] === c) { out += text.slice(i, j + 1); i = j + 1; continue; }
      out += c; i++; continue; // an apostrophe in prose, not a string
    }
    out += c; i++;
  }
  return out;
}

const RANDOM_RE = /Math\.random|\brng\s*\(|\brand\w*\s*\(|\bseeded\s*\(|\bmulberry32\s*\(|getRandomValues/;
// Reward wording. `pull` alone is ordinary copy ("the tide pulls", "trigger pulls"), so only gacha-style pulls count.
const REWARD_RE = /reward|loot|chest|crate|prize|gacha|\bpulls?\s+(?:a|an|for|the|your)\s+(?:prize|reward|card|chest|crate|pal|shell)|drop rate/i;
// Evidence of shown odds: the SDK (studio.odds.roll / studio.odds.format), Tidepool's oddsLine(), or the word inside a string or visible text. A comment does not count.
const ODDS_WORD_RE = /\bodds\b/i;
const ODDS_CALL_RE = /\bodds\.(?:roll|format)\s*\(|\boddsLine\s*\(/;
/** Whole string literals in (comment-free) code, except object keys and `["index"]` uses. A quote with no partner on its line (an apostrophe in prose) is skipped. `${...}` parts are dropped so `${odds}` is not the word. */
export function stringLiterals(code: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < code.length) {
    const c = code[i]!;
    if (c !== '"' && c !== "'" && c !== '`') { i++; continue; }
    let j = i + 1;
    while (j < code.length && code[j] !== c && (c === '`' || code[j] !== '\n')) j += code[j] === '\\' ? 2 : 1;
    if (j < code.length && code[j] === c) {
      const before = code.slice(0, i).trimEnd().slice(-1);
      const after = code.slice(j + 1).trimStart()[0];
      const isKey = after === ':' && (before === '{' || before === ',' || before === '');
      const isIndex = before === '[' && after === ']';
      if (!isKey && !isIndex) out.push(code.slice(i + 1, j).replace(/\$\{[^}]*\}/g, ' '));
      i = j + 1;
    } else i++;
  }
  return out;
}
const blank = (t: string) => t.replace(/[^\n]/g, ' ');
/** Splits an HTML file into its markup (script and style bodies blanked) and its script bodies (everything else blanked); newlines stay, so line numbers line up. */
function splitHtml(src: string): { markup: string; js: string } {
  let markup = '';
  let js = '';
  let pos = 0;
  const open = /<(script|style)\b[^>]*>/gi;
  for (let m = open.exec(src); m; m = open.exec(src)) {
    const bodyStart = m.index + m[0].length;
    const close = src.toLowerCase().indexOf(`</${m[1]!.toLowerCase()}`, bodyStart);
    const bodyEnd = close < 0 ? src.length : close;
    const head = src.slice(pos, bodyStart);
    markup += head; js += blank(head);
    const body = src.slice(bodyStart, bodyEnd);
    markup += blank(body); js += m[1]!.toLowerCase() === 'script' ? body : blank(body);
    pos = bodyEnd;
    open.lastIndex = bodyEnd;
  }
  const tail = src.slice(pos);
  return { markup: markup + tail, js: js + blank(tail) };
}
// Evidence of shown odds: the SDK (studio.odds.roll / studio.odds.format), Tidepool's oddsLine(), or the word inside a whole string literal
// of added script code, or in added visible HTML text (outside script/style, found from the whole file, so code added inside an existing
// script block counts as code). A comment, an attribute value, an object key or a variable named `odds` does not count.
export function oddsEvidence(f: FileChange): boolean {
  const lines = (f.after ?? '').split('\n');
  const idx = new Set(addedLineIndexes(f));
  const addedOf = (text: string) => text.split('\n').filter((_, i) => idx.has(i));
  const isHtml = /\.html?$/i.test(f.path);
  const jsText = isHtml ? splitHtml(lines.join('\n')).js : lines.join('\n');
  const jsCode = stripComments(addedOf(jsText).join('\n'));
  if (ODDS_CALL_RE.test(jsCode) || stringLiterals(jsCode).some((t) => ODDS_WORD_RE.test(t))) return true;
  if (!isHtml) return false;
  const raw = splitHtml(lines.join('\n')).markup.replace(/<!--[\s\S]*?(?:-->|$)/g, (c) => c.replace(/[^\n]/g, ' '));
  for (const m of raw.matchAll(/>([^<>]+)</g)) {
    const startLine = raw.slice(0, m.index! + 1).split('\n').length - 1;
    if (m[1]!.split('\n').some((t, k) => idx.has(startLine + k) && ODDS_WORD_RE.test(t))) return true;
  }
  return false;
}

export const randomReward: Rule = (diff) => {
  const added = codeIn(diff, inGames).map((f) => ({ f, code: stripComments(addedLines(f).join('\n')) }));
  if (!added.some((a) => REWARD_RE.test(a.code))) return [];
  return added.filter((a) => RANDOM_RE.test(a.code) && !oddsEvidence(a.f)).map((a) => hit('random-reward', a.f.path, 'adds randomness and reward wording without odds shown in this file'));
};

const DARK_RE = /only \d+ left|limited time|hurry|expires in|last chance|don't miss|are you sure you want to (leave|quit)/i;
const TIMER_RE = /\b(setInterval|setTimeout)\b/;
// A user-facing sales word. Not preceded or followed by identifier/selector characters, so `offerShell(`, `.offer`, `dealDamage(` never match.
const OFFER_WORD_RE = /(?<![\w.#-])(offers?|sales?|deals?|discounts?|promo\w*)(?![\w(-])/i;
// Only "deal(s) damage" and "deal(s) N [word] damage"; "Deal 50% off" stays a deal.
const DEAL_DAMAGE_RE = /\bdeals?\s+(?:\d+(?:\.\d+)?\s+)?(?:\w+\s+)?damage\b/gi;
const NEAR = 3;
/** The visible text of a source line: string literals and HTML text nodes (class/id attributes removed, comments removed). */
function visibleText(line: string): string {
  const l = stripComments(line).replace(/\b(?:class|id|for|data-[\w-]+)\s*=\s*(?:"[^"]*"|'[^']*')/gi, ' ');
  const parts: string[] = [];
  for (const m of l.matchAll(/(["'`])((?:(?!\1)[^\n\\]|\\.)*)\1/g)) parts.push(m[2]!);
  for (const m of l.matchAll(/>([^<>]+)</g)) parts.push(m[1]!);
  return parts.join(' ').replace(DEAL_DAMAGE_RE, ' ');
}
export const darkPattern: Rule = (diff) => {
  const out: Violation[] = [];
  for (const f of codeIn(diff, inGames)) {
    for (const l of addedLines(f)) if (DARK_RE.test(l)) out.push(hit('dark-pattern', f.path, `pressure copy: ${l.trim().slice(0, 120)}`));
    // A timer within NEAR lines of sale/deal/offer wording shown to the player, judged on the file as it will be.
    const lines = (f.after ?? '').split('\n');
    const addedSet = new Map<string, number>();
    for (const l of addedLines(f)) addedSet.set(l, (addedSet.get(l) ?? 0) + 1);
    lines.forEach((l, i) => {
      const n = addedSet.get(l) ?? 0;
      if (n === 0 || !TIMER_RE.test(stripComments(l))) return;
      addedSet.set(l, n - 1);
      for (let j = Math.max(0, i - NEAR); j <= Math.min(lines.length - 1, i + NEAR); j++) {
        if (OFFER_WORD_RE.test(visibleText(lines[j]!))) { out.push(hit('dark-pattern', f.path, 'timer near offer/sale/deal wording')); break; }
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

const DATA_URI_RE = /data:(?:font|image|application\/(?:font|x-font|octet-stream))[\w.+\/-]*[;,][^\s"')]{0,40}?[A-Za-z0-9+\/=%]{200,}/i;
export const assetSource: Rule = (diff) => {
  const out: Violation[] = [];
  const byPath = new Map(diff.files.filter((f) => f.status !== 'D').map((f) => [norm(f.path), f]));
  const tree = new Set([...(diff.repoFiles ?? []), ...byPath.keys()].map(norm));
  for (const f of diff.files) {
    if (f.status === 'D') continue;
    const ext = extOf(f.path);
    // A binary under games/ that is not a known asset type cannot be inspected, so it is refused outright.
    if (f.binary && inGames(f) && !ASSET_EXT.has(ext)) { out.push(hit('asset-source', f.path, 'binary file of an unknown type under games/')); continue; }
    // Added, renamed or overwritten assets must be listed (an overwrite needs its SOURCES.md entry touched in the same diff).
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
  // Fonts and images smuggled in as data: URIs skip the file checks above.
  for (const f of codeIn(diff, inGames)) for (const l of addedLines(f)) if (DATA_URI_RE.test(l)) out.push(hit('asset-source', f.path, 'embedded data: URI for a font or image'));
  return out;
};

// ---- levels, tests, scope -----------------------------------------------

const authoredLines = (src: string | null) => (src ?? '').split('\n').filter((l) => /\bAUTHORED\b\s*=/.test(l)).map((l) => l.trim());
export const levelRemoved: Rule = (diff) => {
  const out = Object.entries(diff.levelCounts.before).flatMap(([game, n]) => {
    const after = diff.levelCounts.after[game] ?? 0;
    return after < n ? [hit('level-removed', undefined, `${game}: ${n} levels before, ${after} after`)] : [];
  });
  // Tidepool's playable list is RAW mapped into AUTHORED; a filter or slice there drops levels without touching RAW.
  const tp = diff.files.find((f) => norm(f.path) === 'games/tidepool-pals/levels.js' && f.status !== 'D');
  if (tp && authoredLines(tp.before).join('\n') !== authoredLines(tp.after).join('\n')) out.push(hit('level-removed', tp.path, 'the line defining AUTHORED changed'));
  return out;
};

const isTestFile = (p: string) => /\.test\.[cm]?[jt]sx?$/i.test(p);
export const testsRemoved: Rule = (diff) => {
  const out: Violation[] = [];
  if (diff.testCountAfter < diff.testCountBefore) out.push(hit('tests-removed', undefined, `${diff.testCountBefore} tests before, ${diff.testCountAfter} after`));
  const by = diff.testCountsByFile;
  if (by) {
    const renamedTo = new Map(diff.files.filter((f) => f.oldPath).map((f) => [f.oldPath!, f.path]));
    const deleted = new Set(diff.files.filter((f) => f.status === 'D').map((f) => f.path));
    for (const [file, n] of Object.entries(by.before)) {
      if (n === 0 || deleted.has(file)) continue; // deletions are reported below
      const now = by.after[renamedTo.get(file) ?? file];
      if (now === undefined) out.push(hit('tests-removed', file, `test file no longer collected (had ${n} tests)`));
      else if (now < n) out.push(hit('tests-removed', file, `${n} tests before, ${now} after`));
    }
  }
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
    if (f.status !== 'D' && !f.binary && (f.suspectEncoding || f.after?.includes('\0'))) out.push(hit('outside-scope', f.path, 'text file with a NUL byte or UTF-16 BOM (hides content from scanning)'));
  }
  return out;
};

const SECRET_RE = /sk-ant-[A-Za-z0-9_-]{8,}/;
/** Added lines (any file, prose included) carrying an API-key shape, or a literal secret value the caller supplied. Never echoes the secret. */
export const secret: Rule = (diff) => {
  const values = (diff.secrets ?? []).filter((v) => v.length >= 6);
  const out: Violation[] = [];
  for (const f of diff.files) {
    if (f.status === 'D') continue;
    const text = f.symlink ? [f.after ?? ''] : addedLines(f);
    if (text.some((l) => SECRET_RE.test(l) || values.some((v) => l.includes(v)))) out.push(hit('secret', f.path, 'secret value added'));
  }
  return out;
};

// ---- host-api (ruling R15) ----------------------------------------------

/**
 * `text` with comments (line, block and HTML comments) and string contents blanked to spaces, keeping every newline and offset, so a
 * masked line lines up with its raw line. Quote characters stay; `${...}` inside a template literal stays code.
 */
export function maskCode(text: string): string {
  const out = text.split('');
  const blank = (a: number, b: number) => { for (let k = a; k < b; k++) if (out[k] !== '\n') out[k] = ' '; };
  const tmpl: number[] = []; // brace depth of each open `${`
  let i = 0;
  const inTemplate = (): boolean => {
    // Scans template text from i (just after a backtick or a closing `}`) to the closing backtick or the next `${`.
    const start = i;
    while (i < text.length) {
      if (text[i] === '\\') { i += 2; continue; }
      if (text[i] === '`') { blank(start, i); i++; return false; }
      if (text[i] === '$' && text[i + 1] === '{') { blank(start, i); i += 2; tmpl.push(0); return true; }
      i++;
    }
    blank(start, i);
    return false;
  };
  while (i < text.length) {
    const c = text[i]!, n = text[i + 1];
    if (c === '/' && n === '/') { const e = text.indexOf('\n', i); const end = e < 0 ? text.length : e; blank(i, end); i = end; continue; }
    if (c === '/' && n === '*') { const e = text.indexOf('*/', i + 2); const end = e < 0 ? text.length : e + 2; blank(i, end); i = end; continue; }
    if (text.startsWith('<!--', i)) { const e = text.indexOf('-->', i + 4); const end = e < 0 ? text.length : e + 3; blank(i, end); i = end; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < text.length && text[j] !== c && text[j] !== '\n') j += text[j] === '\\' ? 2 : 1;
      blank(i + 1, Math.min(j, text.length));
      i = j < text.length && text[j] === c ? j + 1 : j;
      continue;
    }
    if (c === '`') { i++; inTemplate(); continue; }
    if (tmpl.length) {
      if (c === '{') tmpl[tmpl.length - 1]!++;
      else if (c === '}') {
        if (tmpl[tmpl.length - 1] === 0) { tmpl.pop(); i++; inTemplate(); continue; }
        tmpl[tmpl.length - 1]!--;
      }
    }
    i++;
  }
  return out.join('');
}

const HOST_CALLS: Array<[RegExp, string]> = [
  [/\bprocess\.[A-Za-z_$]/, 'process.'],
  [/\brequire\s*\(/, 'require('],
  [/\bglobalThis\s*\.\s*process\b/, 'globalThis.process'],
  [/\b(?:Deno|Bun)\.[A-Za-z_$]/, 'Deno./Bun.'],
  [/\bfs\.[A-Za-z_$]/, 'fs.'],
  [/\bwriteSync\b/, 'writeSync'],
  [/\bstdout\b/, 'stdout'],
];
const NODE_MODULES = new Set(['fs', 'child_process', 'os', 'path', 'net', 'http', 'https', 'http2', 'worker_threads', 'dgram', 'dns', 'tls', 'cluster', 'vm', 'module', 'process', 'readline', 'v8', 'inspector']);
// R17: game code may not reach Hal's own code (the check runner, its result channel, the scorers' source).
const HAL_MODULE = /(?:^|\/)scripts\/|check-nonce|check-entry|(?:^|\/)packages\/core\/src\/hal(?:\/|$)/;
const IMPORT_SPEC = [/\b(?:import|export)\b[^;]*?\bfrom\s*(['"])/g, /\bimport\s*\(\s*(['"`])/g, /\bimport\s*(['"])/g];

/** The Node host APIs one line of game code reaches for (`masked` is the line through maskCode). */
function hostUses(raw: string, masked: string): string[] {
  const found = HOST_CALLS.filter(([re]) => re.test(masked)).map(([, name]) => name);
  if (/\bglobalThis\s*\[/.test(masked) && /\bglobalThis\s*\[\s*(['"`])process\1\s*\]/.test(raw)) found.push('globalThis["process"]');
  for (const re of IMPORT_SPEC) {
    for (const m of masked.matchAll(re)) {
      const q = m.index! + m[0].length - 1;
      const close = raw.indexOf(raw[q]!, q + 1);
      const spec = raw.slice(q + 1, close < 0 ? undefined : close);
      if (spec.startsWith('node:') || NODE_MODULES.has(spec.split('/')[0]!)) found.push(`import of ${spec}`);
      else if (HAL_MODULE.test(spec)) found.push(`import of Hal module ${spec}`);
    }
  }
  return [...new Set(found)];
}

/**
 * Added lines of game code (games/**, not prose) that use Node host APIs, or import Hal's own modules (scripts/,
 * check-nonce, check-entry, packages/core/src/hal). Game code runs in the browser; a scorer imports it in Node.
 */
export const hostApi: Rule = (diff) => {
  const out: Violation[] = [];
  for (const f of codeIn(diff, inGames)) {
    if (f.binary || f.after === null) continue;
    const raw = f.after.split('\n');
    const masked = maskCode(f.after).split('\n');
    for (const i of addedLineIndexes(f)) {
      for (const u of hostUses(raw[i]!, masked[i] ?? '')) out.push(hit('host-api', f.path, `uses ${u}: ${raw[i]!.trim().slice(0, 100)}`));
    }
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
  secret,
  'host-api': hostApi,
};

export function checkTripwires(diff: Diff, secrets?: string[]): Violation[] {
  const d = secrets ? { ...diff, secrets: [...(diff.secrets ?? []), ...secrets] } : diff;
  return Object.values(TRIPWIRE_RULES).flatMap((r) => r(d));
}
