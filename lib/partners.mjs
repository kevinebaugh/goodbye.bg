// Affiliate partners for the ad card (src/app.js) and the /go/<id> redirect (functions/go/[id].js).
// A partner shows only once `url` holds Kevin's affiliate link. Copy must stay true (see CLAUDE.md).
// A/B tests: `variants` lists other versions of the card (v, line, cta and its own `url`). Each visit shows
// one variant at random, including "a" (the partner's own line/cta/url); shows and clicks are counted per
// variant (blob5 'adseen'/'adclick'). A variant shows only once its url is filled in. Test one thing at a time.
// Product test (Kevin 2026-11-20): Zazzle's variants draw the visitor's own cut-out on a different product each
// (`product`: mug, sticker, shirt, tote; drawn in src/app.js). `ctas` is a button-wording test (blob7), kept short (Kevin: "like Make it").
// Swap or add partners here; nothing else changes. Canva is out: its affiliate program only takes
// Canvassadors (tutorial creators), and that program was closed to applications on 2026-11-20.
export const PARTNERS = [
  { id: "printful", name: "Printful", emoji: "👕", line: "Put it on a shirt or mug and sell it.", cta: "Try Printful", home: "https://www.printful.com/", url: "" },
  { id: "printify", name: "Printify", emoji: "🧢", line: "Print it on a hat, bag or sticker.", cta: "Try Printify", home: "https://printify.com/", url: "" },
  // Zazzle A (v "mug", Kevin 2026-11-20): the visitor's own cut-out drawn on a mug, on the device. The old A
  // (v "a": "Turn it into a mug, card or sticker." to the home page) is retired; its counts stay under "a".
  { id: "zazzle", name: "Zazzle", emoji: "☕", v: "mug", product: "mug", line: "Your cut-out on a mug.", cta: "Make it", ctas: ["Make it", "Make yours"],
    home: "https://www.zazzle.com/", url: "https://www.zazzle.com/custom?rf=238003133086051540", // Ambassador ID: 15% of the sale
    variants: [
      // B: does landing on "create your own" (with matching copy) beat the home page? Started 2026-11-20.
      { v: "b", line: "Put your cut-out on anything.", cta: "Make it", url: "https://www.zazzle.com/custom?rf=238003133086051540" },
      { v: "sticker", product: "sticker", line: "Your cut-out as a sticker.", cta: "Make it", ctas: ["Make it", "Make yours"], url: "https://www.zazzle.com/custom?rf=238003133086051540" },
      { v: "shirt", product: "shirt", line: "Your cut-out on a t-shirt.", cta: "Make it", ctas: ["Make it", "Make yours"], url: "https://www.zazzle.com/custom?rf=238003133086051540" },
      { v: "tote", product: "tote", line: "Your cut-out on a tote bag.", cta: "Make it", ctas: ["Make it", "Make yours"], url: "https://www.zazzle.com/custom?rf=238003133086051540" },
    ] },
];
