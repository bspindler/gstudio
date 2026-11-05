// Static checks for the hard rules that can be seen in a game's source.
// Returns one plain-English message per broken rule; [] means the game is clean.

const PURCHASE_LIKE = /\b(buy|shop|store|checkout)\b|priceUsd|PaymentRequest/i;

// Removes HTML comments and JS comments inside <script> blocks, leaving string literals alone
// (so 'https://...' and '../sdk/studio-sdk.js' survive). Used only by the purchase detector.
function stripComments(html: string): string {
  const jsComments = /("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script>)/gi, (_m, open: string, body: string, close: string) =>
      open + body.replace(jsComments, (m: string, str?: string) => str ?? ' ') + close,
    );
}

export function complianceViolations(html: string): string[] {
  const v: string[] = [];

  if (!/import\s*\{[^}]*createStudio[^}]*\}\s*from\s*['"][^'"]*studio-sdk\.js['"]/.test(html))
    v.push("The game must import createStudio from the studio SDK (studio-sdk.js); it is how events, purchases and feedback work.");

  if (PURCHASE_LIKE.test(stripComments(html)) && !html.includes('purchase.offer('))
    v.push('Purchases must go through purchase.offer( ... ). This game looks like it sells something (buy/shop/store/checkout, priceUsd or PaymentRequest) but never calls purchase.offer(.');
  if (/mockBuy|simulated purchase/i.test(html))
    v.push('Do not fake purchases yourself (mockBuy / "simulated purchase"); use purchase.offer( ... ) from the SDK.');

  if (/\$\d+\.\d{2}/.test(html))
    v.push('No hard-coded prices like $1.99 in the game; prices come from priceUsd.');

  if (/randomReward\s*:\s*true/.test(html))
    v.push('Nothing purchasable may contain a random reward (randomReward: true is not allowed).');

  if (/\bodds\.roll\(/.test(html) && !/\bodds\.format\(/.test(html))
    v.push('Random rewards must show their odds: if you use odds.roll( you must also show odds.format(.');
  if (/Math\.random\(\)\s*<\s*0\.\d+.*(rare|epic|common)/i.test(html))
    v.push('Roll random rewards with odds.roll( so the odds can be shown, not with a hand-written Math.random() check.');

  if (/RIVALS|DROP_CAP|claimed\s*:\s*Math|dropWindow/.test(html))
    v.push('No fake social proof, fake scarcity or resetting timers (RIVALS, DROP_CAP, dropWindow, made-up claimed counts).');

  if (/\shidden[\s>=]/.test(html) && !/\[hidden\][^{]*\{\s*display:\s*none\s*!important/.test(html))
    v.push('The game uses the hidden attribute, so add this CSS rule: [hidden]{display:none !important}');

  if (!/track\(\s*['"]level_start['"]/.test(html))
    v.push("The game must call track('level_start' ...) when a level starts.");
  if (!/track\(\s*['"]level_end['"]/.test(html))
    v.push("The game must call track('level_end' ...) when a level ends.");
  if (!html.includes('feedback.maybePrompt('))
    v.push('The game must call feedback.maybePrompt( ... ) to ask players for feedback.');

  return v;
}
