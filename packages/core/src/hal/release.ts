// Hal release edits: version bump in three places, CHANGELOG entry, commit trailers. Pure string in, string out.

export type ChangeKind = 'fix' | 'tuning' | 'polish' | 'feature';
export type BumpKind = 'patch' | 'minor';

export function bumpKind(kind: ChangeKind): BumpKind {
  return kind === 'feature' ? 'minor' : 'patch';
}

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
function parseSemver(v: string): [number, number, number] {
  const m = SEMVER.exec(v);
  if (!m) throw new Error(`release: not a MAJOR.MINOR.PATCH version: ${JSON.stringify(v)}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}
function bump(v: string, by: BumpKind): string {
  const [a, b, c] = parseSemver(v);
  return by === 'minor' ? `${a}.${b + 1}.0` : `${a}.${b}.${c + 1}`;
}

export interface PlanVersionInput {
  /** The game's version now (game.yaml). */
  current: string;
  kind: ChangeKind;
  /**
   * The bump level Hal itself already used tonight AT `current`, or null if Hal has not released this game at `current`
   * tonight (ruling R20). The caller derives it from git: a commit on refs/hal/main tonight whose trailers are
   * Hal-Game=<game> and Hal-Version=<current> (see halReleasedTonight); then bumpedTonight tells patch from minor.
   * A CHANGELOG heading dated tonight is not enough: it may be Brian's own release.
   */
  alreadyBumpedTonight: BumpKind | null;
}

/**
 * Hal's releases on the same night share one version, except a feature after patch-only changes upgrades to the next
 * minor. Anything else (a new night, or a version Brian released himself tonight) bumps from `current`.
 */
export function planVersion(i: PlanVersionInput): string {
  parseSemver(i.current);
  if (i.alreadyBumpedTonight !== null) {
    if (bumpKind(i.kind) === 'minor' && i.alreadyBumpedTonight !== 'minor') return bump(i.current, 'minor');
    return i.current;
  }
  return bump(i.current, bumpKind(i.kind));
}

/** A Hal-Run id (`run-<iso stamp>` / `undo-<iso stamp>`, colons and dot as dashes) back to its Date, or null. */
export function runIdDate(run: string): Date | null {
  const m = /^(?:run|undo)-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z(?:-\d+)?$/.exec(run);
  if (!m) return null;
  const d = new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`);
  return Number.isFinite(d.getTime()) ? d : null;
}

/**
 * R20: whether refs/hal/main has a Hal commit tonight for `game` at `version`. `commits` are the messages and committer
 * dates of the commits to search (newest first; any order works). A commit counts when its trailers parse, name the
 * game and the version, and its Hal-Run or its commit date falls on `night` (nightOf).
 */
export function halReleasedTonight(commits: Array<{ message: string; date: Date | null }>, game: string, version: string, night: string, tzOffsetMinutes: number): boolean {
  return commits.some((c) => {
    const t = parseTrailers(c.message);
    if (!t || t.game !== game || t.version !== version) return false;
    const ran = runIdDate(t.run);
    return (ran !== null && nightOf(ran, tzOffsetMinutes) === night) || (c.date !== null && Number.isFinite(c.date.getTime()) && nightOf(c.date, tzOffsetMinutes) === night);
  });
}

export interface ReleaseFiles {
  yaml: string;
  html: string;
  changelog: string;
}
export interface ReleaseInput {
  slug: string;
  version: string;
  night: string;
  entry: { kind: ChangeKind; text: string };
  /**
   * Add the bullet under tonight's top heading (renaming it on a minor upgrade) instead of a new heading. Only for a
   * version Hal shares with its own earlier release tonight (planVersion with alreadyBumpedTonight set); default false,
   * so a heading Brian wrote tonight is never merged into.
   */
  shareTonight?: boolean;
}

const oneLine = (s: string) => s.replace(/\s*[\r\n]+\s*/g, ' ').trim();
const HEADING = /^## (\d+\.\d+\.\d+) \((\d{4}-\d{2}-\d{2})\)[ \t]*$/m;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The newest CHANGELOG heading, or null. */
export function topEntry(changelog: string): { version: string; date: string } | null {
  const m = HEADING.exec(changelog);
  return m ? { version: m[1]!, date: m[2]! } : null;
}

