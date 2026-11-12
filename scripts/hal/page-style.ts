// The look shared by Hal's pages (the morning report and History): Material 3 color roles, type scale and shapes on
// Hal's teal, system fonts only, light and dark. No external requests. The pages run under
// `default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; form-action 'self'` plus, on the report, Hal's own
// `script-src 'self'; connect-src 'self'` for /hal.js (live run status). Everything works without that script.

/** Escapes text for HTML element content and quoted attribute values. Every user and Claude string goes through this. */
export const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export const PAGE_CSS = `
/* ---- tokens: Material 3 color roles (teal seed), with the older names mapped onto them ---- */
:root{
  --md-primary:#006874;--md-on-primary:#ffffff;--md-primary-container:#9eefff;--md-on-primary-container:#001f24;
  --md-secondary-container:#cde7ec;--md-on-secondary-container:#051f23;
  --md-surface:#f5fafb;--md-surface-lowest:#ffffff;--md-surface-low:#eff5f6;--md-surface-container:#e9eff0;--md-surface-high:#e3e9ea;
  --md-on-surface:#171d1e;--md-on-surface-variant:#3f484a;--md-outline:#6f797a;--md-outline-variant:#bfc8ca;
  --md-good:#2a6a3c;--md-good-container:#c9efcf;--md-warn:#7d5700;--md-warn-container:#ffdea8;
  --md-error:#ba1a1a;--md-error-container:#ffdad6;
  --md-shadow:0 1px 2px rgba(0,0,0,.3),0 1px 3px 1px rgba(0,0,0,.15);
  --bg:var(--md-surface);--surface:var(--md-surface-lowest);--fg:var(--md-on-surface);--muted:var(--md-on-surface-variant);
  --line:var(--md-outline-variant);--accent:var(--md-primary);--accent-soft:var(--md-secondary-container);--on-accent:var(--md-on-primary);
  --good:var(--md-good);--good-soft:var(--md-good-container);--warn:var(--md-warn);--warn-soft:var(--md-warn-container);
  --shadow:none;
  --font:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,system-ui,sans-serif;
  --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  color-scheme:light dark;
}
@media (prefers-color-scheme:dark){:root{
  --md-primary:#82d3e0;--md-on-primary:#00363d;--md-primary-container:#004f58;--md-on-primary-container:#9eefff;
  --md-secondary-container:#334b4f;--md-on-secondary-container:#cde7ec;
  --md-surface:#0e1415;--md-surface-lowest:#090f10;--md-surface-low:#171d1e;--md-surface-container:#1b2122;--md-surface-high:#252b2c;
  --md-on-surface:#dee3e5;--md-on-surface-variant:#bfc8ca;--md-outline:#899294;--md-outline-variant:#3f484a;
  --md-good:#9ad3a5;--md-good-container:#0f5128;--md-warn:#f8bd4c;--md-warn-container:#5e4100;
  --md-error:#ffb4ab;--md-error-container:#93000a;
  --surface:var(--md-surface-low);
}}

/* ---- base: M3 type scale ---- */
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:400 16px/24px var(--font);letter-spacing:.01em;overflow-wrap:anywhere}
.page{max-width:560px;margin:0 auto;
  padding:max(20px,env(safe-area-inset-top)) max(16px,env(safe-area-inset-right)) max(40px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left))}
h1,h2,h3{font-family:var(--font);margin:0}
h1{font-size:28px;line-height:36px;font-weight:400;letter-spacing:0}            /* headline-medium */
h2{font-size:22px;line-height:28px;font-weight:400;letter-spacing:0;margin:0 0 12px} /* title-large */
h3{font-size:16px;line-height:24px;font-weight:500;letter-spacing:.009em}      /* title-medium */
p{margin:0 0 10px}p:last-child{margin-bottom:0}
a{color:var(--accent);text-underline-offset:2px}
code{font-family:var(--mono);font-size:.88em;background:var(--md-surface-container);padding:1px 5px;border-radius:4px}
img{max-width:100%;height:auto;display:block}
section{margin:32px 0 0}
.muted{color:var(--muted)}
.small{font-size:14px;line-height:20px;letter-spacing:.016em}                  /* body-medium */
.label{font-size:12px;line-height:16px;font-weight:500;letter-spacing:.04em;color:var(--muted)} /* label-medium */

/* ---- cards and lists: M3 filled / outlined cards, list rows with dividers ---- */
.card{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:16px;margin:0 0 12px}
.card:last-child{margin-bottom:0}
.card.filled{background:var(--md-surface-container);border-color:transparent}
.card.tonal{background:var(--md-primary-container);color:var(--md-on-primary-container);border-color:transparent}
.rows{list-style:none;margin:0;padding:0}
.rows>li{padding:12px 0;border-top:1px solid var(--line)}
.rows>li:first-child{border-top:0;padding-top:0}
.rows>li:last-child{padding-bottom:0}
/* M3 assist/suggestion chips for states and tags */
.pill{display:inline-flex;align-items:center;font-size:12px;font-weight:500;line-height:16px;letter-spacing:.04em;padding:4px 10px;border-radius:8px;white-space:nowrap;
  background:var(--accent-soft);color:var(--md-on-secondary-container)}
.pill.good{background:var(--good-soft);color:var(--good)}
.pill.warn{background:var(--warn-soft);color:var(--warn)}
.pill.outline{background:none;border:1px solid var(--md-outline);color:var(--muted)}
.flash{background:var(--md-surface-high);color:var(--fg);border-radius:4px;padding:14px 16px;margin:0 0 16px;font-weight:500;box-shadow:var(--md-shadow)} /* snackbar */

/* ---- forms and buttons: M3 filled, tonal and outlined buttons, outlined fields ---- */
form{margin:0}
.btn,button{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;min-height:44px;margin:0;padding:10px 24px;
  font:500 14px/20px var(--font);letter-spacing:.007em;border-radius:20px;border:1px solid var(--md-outline);background:none;color:var(--accent);
  text-decoration:none;cursor:pointer;-webkit-appearance:none;appearance:none}
.btn:hover,button:hover{background:color-mix(in srgb,var(--accent) 8%,transparent)}
.btn.primary,button.primary{background:var(--accent);border-color:transparent;color:var(--on-accent)}
.btn.primary:hover,button.primary:hover{background:color-mix(in srgb,var(--accent) 92%,var(--on-accent));box-shadow:var(--md-shadow)}
.btn.tonal,button.tonal{background:var(--accent-soft);border-color:transparent;color:var(--md-on-secondary-container)}
.btn.good,button.good{background:var(--good-soft);border-color:transparent;color:var(--good)}
.btn.warn,button.warn{background:var(--warn-soft);border-color:transparent;color:var(--warn)}
button.inline{width:auto;flex:none;padding:8px 16px}
input[type=text],select,textarea{display:block;width:100%;min-height:48px;margin:0;padding:12px 14px;font:16px/24px var(--font);
  color:var(--fg);background:transparent;border:1px solid var(--md-outline);border-radius:4px}
input[type=text]:focus,select:focus,textarea:focus{outline:none;border:2px solid var(--accent);padding:11px 13px}
textarea{min-height:96px;resize:vertical}
input:focus-visible,select:focus-visible,textarea:focus-visible,button:focus-visible,.btn:focus-visible,summary:focus-visible,a:focus-visible{
  outline:2px solid var(--accent);outline-offset:2px}
.check{display:flex;align-items:center;gap:12px;min-height:44px}
.check input{width:18px;height:18px;margin:0;accent-color:var(--accent)}
.grid2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.stack>*+*{margin-top:12px}
.stack>label.label{margin-top:16px}
.stack>label.label:first-child,.stack>input[type=hidden]+label.label{margin-top:0}
.stack>label.label+*{margin-top:6px}

/* ---- collapsed lists ---- */
details>summary{list-style:none;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:44px}
details>summary::-webkit-details-marker{display:none}
details>summary::after{content:"";flex:none;width:8px;height:8px;margin-right:4px;border-right:2px solid var(--muted);
  border-bottom:2px solid var(--muted);transform:rotate(45deg) translateY(-2px)}
details[open]>summary::after{transform:rotate(225deg) translateY(-2px)}
details.fold{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:4px 16px}
details.fold>summary h2{margin:0;font-size:16px;line-height:24px;font-weight:500}
details.fold[open]{padding-bottom:16px}
details.fold[open]>summary{margin-bottom:8px}
/* "Show all N": the rest of a long list, folded under its first few rows */
details.rest>summary{justify-content:flex-start;color:var(--accent);font-weight:500;font-size:14px;min-height:44px;padding-top:8px}
details.rest>summary::after{border-color:var(--accent)}
details.rest[open]>summary{display:none}
`;

