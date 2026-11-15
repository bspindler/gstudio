// Measurement v2, P0.4: a tap zone Block Barn routes but doesn't list for the hook is invisible to the scorer (the
// doors and the sky shipped that way). Permission split A (2026-11-15): the zone list is game code, `tapZones()` next to
// `tapAt`, and the frozen ?hal hook only returns it, so a new tappable thing (a weathervane, say) needs no hook edit.
// Statically, against tapAt's own branches: every box tapAt hit-tests, and every kind it routes, is in tapZones(), and
// tapAt has no other way to hit-test a point. The scorer measures every zone listed (bigTargets), so none can hide.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const HTML = readFileSync(new URL('../../games/block-barn/index.html', import.meta.url), 'utf8');

/** The source of `function name(...) { ... }` up to its closing brace at column 0, or null. */
function fnBody(src: string, name: string): string | null {
  const i = src.search(new RegExp(`\\nfunction ${name}\\(`));
  if (i < 0) return null;
  const rest = src.slice(i + 1);
  const j = rest.search(/\n}\n/);
  return j < 0 ? null : rest.slice(0, j + 2);
}
const hookBlock = (src: string): string => {
  const s = src.indexOf('// ---- hal hook'), e = src.indexOf('// ---- end hal hook ----');
  return s < 0 || e < 0 ? '' : src.slice(s, e);
};

/** Why tapZones() might not list every zone tapAt routes; empty when it does. */
function zoneProblems(src: string): string[] {
  const out: string[] = [];
  const tapAt = fnBody(src, 'tapAt'), zones = fnBody(src, 'tapZones'), hits = fnBody(src, 'hitBoxes') ?? '';
  if (!tapAt) return ['no function tapAt'];
  if (!zones) return ['no function tapZones'];
  // 1. Every box tapAt hit-tests is listed (called) in tapZones.
  const boxes = new Set([...tapAt.matchAll(/\b(\w+Box)\(\)/g)].map((m) => m[1]!));
  for (const fn of boxes) if (!new RegExp(`\\b${fn}\\(\\)`).test(zones)) out.push(`${fn}() is routed by tapAt but not listed in tapZones()`);
  if (/\bhitBoxes\(\)/.test(tapAt) && !/\.\.\.hitBoxes\(\)\.map\(/.test(zones)) out.push('tapAt routes hitBoxes() but tapZones() does not list every one of them');
  // 2. Nothing is dropped from the list.
  for (const m of zones.matchAll(/\.(filter|slice|splice|flatMap|find)\(/g)) out.push(`tapZones() drops zones (.${m[1]})`);
  // 3. Every kind tapAt routes by name is produced by hitBoxes() or tapZones().
  for (const m of tapAt.matchAll(/\.kind\s*===?\s*'([^']+)'/g)) {
    if (!new RegExp(`kind:\\s*'${m[1]}'`).test(hits + zones)) out.push(`tapAt routes kind '${m[1]}' that no zone produces`);
  }
  // 4. tapAt hit-tests only through listed boxes: no rect of its own, and every box it reads came from one.
  for (const m of tapAt.matchAll(/\b(getBoundingClientRect|elementFromPoint|elementsFromPoint|getClientRects)\b/g)) out.push(`tapAt measures the page itself (${m[1]}), not through a listed box`);
  const allowed = new Set<string>();
  for (const m of tapAt.matchAll(/\b(\w+)\s*=\s*(\w+Box)\(\)/g)) allowed.add(m[1]!);
  for (const m of tapAt.matchAll(/for\s*\(\s*(?:const|let|var)\s+(\w+)\s+of\s+hitBoxes\(\)\s*\)/g)) allowed.add(m[1]!);
  for (let grew = true; grew;) {
    grew = false;
    for (const m of tapAt.matchAll(/\b(\w+)\s*=\s*(\w+)\s*[;,)]/g)) if (allowed.has(m[2]!) && !allowed.has(m[1]!)) { allowed.add(m[1]!); grew = true; }
  }
  for (const id of new Set([...tapAt.matchAll(/\b(\w+)\.(?:x|y|w|h)\b/g)].map((m) => m[1]!))) {
    if (!allowed.has(id)) out.push(`tapAt reads a box (${id}) that does not come from a listed xxxBox() or hitBoxes()`);
  }
  // 5. The hook only returns the list; the list never touches the hook's state.
  if (!/\btargets:\s*(?:\(\)\s*=>\s*tapZones\(\)|tapZones)\s*,/.test(hookBlock(src))) out.push('__hal.targets() is not exactly tapZones()');
  if (/__hal|\bHAL\b|\bmanualClock\b|\bwebdriver\b/.test(zones)) out.push('tapZones() touches the hal hook');
  return out;
}