/**
 * What tonight's top entry bumped: compares its version with the previous heading. null if the top entry is not tonight's.
 * Only meaningful once halReleasedTonight says that top entry is Hal's own: it then tells patch from minor among Hal's
 * bumps tonight. A heading dated tonight alone may be Brian's release, which Hal never shares.
 */
export function bumpedTonight(changelog: string, night: string): BumpKind | null {
  const heads = [...changelog.matchAll(new RegExp(HEADING.source, 'gm'))];
  const top = heads[0];
  if (!top || top[2] !== night) return null;
  const prev = heads[1];
  if (!prev) return 'minor';
  const [a, b] = parseSemver(top[1]!);
  const [pa, pb] = parseSemver(prev[1]!);
  return a !== pa || b !== pb ? 'minor' : 'patch';
}

/** Edits game.yaml, index.html and CHANGELOG.md. Throws if any file lacks the expected shape. */
export function applyRelease(files: ReleaseFiles, r: ReleaseInput): ReleaseFiles {
  return apply(files, r, r.shareTonight !== true);
}

function apply(files: ReleaseFiles, r: ReleaseInput, forceNewHeading: boolean): ReleaseFiles {
  parseSemver(r.version);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.night)) throw new Error(`release: bad night ${JSON.stringify(r.night)}`);
  const text = oneLine(r.entry.text).replace(/^-\s+/, '');
  if (!text) throw new Error('release: empty changelog entry');

  const yamlRe = /^version:[ \t]*\S+[ \t]*$/m;
  if (!yamlRe.test(files.yaml)) throw new Error('release: game.yaml has no version: line');
  const yaml = files.yaml.replace(yamlRe, () => `version: ${r.version}`);

  const htmlRe = new RegExp(`(createStudio\\(\\{[^}]*game: '${escapeRe(r.slug)}', version: ')[^']+(')`);
  if (!htmlRe.test(files.html)) throw new Error(`release: index.html has no createStudio({ game: '${r.slug}', version: '...' })`);
  const html = files.html.replace(htmlRe, (_m, a: string, b: string) => `${a}${r.version}${b}`);

  const top = HEADING.exec(files.changelog);
  if (!top) throw new Error('release: CHANGELOG.md has no "## x.y.z (date)" heading');
  const bullet = `- ${text}`;
  const idx = top.index;
  const rest = files.changelog.slice(idx + top[0].length);
  const nextRel = rest.search(/^## /m);
  const sectionEnd = nextRel === -1 ? files.changelog.length : idx + top[0].length + nextRel;
  let changelog: string;
  if (!forceNewHeading && top[2] !== r.night) throw new Error(`release: no heading dated ${r.night} to share (top is ${top[1]} (${top[2]}))`);
  if (!forceNewHeading) {
    // Tonight already has an entry: add a bullet, and rename the heading if the version was upgraded.
    const [ca, cb, cc] = parseSemver(top[1]!);
    const [na, nb, nc] = parseSemver(r.version);
    if (na * 1e12 + nb * 1e6 + nc < ca * 1e12 + cb * 1e6 + cc) throw new Error(`release: version ${r.version} is older than tonight's ${top[1]}`);
    const head = `## ${r.version} (${r.night})`;
    const section = files.changelog.slice(idx + top[0].length, sectionEnd).replace(/\s+$/, '');
    const tail = files.changelog.slice(sectionEnd);
    changelog = `${files.changelog.slice(0, idx)}${head}${section}\n${bullet}\n${tail ? `\n${tail}` : ''}`;
  } else {
    const [ca, cb, cc] = parseSemver(top[1]!);
    const [na, nb, nc] = parseSemver(r.version);
    if (na * 1e12 + nb * 1e6 + nc <= ca * 1e12 + cb * 1e6 + cc) throw new Error(`release: version ${r.version} is not newer than ${top[1]}`);
    changelog = `${files.changelog.slice(0, idx)}## ${r.version} (${r.night})\n${bullet}\n\n${files.changelog.slice(idx)}`;
  }
  return { yaml, html, changelog };
}