/** The head every Hal page starts with: charset, viewport, color-scheme, title, the shared CSS plus `extraCss`. */
export const pageHead = (title: string, extraCss = ''): string =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">` +
  `<meta name="color-scheme" content="light dark"><title>${esc(title)}</title><style>${PAGE_CSS}${extraCss}</style></head>`;

const inline = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

/**
 * Paragraphs, `-`/`*` and `1.` lists, and `**bold**`; everything else is escaped text. The note's own title lines
 * (`# Hal, night of ...`, `## Director's note, ...`) at the top repeat the page header and are dropped; a heading
 * further down shows as a bold paragraph.
 */
export function noteHtml(md: string): string {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  while (lines.length && (!lines[0]!.trim() || /^#{1,6}\s/.test(lines[0]!.trim()))) lines.shift();
  const out: string[] = [];
  let kind: 'p' | 'ul' | 'ol' | null = null;
  let items: string[] = [];
  const flush = () => {
    if (kind === 'p') out.push(`<p>${items.join(' ')}</p>`);
    else if (kind) out.push(`<${kind}>${items.map((i) => `<li>${i}</li>`).join('')}</${kind}>`);
    kind = null;
    items = [];
  };
  const add = (k: 'p' | 'ul' | 'ol', html: string) => {
    if (kind !== k) flush();
    kind = k;
    items.push(html);
  };
  for (const raw of lines) {
    const t = raw.trim();
    let m: RegExpExecArray | null;
    if (!t) flush();
    else if ((m = /^[-*+]\s+(.*)$/.exec(t))) add('ul', inline(m[1]!));
    else if ((m = /^\d+[.)]\s+(.*)$/.exec(t))) add('ol', inline(m[1]!));
    else if ((m = /^#{1,6}\s+(.*)$/.exec(t))) { flush(); add('p', `<strong>${esc(m[1]!)}</strong>`); flush(); }
    else add('p', inline(t));
  }
  flush();
  return out.join('\n');
}
