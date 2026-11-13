// Block Barn's pictures, all drawn in code as SVG: the 26 animals, the hidden friend and the hay puff.
// One house style so they read as a set: chunky flat shapes, one warm dark outline, the same big friendly
// eyes and rosy cheeks on everyone. Each animal is a 120x120 picture standing on a baseline near y=112.
// Parts that a move animates carry a class: .p-head .p-tail .p-tongue .p-spout .p-wing .p-wing2 .p-legs .p-trunk .p-ears.

const INK = '#4a3426';
const S = `stroke="${INK}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"`;

const eye = (x, y, r = 7) =>
  `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" ${S}/><circle cx="${x + r * 0.15}" cy="${y + r * 0.15}" r="${r * 0.55}" fill="${INK}"/>` +
  `<circle cx="${x + r * 0.35}" cy="${y - r * 0.2}" r="${r * 0.2}" fill="#fff"/>`;
const eyes = (x1, x2, y, r) => eye(x1, y, r) + eye(x2, y, r);
const cheek = (x, y, r = 5) => `<ellipse cx="${x}" cy="${y}" rx="${r}" ry="${r * 0.7}" fill="#ff8f8f" opacity=".55"/>`;
const cheeks = (x1, x2, y, r) => cheek(x1, y, r) + cheek(x2, y, r);
const smile = (x, y, w = 8) => `<path d="M${x - w} ${y} Q${x} ${y + w * 0.8} ${x + w} ${y}" fill="none" ${S}/>`;
const shadow = `<ellipse cx="60" cy="113" rx="34" ry="5" fill="#000" opacity=".12"/>`;