// A tappable weathervane, as a game change would add it: its own box, routed by tapAt, listed in tapZones.
const VANE_BOX = 'function vaneBox() { return { x: 10, y: 10, w: 90, h: 90 }; }\n';
const VANE_ROUTE = '  const vb = vaneBox();\n  if (x >= vb.x && x <= vb.x + vb.w && y >= vb.y && y <= vb.y + vb.h) { spinVane(); return; }\n';
const withVane = (src: string, { listed = true, route = VANE_ROUTE } = {}): string => {
  let s = src.replace('\nfunction tapAt(', `\n${VANE_BOX}function tapAt(`);
  s = s.replace(/(\nfunction tapAt\([^)]*\) \{\n)/, `$1${route}`);
  if (listed) s = s.replace(/(\nfunction tapZones\(\) \{[\s\S]*?return \[\n)/, "$1    { kind: 'vane', ...vaneBox() },\n");
  return s;
};

describe('block barn: tapZones() lists every tap zone tapAt routes', () => {
  it('holds for the game as it is', () => {
    expect(zoneProblems(HTML)).toEqual([]);
  });

  it('routes the doors and the sky through boxes, and the hook only returns the list', () => {
    const tapAt = fnBody(HTML, 'tapAt')!;
    expect(tapAt).toMatch(/doorBox\(\)/);
    expect(tapAt).toMatch(/skyBox\(\)/);
    expect(hookBlock(HTML)).toMatch(/targets: \(\) => tapZones\(\),/);
  });

  // Content grows: a new zone needs only game code (a box, a branch in tapAt, a line in tapZones), never the hook.
  it('a new zone routed by tapAt and listed in tapZones passes with the hook untouched', () => {
    const grown = withVane(HTML);
    expect(grown).toContain('spinVane()');
    expect(grown).toContain("{ kind: 'vane', ...vaneBox() }");
    expect(hookBlock(grown)).toBe(hookBlock(HTML));
    expect(zoneProblems(grown)).toEqual([]);
  });

  it('a zone routed by tapAt but left out of tapZones is caught', () => {
    expect(zoneProblems(withVane(HTML, { listed: false }))).toEqual(['vaneBox() is routed by tapAt but not listed in tapZones()']);
  });

  it('a zone hit-tested without a listed box is caught', () => {
    const own = "  const vr = document.getElementById('vane').getBoundingClientRect();\n  if (x >= vr.left && y >= vr.top) { spinVane(); return; }\n";
    expect(zoneProblems(withVane(HTML, { listed: false, route: own }))).toEqual(['tapAt measures the page itself (getBoundingClientRect), not through a listed box']);
    const rect = '  const vr = vaneRect();\n  if (x >= vr.x && x <= vr.x + vr.w) { spinVane(); return; }\n';
    expect(zoneProblems(withVane(HTML, { listed: false, route: rect }))).toEqual(['tapAt reads a box (vr) that does not come from a listed xxxBox() or hitBoxes()']);
  });

  it('a zone dropped from the list, or a routed kind no zone produces, is caught', () => {
    const dropped = HTML.replace('...hitBoxes().map(', "...hitBoxes().filter((b) => b.kind !== 'tower').map(");
    expect(zoneProblems(dropped)).toContain('tapZones() drops zones (.filter)');
    const bell = HTML.replace("if (best.kind === 'tower')", "if (best.kind === 'bell') { return; }\n  if (best.kind === 'tower')");
    expect(zoneProblems(bell)).toEqual(["tapAt routes kind 'bell' that no zone produces"]);
  });

  it('a hook that filters the list is caught', () => {
    const filtered = HTML.replace('targets: () => tapZones(),', "targets: () => tapZones().filter((z) => z.kind !== 'sky'),");
    expect(zoneProblems(filtered)).toContain('__hal.targets() is not exactly tapZones()');
  });
});