export interface UndoInput {
  slug: string;
  /** Version in game.yaml now. */
  current: string;
  night: string;
  /** Title of the change being undone. */
  title: string;
  /** Its pass id, e.g. 'HAL-012'. */
  pass: string;
  reason: string;
}

/** Adds `Undone: <title> (<pass>): <reason>` under a NEW patch version heading, even if tonight already has one. Versions never go backwards. */
export function undoEntry(files: ReleaseFiles, u: UndoInput): ReleaseFiles {
  const version = bump(u.current, 'patch');
  const text = `Undone: ${oneLine(u.title)} (${oneLine(u.pass)}): ${oneLine(u.reason)}`;
  return apply(files, { slug: u.slug, version, night: u.night, entry: { kind: 'fix', text } }, true);
}

export interface HalTrailers {
  pass: string;
  game: string;
  kind: ChangeKind;
  why: string;
  scoreBefore: number;
  scoreAfter: number;
  version: string;
  run: string;
  /** Undo commits only: the pass being undone. */
  undo?: string;
  reason?: string;
}

const KEYS: Array<[keyof HalTrailers, string]> = [
  ['pass', 'Hal-Pass'], ['game', 'Hal-Game'], ['kind', 'Hal-Kind'], ['why', 'Hal-Why'],
  ['scoreBefore', 'Hal-Score-Before'], ['scoreAfter', 'Hal-Score-After'], ['version', 'Hal-Version'], ['run', 'Hal-Run'],
  ['undo', 'Hal-Undo'], ['reason', 'Hal-Reason'],
];

/** One `Key: value` line per field (optional fields omitted when undefined). Newlines in values become spaces. */
export function formatTrailers(t: HalTrailers): string {
  const lines: string[] = [];
  if (!Number.isFinite(t.scoreBefore) || !Number.isFinite(t.scoreAfter)) throw new Error('release: trailer scores must be finite numbers');
  for (const [f, key] of KEYS) {
    const v = t[f];
    if (v === undefined) continue;
    const val = oneLine(String(v));
    if (!val && !['undo', 'reason'].includes(f)) throw new Error(`release: empty value for ${key}`);
    lines.push(`${key}: ${val}`);
  }
  return lines.join('\n');
}

/** Reads Hal trailers from a commit message. Returns null unless all required keys are present and valid. */
export function parseTrailers(message: string): HalTrailers | null {
  const map = new Map<string, string>();
  const last = message.replace(/\s+$/, '').split(/\r?\n[ \t]*\r?\n/).pop() ?? '';
  for (const line of last.split(/\r?\n/)) {
    const m = /^(Hal-[A-Za-z-]+):[ \t]*(.*?)[ \t]*$/.exec(line);
    if (m) map.set(m[1]!, m[2]!);
  }
  const get = (k: string) => map.get(k);
  const kind = get('Hal-Kind');
  const before = Number(get('Hal-Score-Before'));
  const after = Number(get('Hal-Score-After'));
  const need = ['Hal-Pass', 'Hal-Game', 'Hal-Why', 'Hal-Version', 'Hal-Run'].map(get);
  if (need.some((v) => !v) || !SEMVER.test(get('Hal-Version')!) || !['fix', 'tuning', 'polish', 'feature'].includes(kind ?? '')) return null;
  if (!get('Hal-Score-Before') || !get('Hal-Score-After') || !Number.isFinite(before) || !Number.isFinite(after)) return null;
  const out: HalTrailers = {
    pass: get('Hal-Pass')!, game: get('Hal-Game')!, kind: kind as ChangeKind, why: get('Hal-Why')!,
    scoreBefore: before, scoreAfter: after, version: get('Hal-Version')!, run: get('Hal-Run')!,
  };
  if (map.has('Hal-Undo')) out.undo = get('Hal-Undo')!;
  if (map.has('Hal-Reason')) out.reason = get('Hal-Reason')!;
  return out;
}

/** A run that starts before 6 a.m. belongs to the previous day's night. tzOffsetMinutes is minutes EAST of UTC (e.g. -360 for US Central standard, +540 for Tokyo). */
export function nightOf(date: Date, tzOffsetMinutes: number): string {
  return new Date(date.getTime() + tzOffsetMinutes * 60_000 - 6 * 3_600_000).toISOString().slice(0, 10);
}