const PICS = {
  // A ant: three round segments, six legs, bent antennae.
  a: () => `${shadow}
    <g class="p-legs" fill="none" ${S}>
      <path d="M44 84 L34 104"/><path d="M52 86 L50 106"/><path d="M60 86 L66 106"/>
      <path d="M70 84 L80 104"/><path d="M38 80 L24 96"/><path d="M76 80 L92 98"/>
    </g>
    <ellipse cx="88" cy="74" rx="22" ry="18" fill="#c8513a" ${S}/>
    <ellipse cx="60" cy="78" rx="13" ry="11" fill="#c8513a" ${S}/>
    <g class="p-head">
      <path d="M30 52 Q24 30 14 28" fill="none" ${S}/><path d="M40 50 Q42 28 34 20" fill="none" ${S}/>
      <circle cx="14" cy="28" r="4" fill="${INK}"/><circle cx="34" cy="20" r="4" fill="${INK}"/>
      <circle cx="34" cy="68" r="22" fill="#d8644a" ${S}/>
      ${eyes(26, 42, 64, 6)}${cheeks(20, 48, 76, 4)}${smile(34, 78, 6)}
    </g>`,

  // B bear: round brown head, round ears, tan muzzle.
  b: () => `${shadow}
    <g class="p-ears"><circle cx="30" cy="30" r="15" fill="#9a6232" ${S}/><circle cx="30" cy="30" r="7" fill="#e0b07a"/>
    <circle cx="90" cy="30" r="15" fill="#9a6232" ${S}/><circle cx="90" cy="30" r="7" fill="#e0b07a"/></g>
    <circle cx="60" cy="64" r="44" fill="#a86b36" ${S}/>
    <ellipse cx="60" cy="82" rx="20" ry="16" fill="#e8c08a" ${S}/>
    <ellipse cx="60" cy="74" rx="8" ry="6" fill="${INK}"/>
    ${eyes(42, 78, 54, 7)}${cheeks(32, 88, 74, 6)}${smile(60, 86, 7)}`,

  // C cow: white with black patches, pink muzzle, little horns.
  c: () => `${shadow}
    <path d="M36 24 Q30 10 38 6" fill="none" stroke="#e8d7a8" stroke-width="7" stroke-linecap="round"/>
    <path d="M84 24 Q90 10 82 6" fill="none" stroke="#e8d7a8" stroke-width="7" stroke-linecap="round"/>
    <g class="p-ears"><ellipse cx="18" cy="40" rx="15" ry="8" fill="#fff" ${S} transform="rotate(-20 18 40)"/>
    <ellipse cx="102" cy="40" rx="15" ry="8" fill="#fff" ${S} transform="rotate(20 102 40)"/></g>
    <rect x="22" y="18" width="76" height="86" rx="34" fill="#fff" ${S}/>
    <path d="M28 40 Q36 22 54 26 Q50 44 34 50 Z" fill="#2f2a2a"/>
    <path d="M92 58 Q78 54 80 72 Q90 76 94 70 Z" fill="#2f2a2a"/>
    <ellipse cx="60" cy="86" rx="30" ry="18" fill="#ffb3b8" ${S}/>
    <ellipse cx="50" cy="86" rx="4" ry="5" fill="${INK}"/><ellipse cx="70" cy="86" rx="4" ry="5" fill="${INK}"/>
    ${eyes(44, 76, 52, 7)}`,

  // D duck: yellow body, round head, orange bill and feet.
  d: () => `${shadow}
    <path d="M44 106 l-8 6 h16 Z M70 106 l-8 6 h16 Z" fill="#f08a24" ${S}/>
    <ellipse cx="64" cy="82" rx="38" ry="26" fill="#ffd23f" ${S}/>
    <path class="p-wing" d="M58 76 Q76 66 92 80 Q78 96 60 88 Z" fill="#f5bf1f" ${S}/>
    <g class="p-head">
      <circle cx="44" cy="44" r="24" fill="#ffd23f" ${S}/>
      <path d="M18 50 Q4 52 6 58 Q14 64 30 58 Z" fill="#f08a24" ${S}/>
      ${eye(42, 40, 7)}${cheek(54, 54, 5)}
    </g>`,

  // E elephant: grey head, big ears, curling trunk.
  e: () => `${shadow}
    <g class="p-ears"><ellipse cx="22" cy="54" rx="22" ry="30" fill="#9fb0c2" ${S}/><ellipse cx="24" cy="54" rx="12" ry="19" fill="#f2b8c2"/>
    <ellipse cx="98" cy="54" rx="22" ry="30" fill="#9fb0c2" ${S}/><ellipse cx="96" cy="54" rx="12" ry="19" fill="#f2b8c2"/></g>
    <circle cx="60" cy="52" r="34" fill="#b0c0d0" ${S}/>
    <path class="p-trunk" d="M50 70 Q48 96 58 106 Q70 112 76 100 Q70 100 66 96 Q62 88 70 70 Z" fill="#b0c0d0" ${S}/>
    ${eyes(46, 74, 48, 7)}${cheeks(38, 82, 64, 5)}`,

  // F frog: wide green head, eye bumps on top, big smile.
  f: () => `${shadow}
    <circle cx="36" cy="38" r="17" fill="#5cbf4a" ${S}/><circle cx="84" cy="38" r="17" fill="#5cbf4a" ${S}/>
    <ellipse cx="60" cy="76" rx="48" ry="34" fill="#5cbf4a" ${S}/>
    <ellipse cx="60" cy="90" rx="30" ry="14" fill="#b6e36a"/>
    ${eyes(36, 84, 36, 9)}${cheeks(26, 94, 74, 7)}
    <path d="M34 72 Q60 92 86 72" fill="none" ${S}/>`,

  // G goat: pale head, curved horns, beard, side ears.
  g: () => `${shadow}
    <path d="M44 26 Q30 2 16 18" fill="none" stroke="#8a7a66" stroke-width="8" stroke-linecap="round"/>
    <path d="M76 26 Q90 2 104 18" fill="none" stroke="#8a7a66" stroke-width="8" stroke-linecap="round"/>
    <g class="p-ears"><ellipse cx="18" cy="48" rx="16" ry="7" fill="#e6ddd0" ${S} transform="rotate(15 18 48)"/>
    <ellipse cx="102" cy="48" rx="16" ry="7" fill="#e6ddd0" ${S} transform="rotate(-15 102 48)"/></g>
    <path d="M52 92 Q60 116 68 92 Z" fill="#cfc4b4" ${S}/>
    <rect x="30" y="20" width="60" height="78" rx="28" fill="#efe8dc" ${S}/>
    <ellipse cx="60" cy="80" rx="18" ry="12" fill="#e9c3c3" ${S}/>
    <ellipse cx="54" cy="80" rx="3" ry="4" fill="${INK}"/><ellipse cx="66" cy="80" rx="3" ry="4" fill="${INK}"/>
    ${eyes(46, 74, 50, 7)}`,

  // H horse: long brown head, dark mane, ears up.
  h: () => `${shadow}
    <g class="p-ears"><path d="M38 28 L34 6 L50 20 Z" fill="#b5763e" ${S}/><path d="M82 28 L86 6 L70 20 Z" fill="#b5763e" ${S}/></g>
    <path d="M46 18 Q60 8 74 18 L70 40 L50 40 Z" fill="#4a2e1e" ${S}/>
    <rect x="32" y="22" width="56" height="88" rx="26" fill="#c4834a" ${S}/>
    <ellipse cx="60" cy="92" rx="26" ry="18" fill="#e0a774" ${S}/>
    <ellipse cx="50" cy="92" rx="4" ry="5" fill="${INK}"/><ellipse cx="70" cy="92" rx="4" ry="5" fill="${INK}"/>
    <path d="M50 22 Q56 30 54 38 M60 20 Q66 28 63 36" fill="none" stroke="#4a2e1e" stroke-width="6" stroke-linecap="round"/>
    ${eyes(46, 74, 56, 7)}`,

  // I iguana: green side view, spiky back, long curling tail, a tongue that flicks.
  i: () => `${shadow}
    <path class="p-tail" d="M84 92 Q112 96 112 76 Q112 64 102 66" fill="none" stroke="#5aa84a" stroke-width="10" stroke-linecap="round"/>
    <path d="M30 70 l6 -12 l6 12 l6 -12 l6 12 l6 -12 l6 12 l6 -12 l6 12" fill="#3f8a3a" ${S}/>
    <ellipse cx="62" cy="84" rx="30" ry="16" fill="#6cc05a" ${S}/>
    <path d="M44 96 l-6 12 M80 96 l6 12" ${S}/>
    <g class="p-head">
      <path class="p-tongue" d="M8 72 L-4 70 M-4 70 l-4 -4 M-4 70 l-4 4" fill="none" stroke="#e8506a" stroke-width="3" stroke-linecap="round"/>
      <ellipse cx="26" cy="70" rx="20" ry="14" fill="#6cc05a" ${S}/>
      <circle cx="34" cy="80" r="6" fill="#f0c94a" ${S}/>
      ${eye(26, 64, 6)}
    </g>`,

  // J jellyfish: pink dome, wavy tentacles.
  j: () => `
    <g fill="none" stroke="#e66fa6" stroke-width="5" stroke-linecap="round" class="p-legs">
      <path d="M36 62 Q28 76 36 88 Q44 100 36 112"/><path d="M52 64 Q46 80 52 94 Q58 106 52 116"/>
      <path d="M68 64 Q74 80 68 94 Q62 106 68 116"/><path d="M84 62 Q92 76 84 88 Q76 100 84 112"/>
    </g>
    <path d="M18 62 Q18 14 60 14 Q102 14 102 62 Q90 70 78 62 Q68 70 60 62 Q50 70 42 62 Q30 70 18 62 Z" fill="#ff9cc8" ${S}/>
    <ellipse cx="44" cy="28" rx="10" ry="5" fill="#fff" opacity=".5"/>
    ${eyes(46, 74, 42, 7)}${cheeks(36, 84, 52, 5)}${smile(60, 50, 6)}`,

  // K kangaroo: tan, standing on big feet, long tail, pouch.
  k: () => `${shadow}
    <path class="p-tail" d="M74 100 Q104 104 114 84" fill="none" stroke="#c98a4e" stroke-width="12" stroke-linecap="round"/>
    <ellipse cx="60" cy="108" rx="24" ry="6" fill="#b07440" ${S}/>
    <ellipse cx="60" cy="80" rx="26" ry="30" fill="#d39858" ${S}/>
    <path d="M46 84 Q60 104 74 84" fill="#efc48c" ${S}/>
    <path d="M46 62 l-10 10 M74 62 l10 10" ${S}/>
    <g class="p-head">
      <g class="p-ears"><path d="M42 30 L36 2 L54 22 Z" fill="#d39858" ${S}/><path d="M76 30 L84 2 L66 22 Z" fill="#d39858" ${S}/></g>
      <ellipse cx="60" cy="40" rx="22" ry="20" fill="#d39858" ${S}/>
      <ellipse cx="60" cy="50" rx="10" ry="7" fill="#efc48c"/>
      <ellipse cx="60" cy="46" rx="4" ry="3" fill="${INK}"/>
      ${eyes(50, 70, 36, 6)}
    </g>`,

  // L lion: golden face in a big scalloped orange mane.
  l: () => `${shadow}
    <path d="M60 6 l12 10 l16 -4 l4 16 l16 6 l-6 16 l10 14 l-14 10 l2 16 l-16 2 l-8 14 l-16 -8 l-16 8 l-8 -14 l-16 -2 l2 -16 l-14 -10 l10 -14 l-6 -16 l16 -6 l4 -16 l16 4 Z" fill="#e8892e" ${S}/>
    <circle cx="60" cy="62" r="32" fill="#f7c35a" ${S}/>
    <circle cx="36" cy="36" r="8" fill="#f7c35a" ${S}/><circle cx="84" cy="36" r="8" fill="#f7c35a" ${S}/>
    <ellipse cx="60" cy="78" rx="14" ry="10" fill="#fbe1a6"/>
    <path d="M54 72 h12 l-6 6 Z" fill="${INK}" ${S}/>
    ${eyes(46, 74, 58, 7)}${cheeks(38, 82, 74, 5)}${smile(60, 84, 6)}`,

  // M monkey: brown head, big round ears, heart-shaped tan face.
  m: () => `${shadow}
    <g class="p-ears"><circle cx="16" cy="58" r="14" fill="#8a5a34" ${S}/><circle cx="16" cy="58" r="7" fill="#f0c99a"/>
    <circle cx="104" cy="58" r="14" fill="#8a5a34" ${S}/><circle cx="104" cy="58" r="7" fill="#f0c99a"/></g>
    <circle cx="60" cy="58" r="42" fill="#8a5a34" ${S}/>
    <path d="M60 46 Q44 26 30 42 Q22 58 34 72 Q30 98 60 100 Q90 98 86 72 Q98 58 90 42 Q76 26 60 46 Z" fill="#f0c99a" ${S}/>
    <ellipse cx="54" cy="76" rx="2.5" ry="3" fill="${INK}"/><ellipse cx="66" cy="76" rx="2.5" ry="3" fill="${INK}"/>
    ${eyes(46, 74, 56, 7)}${smile(60, 86, 9)}`,

  // N newt: small orange lizard, top view, spots, wiggly tail.
  n: () => `${shadow}
    <path class="p-tail" d="M76 86 Q96 84 100 96 Q104 108 116 104" fill="none" stroke="#f07b2a" stroke-width="9" stroke-linecap="round"/>
    <path d="M38 76 l-12 -10 M38 94 l-12 10 M70 76 l10 -10 M70 94 l10 10" ${S}/>
    <ellipse cx="54" cy="85" rx="26" ry="13" fill="#ff8f3a" ${S}/>
    <circle cx="48" cy="82" r="3" fill="#c8402a"/><circle cx="62" cy="88" r="3" fill="#c8402a"/><circle cx="70" cy="80" r="2.5" fill="#c8402a"/>
    <g class="p-head">
      <ellipse cx="22" cy="84" rx="16" ry="13" fill="#ff8f3a" ${S}/>
      ${eye(18, 78, 5)}${eye(30, 78, 5)}${smile(22, 88, 5)}
    </g>`,

  // O owl: brown egg body, big eye rings, ear tufts, small beak.
  o: () => `${shadow}
    <path d="M28 30 L24 8 L44 22 Z M92 30 L96 8 L76 22 Z" fill="#8a6440" ${S}/>
    <path class="p-wing" d="M22 60 Q8 82 26 102 Z" fill="#7a5636" ${S}/>
    <path class="p-wing2" d="M98 60 Q112 82 94 102 Z" fill="#7a5636" ${S}/>
    <ellipse cx="60" cy="66" rx="40" ry="46" fill="#a27a50" ${S}/>
    <ellipse cx="60" cy="86" rx="24" ry="22" fill="#e9d3ad"/>
    <path d="M50 84 q4 4 8 0 M62 84 q4 4 8 0 M56 94 q4 4 8 0" fill="none" stroke="#b8935e" stroke-width="2.5" stroke-linecap="round"/>
    <g class="p-head">
      <circle cx="42" cy="46" r="16" fill="#f3e4c6" ${S}/><circle cx="78" cy="46" r="16" fill="#f3e4c6" ${S}/>
      ${eyes(42, 78, 46, 9)}
      <path d="M54 58 L66 58 L60 70 Z" fill="#f0a43a" ${S}/>
    </g>`,

  // P pig: pink round head, snout, folded ears.
  p: () => `${shadow}
    <g class="p-ears"><path d="M26 34 L20 8 L48 22 Z" fill="#f59ab0" ${S}/><path d="M94 34 L100 8 L72 22 Z" fill="#f59ab0" ${S}/></g>
    <circle cx="60" cy="62" r="44" fill="#ffb6c8" ${S}/>
    <ellipse cx="60" cy="74" rx="20" ry="14" fill="#f58aa4" ${S}/>
    <ellipse cx="53" cy="74" rx="4" ry="6" fill="#b8455e"/><ellipse cx="67" cy="74" rx="4" ry="6" fill="#b8455e"/>
    ${eyes(42, 78, 50, 7)}${cheeks(30, 90, 72, 6)}${smile(60, 94, 7)}`,

  // Q quail: round speckled bird with a curly topknot.
  q: () => `${shadow}
    <path d="M44 106 v6 M70 106 v6" ${S}/>
    <path d="M94 70 Q112 64 110 82 Z" fill="#7a6a5a" ${S}/>
    <ellipse cx="62" cy="78" rx="38" ry="30" fill="#9a8670" ${S}/>
    <ellipse cx="54" cy="88" rx="24" ry="16" fill="#d8c2a0"/>
    <circle cx="60" cy="74" r="2.5" fill="#5a4a3a"/><circle cx="74" cy="82" r="2.5" fill="#5a4a3a"/><circle cx="70" cy="68" r="2.5" fill="#5a4a3a"/><circle cx="82" cy="74" r="2.5" fill="#5a4a3a"/>
    <path class="p-wing" d="M66 76 Q88 70 96 88 Q80 98 66 88 Z" fill="#86735e" ${S}/>
    <g class="p-head">
      <path d="M40 24 Q40 6 54 8 Q50 16 44 24" fill="#3a2e26" ${S}/>
      <circle cx="40" cy="44" r="20" fill="#9a8670" ${S}/>
      <path d="M24 50 Q30 40 40 44 Q48 48 56 46 Q52 62 40 62 Q28 60 24 50 Z" fill="#f2ead8"/>
      <path d="M20 46 L10 50 L20 54 Z" fill="#4a3a2a" ${S}/>
      ${eye(38, 40, 6)}
    </g>`,

  // R rabbit: grey-white head, tall pink-lined ears, buck teeth.
  r: () => `${shadow}
    <g class="p-ears"><ellipse cx="42" cy="26" rx="11" ry="26" fill="#ece8e4" ${S}/><ellipse cx="42" cy="26" rx="5" ry="18" fill="#f7b6c4"/>
    <ellipse cx="78" cy="26" rx="11" ry="26" fill="#ece8e4" ${S}/><ellipse cx="78" cy="26" rx="5" ry="18" fill="#f7b6c4"/></g>
    <circle cx="60" cy="74" r="36" fill="#f4f1ee" ${S}/>
    <path d="M55 88 h10 v8 h-10 Z" fill="#fff" ${S}/>
    <path d="M55 80 h10 l-5 5 Z" fill="#f58aa4" ${S}/>
    ${eyes(46, 74, 66, 7)}${cheeks(36, 84, 82, 6)}`,

  // S sheep: dark face peeking out of a fluffy white wool cloud.
  s: () => `${shadow}
    <g fill="#fff" ${S}>
      <circle cx="30" cy="52" r="16"/><circle cx="46" cy="30" r="16"/><circle cx="74" cy="30" r="16"/><circle cx="90" cy="52" r="16"/>
      <circle cx="88" cy="80" r="16"/><circle cx="32" cy="80" r="16"/><circle cx="60" cy="96" r="16"/><circle cx="60" cy="24" r="14"/>
    </g>
    <circle cx="60" cy="60" r="34" fill="#fff"/>
    <g class="p-ears"><ellipse cx="28" cy="58" rx="12" ry="6" fill="#4a4040" ${S}/><ellipse cx="92" cy="58" rx="12" ry="6" fill="#4a4040" ${S}/></g>
    <ellipse cx="60" cy="66" rx="22" ry="28" fill="#5a4e4e" ${S}/>
    <circle cx="50" cy="36" r="9" fill="#fff"/><circle cx="62" cy="34" r="9" fill="#fff"/><circle cx="72" cy="38" r="8" fill="#fff"/>
    ${eyes(50, 70, 60, 7)}${smile(60, 80, 6)}`,

  // T turtle: green domed shell with plates, head and feet that tuck in.
  t: () => `${shadow}
    <path d="M30 98 l-8 10 h16 Z M80 98 l8 10 h-16 Z" fill="#8ccf6a" ${S}/>
    <g class="p-head">
      <ellipse cx="20" cy="84" rx="16" ry="13" fill="#8ccf6a" ${S}/>
      ${eye(16, 80, 6)}${smile(16, 88, 4)}
    </g>
    <path d="M24 98 Q26 44 68 44 Q108 44 108 98 Z" fill="#3f9a5a" ${S}/>
    <path d="M54 60 l12 -6 l12 6 v14 l-12 6 l-12 -6 Z M36 92 l8 -12 l10 6 v8 Z M96 92 l-8 -12 l-10 6 v8 Z" fill="#6cc07a" ${S}/>
    <path d="M20 98 h92" ${S}/>`,

  // U sea urchin: purple ball with friendly eyes and radiating spines.
  u: () => `${shadow}
    <g class="p-legs" stroke="#7a4aa8" stroke-width="5" stroke-linecap="round">
      ${Array.from({ length: 16 }, (_, k) => {
        const a = (k / 16) * Math.PI * 2;
        const x1 = 60 + Math.cos(a) * 30, y1 = 66 + Math.sin(a) * 30, x2 = 60 + Math.cos(a) * 50, y2 = 66 + Math.sin(a) * 50;
        return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`;
      }).join('')}
    </g>
    <circle cx="60" cy="66" r="34" fill="#a06ad0" ${S}/>
    <circle cx="48" cy="50" r="6" fill="#fff" opacity=".35"/>
    ${eyes(48, 72, 64, 8)}${cheeks(38, 82, 78, 5)}${smile(60, 80, 6)}`,

  // V vulture: dark wings, white ruff, pink bald head, hooked beak, friendly.
  v: () => `${shadow}
    <path d="M48 104 v8 M72 104 v8" ${S}/>
    <path class="p-wing" d="M34 56 Q2 64 10 100 Q30 96 40 84 Z" fill="#4a3a3a" ${S}/>
    <path class="p-wing2" d="M86 56 Q118 64 110 100 Q90 96 80 84 Z" fill="#4a3a3a" ${S}/>
    <ellipse cx="60" cy="80" rx="30" ry="28" fill="#5e4a46" ${S}/>
    <g fill="#f4efe6" ${S}><circle cx="44" cy="54" r="10"/><circle cx="60" cy="58" r="11"/><circle cx="76" cy="54" r="10"/></g>
    <g class="p-head">
      <circle cx="60" cy="32" r="20" fill="#f0a6a0" ${S}/>
      <path d="M54 40 Q60 58 70 46 Q66 40 54 40 Z" fill="#f0d070" ${S}/>
      ${eyes(52, 68, 28, 6)}
    </g>`,

  // W whale: blue side view, pale belly, tail fluke, a water spout.
  w: () => `${shadow}
    <g class="p-spout" fill="none" stroke="#6ec6f0" stroke-width="5" stroke-linecap="round">
      <path d="M44 34 Q44 20 34 12"/><path d="M48 34 Q48 18 58 10"/><path d="M46 34 V14"/>
    </g>
    <path class="p-tail" d="M96 70 Q104 50 118 46 Q112 62 116 76 Q104 74 96 82 Z" fill="#4a8fd6" ${S}/>
    <path d="M10 76 Q10 36 52 36 Q100 36 100 76 Q100 104 52 104 Q10 104 10 76 Z" fill="#5aa2e6" ${S}/>
    <path d="M16 84 Q40 104 90 90 Q80 102 52 102 Q22 102 16 84 Z" fill="#cfe8fb"/>
    <path d="M58 82 Q66 94 76 84" fill="#4a8fd6" ${S}/>
    ${eye(34, 64, 7)}${cheek(24, 78, 5)}${smile(26, 84, 5)}`,

  // X fox: orange face, tall pointed ears, white cheeks, black nose.
  x: () => `${shadow}
    <g class="p-ears"><path d="M24 50 L18 6 L52 30 Z" fill="#f07a2a" ${S}/><path d="M26 40 L23 18 L40 30 Z" fill="#3a2a22"/>
    <path d="M96 50 L102 6 L68 30 Z" fill="#f07a2a" ${S}/><path d="M94 40 L97 18 L80 30 Z" fill="#3a2a22"/></g>
    <path d="M16 46 Q20 26 60 26 Q100 26 104 46 Q108 70 60 104 Q12 70 16 46 Z" fill="#f4843a" ${S}/>
    <path d="M18 54 Q40 60 52 82 L60 104 Q24 80 18 54 Z M102 54 Q80 60 68 82 L60 104 Q96 80 102 54 Z" fill="#fff"/>
    <path d="M60 104 Q12 70 16 46 Q20 26 60 26 Q100 26 104 46 Q108 70 60 104 Z" fill="none" ${S}/>
    <ellipse cx="60" cy="94" rx="7" ry="5" fill="${INK}"/>
    ${eyes(44, 76, 56, 7)}`,

  // Y yak: shaggy dark brown head, wide curved horns, long fringe.
  y: () => `${shadow}
    <path d="M36 32 Q8 32 8 8" fill="none" stroke="#efe4cc" stroke-width="9" stroke-linecap="round"/>
    <path d="M84 32 Q112 32 112 8" fill="none" stroke="#efe4cc" stroke-width="9" stroke-linecap="round"/>
    <path d="M20 40 Q60 10 100 40 L106 100 Q96 96 92 106 Q84 98 76 108 Q68 100 60 110 Q52 100 44 108 Q36 98 28 106 Q24 96 14 100 Z" fill="#6a4a32" ${S}/>
    <ellipse cx="60" cy="86" rx="20" ry="14" fill="#9a7a5e" ${S}/>
    <ellipse cx="53" cy="86" rx="3" ry="4" fill="${INK}"/><ellipse cx="67" cy="86" rx="3" ry="4" fill="${INK}"/>
    ${eyes(44, 76, 58, 7)}
    <path d="M30 36 Q44 46 54 38 Q60 48 66 38 Q76 46 90 36" fill="#5a3c28" ${S}/>`,

  // Z zebra: white horse-like head with bold black stripes and a striped mane.
  z: () => `${shadow}
    <g class="p-ears"><path d="M38 28 L32 4 L52 20 Z" fill="#fff" ${S}/><path d="M82 28 L88 4 L68 20 Z" fill="#fff" ${S}/></g>
    <path d="M48 12 h24 v26 h-24 Z" fill="#2a2424"/>
    <path d="M50 12 v26 M58 10 v28 M66 10 v28" stroke="#fff" stroke-width="3"/>
    <rect x="32" y="22" width="56" height="88" rx="26" fill="#fff" ${S}/>
    <path d="M33 40 q8 2 12 -4 M87 40 q-8 2 -12 -4 M32 70 q10 0 14 -6 M88 70 q-10 0 -14 -6 M44 28 q16 6 32 0 M50 40 q10 4 20 0" fill="none" stroke="#2a2424" stroke-width="5" stroke-linecap="round"/>
    <ellipse cx="60" cy="92" rx="26" ry="18" fill="#4a4040" ${S}/>
    <ellipse cx="50" cy="92" rx="4" ry="5" fill="#1a1414"/><ellipse cx="70" cy="92" rx="4" ry="5" fill="#1a1414"/>
    ${eyes(46, 74, 58, 7)}`,
};

// Each drawing's own bounds (its getBBox, in the 120x120 picture's units), so the picture fills its box: a tall
// horse fills the height, a long iguana the width. Strokes and the shadow fit inside the 2-unit margin.
const BOUNDS = {
  a: [10, 16, 100, 102], b: [15, 15, 90, 103], c: [1.2, 6, 117.7, 112], d: [5.8, 20, 96.3, 98], e: [0, 18, 120, 100],
  f: [12, 21, 96, 97], g: [0.7, 11.6, 118.5, 106.4], h: [26, 6, 68, 112], i: [-8, 56, 120, 62], j: [18, 14, 84, 102],
  k: [26, 2, 88, 116], l: [8, 6, 104, 112], m: [2, 16, 116, 102], n: [6, 66, 110, 52], o: [15.9, 8, 88.3, 110],
  p: [16, 8, 88, 110], q: [10, 7.8, 100.2, 110.2], r: [24, 0, 72, 118], s: [14, 10, 92, 108], t: [4, 44, 108, 74],
  u: [10, 16, 100, 102], v: [8.4, 12, 103.2, 106], w: [10, 10, 108, 108], x: [15.7, 6, 88.6, 112], y: [8, 8, 104, 110],
  z: [26, 4, 68, 114],
};
const M = 2;

/** The SVG markup for an animal (letter a..z): its drawing (.art) fills the box, standing on its bottom edge. */
export function animalSVG(letter) {
  const pic = PICS[letter];
  if (!pic) throw new Error(`no picture for ${letter}`);
  const [x, y, w, h] = BOUNDS[letter];
  const vb = `${x - M} ${y - M} ${w + 2 * M} ${h + 2 * M}`;
  return `<svg class="pic" viewBox="${vb}" preserveAspectRatio="xMidYMax meet" aria-hidden="true" focusable="false"><g class="art">${pic()}</g></svg>`;
}

/** Letters that have a picture (all 26). */
export const PICTURED = Object.keys(PICS);

/** The hidden friend: a tiny mouse that peeks out from behind a block now and then. */
export function mouseSVG() {
  return `<svg viewBox="0 0 60 40" aria-hidden="true" focusable="false">
    <path d="M50 30 Q60 30 58 20" fill="none" stroke="#c9a7a0" stroke-width="3" stroke-linecap="round"/>
    <circle cx="16" cy="12" r="8" fill="#b9a9a2" ${S}/><circle cx="16" cy="12" r="4" fill="#f7b6c4"/>
    <ellipse cx="32" cy="28" rx="20" ry="12" fill="#c8b8b0" ${S}/>
    <circle cx="28" cy="12" r="7" fill="#b9a9a2" ${S}/><circle cx="28" cy="12" r="3.5" fill="#f7b6c4"/>
    <circle cx="20" cy="26" r="2.5" fill="${INK}"/><circle cx="12" cy="30" r="2.5" fill="#f58aa4"/>
  </svg>`;
}

/** A little hay puff: a few straws and a soft dust cloud, animated by CSS (.puff). */
export function puffSVG() {
  const straws = Array.from({ length: 7 }, (_, k) => {
    const a = -Math.PI + (k / 6) * Math.PI;
    const x = 40 + Math.cos(a) * 26, y = 44 + Math.sin(a) * 26;
    return `<path d="M40 44 L${x.toFixed(1)} ${y.toFixed(1)}" stroke="#e2b54a" stroke-width="4" stroke-linecap="round"/>`;
  }).join('');
  return `<svg viewBox="0 0 80 56" aria-hidden="true" focusable="false">
    <ellipse cx="40" cy="44" rx="30" ry="10" fill="#f3e2b0" opacity=".8"/>${straws}
  </svg>`;
}
