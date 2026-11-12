// The look shared by Hal's pages (the morning report, and History later): Brian's mockup tokens, system fonts only,
// one 520px column, light and dark. No external requests and no JavaScript: the pages run under
// `default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; form-action 'self'`.

/** Escapes text for HTML element content and quoted attribute values. Every user and Claude string goes through this. */
export const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export const PAGE_CSS = `
/* ---- tokens ---- */
:root{
  --bg:#f3f6f7;--surface:#ffffff;--fg:#14232b;--muted:#5b6d76;--line:#dbe4e8;
  --accent:#0f7c8c;--accent-soft:#dff1f3;--on-accent:#ffffff;
  --good:#2f8a4e;--good-soft:#e2f3e7;--warn:#b5701a;--warn-soft:#fbefdc;
  --shadow:0 1px 2px rgba(20,35,43,.05);
  --font:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;
  --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  color-scheme:light dark;
}
@media (prefers-color-scheme:dark){:root{
  --bg:#0d171c;--surface:#15232a;--fg:#e6eef1;--muted:#93a7b0;--line:#253740;
  --accent:#4fc3d2;--accent-soft:#143a41;--on-accent:#0d171c;
  --good:#5fcf86;--good-soft:#163524;--warn:#e9a34d;--warn-soft:#3a2a14;
  --shadow:none;
}}

/* ---- base ---- */
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 var(--font);overflow-wrap:anywhere}
.page{max-width:520px;margin:0 auto;
  padding:max(20px,env(safe-area-inset-top)) max(16px,env(safe-area-inset-right)) max(40px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left))}
h1,h2,h3{font-family:var(--font);font-weight:700;margin:0;line-height:1.2}
h1{font-size:28px;letter-spacing:-.02em}
h2{font-size:19px;letter-spacing:-.01em;margin:0 0 10px}
h3{font-size:16px}
p{margin:0 0 10px}p:last-child{margin-bottom:0}
a{color:var(--accent);text-underline-offset:2px}
code{font-family:var(--mono);font-size:.88em;background:var(--accent-soft);padding:1px 5px;border-radius:5px}
img{max-width:100%;height:auto;display:block}
section{margin:28px 0 0}
.muted{color:var(--muted)}
.small{font-size:14px}
.label{font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}

/* ---- cards and lists ---- */
.card{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:16px;box-shadow:var(--shadow);margin:0 0 12px}
.card:last-child{margin-bottom:0}
.rows{list-style:none;margin:0;padding:0}
.rows>li{padding:12px 0;border-top:1px solid var(--line)}
.rows>li:first-child{border-top:0;padding-top:0}
.rows>li:last-child{padding-bottom:0}
.pill{display:inline-block;font-size:12px;font-weight:600;line-height:1;padding:5px 9px;border-radius:999px;white-space:nowrap;
  background:var(--accent-soft);color:var(--accent)}
.pill.good{background:var(--good-soft);color:var(--good)}
.pill.warn{background:var(--warn-soft);color:var(--warn)}
.flash{background:var(--accent-soft);color:var(--fg);border-radius:12px;padding:12px 14px;margin:0 0 16px;font-weight:600}

/* ---- forms and buttons ---- */
form{margin:0}
.btn,button{display:flex;align-items:center;justify-content:center;gap:6px;width:100%;min-height:44px;margin:0;padding:10px 14px;
  font:600 16px/1.2 var(--font);border-radius:12px;border:1px solid var(--line);background:var(--surface);color:var(--fg);
  text-decoration:none;cursor:pointer;-webkit-appearance:none;appearance:none}
.btn.primary,button.primary{background:var(--accent);border-color:var(--accent);color:var(--on-accent)}
.btn.good,button.good{background:var(--good-soft);border-color:transparent;color:var(--good)}
.btn.warn,button.warn{background:var(--warn-soft);border-color:transparent;color:var(--warn)}
button.inline{width:auto;flex:none;padding:8px 14px;font-size:15px}
input[type=text],select,textarea{display:block;width:100%;min-height:44px;margin:0;padding:10px 12px;font:16px/1.4 var(--font);
  color:var(--fg);background:var(--bg);border:1px solid var(--line);border-radius:10px}
textarea{min-height:96px;resize:vertical}
input:focus-visible,select:focus-visible,textarea:focus-visible,button:focus-visible,.btn:focus-visible,summary:focus-visible,a:focus-visible{
  outline:2px solid var(--accent);outline-offset:2px}
.check{display:flex;align-items:center;gap:10px;min-height:44px}
.check input{width:20px;height:20px;margin:0;accent-color:var(--accent)}
.grid2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.stack>*+*{margin-top:10px}
.stack>label.label{margin-top:16px}
.stack>label.label:first-child,.stack>input[type=hidden]+label.label{margin-top:0}
.stack>label.label+*{margin-top:6px}

/* ---- collapsed lists ---- */
details>summary{list-style:none;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:44px}
details>summary::-webkit-details-marker{display:none}
details>summary::after{content:"";flex:none;width:8px;height:8px;margin-right:4px;border-right:2px solid var(--muted);
  border-bottom:2px solid var(--muted);transform:rotate(45deg) translateY(-2px)}
details[open]>summary::after{transform:rotate(225deg) translateY(-2px)}
details.fold{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:4px 16px}
details.fold>summary h2{margin:0}
details.fold[open]{padding-bottom:16px}
details.fold[open]>summary{margin-bottom:8px}
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
