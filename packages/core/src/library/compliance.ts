// Static checks for the hard rules that can be seen in a game's source.
// Returns one plain-English message per broken rule; [] means the game is clean.

const PURCHASE_LIKE = /\b(buy|shop|store|checkout)\b|priceUsd|PaymentRequest/i;

const NETWORK = /\bfetch\s*\(|\bsendBeacon\b|\bXMLHttpRequest\b|\bnew\s+WebSocket\b|\bEventSource\b|<script\b[^>]*\ssrc\s*=\s*["']?(?:https?:)?\/\//i;
const EXTERNAL_PAYMENT = /stripe|paypal|braintree|\bPaymentRequest\b/i;

// Removes HTML comments, then JS and CSS comments, leaving string literals alone (so 'https://...'
// and '../sdk/studio-sdk.js' survive). The JS pass runs over the whole text, not only <script>
// blocks, because a game's sources include plain .js files.
function stripComments(html: string): string {
  const jsComments = /("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(jsComments, (m: string, str?: string) => str ?? ' ');
}

export function complianceViolations(html: string, o: { childDirected?: boolean } = {}): string[] {
  const kid = o.childDirected === true;
  const v: string[] = [];
  const code = stripComments(html);

  if (!/import\s*\{[^}]*createStudio[^}]*\}\s*from\s*['"][^'"]*studio-sdk\.js['"]/.test(html))
    v.push("The game must import createStudio from the studio SDK (studio-sdk.js); it is how events, purchases and feedback work.");
  if (kid) {
    if (!/endpoint\s*:\s*(['"])\1/.test(code))
      v.push("This game is child-directed, so it must call createStudio with endpoint: '' (the SDK then sends nothing).");
    if (code.includes('resolveEndpoint('))
      v.push('This game is child-directed, so it must not use resolveEndpoint( ; events are never sent.');
    if (/\btrack\s*\(/.test(code))
      v.push('This game is child-directed, so it must not call track( ; no events are sent.');
    if (code.includes('purchase.offer('))
      v.push('This game is child-directed, so it must not call purchase.offer( ; there are no purchases.');
    if (code.includes('feedback.maybePrompt('))
      v.push('This game is child-directed, so it must not call feedback.maybePrompt( ; there are no prompts.');
  } else if (!code.includes('resolveEndpoint('))
    v.push('Pass endpoint: resolveEndpoint(location, window.STUDIO_CONFIG) to createStudio. It picks where events go, and it makes sure test builds send nothing.');

  if (NETWORK.test(code))
    v.push('The game must not use the network itself (fetch(, sendBeacon, XMLHttpRequest, WebSocket, EventSource, or a <script src="https://..."> from another site). The SDK is the only thing that sends data, and only when it is allowed to.');
  if (EXTERNAL_PAYMENT.test(code))
    v.push('No outside payments (Stripe, PayPal, Braintree or PaymentRequest). Real money only goes through the official store billing; in the game, use purchase.offer( ... ) from the SDK.');

  if (PURCHASE_LIKE.test(code) && !code.includes('purchase.offer('))
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

  if (kid) return v;

  if (!/track\(\s*['"]level_start['"]/.test(html))
    v.push("The game must call track('level_start' ...) when a level starts.");
  if (!/track\(\s*['"]level_end['"]/.test(html))
    v.push("The game must call track('level_end' ...) when a level ends.");
  if (!html.includes('feedback.maybePrompt('))
    v.push('The game must call feedback.maybePrompt( ... ) to ask players for feedback.');

  return v;
}
