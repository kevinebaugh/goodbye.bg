// Affiliate partners for the ad card (src/app.js) and the /go/<id> redirect (functions/go/[id].js).
// A partner shows only once `url` holds Kevin's affiliate link. Copy must stay true (see CLAUDE.md).
// A/B tests: `variants` lists other versions of the card (v, line, cta and its own `url`). Each visit shows
// one variant at random, including "a" (the partner's own line/cta/url); shows and clicks are counted per
// variant (blob5 'adseen'/'adclick'). A variant shows only once its url is filled in. Test one thing at a time.
// Product test (Kevin 2026-11-20): Zazzle's variants draw the visitor's own cut-out on a different product each
// (`product`: mug, sticker, shirt, tote; drawn in src/app.js). The button names the product ("Make a mug"); the "Make it"/"Make yours" test ended 2026-11-21 (blob7). `ctas` can
// still list wordings to test.
// Swap or add partners here; nothing else changes. Canva is out: its affiliate program only takes
// Canvassadors (tutorial creators), and that program was closed to applications on 2026-11-20.
export const PARTNERS = [
  { id: "printful", name: "Printful", emoji: "👕", line: "Put it on a shirt or mug and sell it.", cta: "Try Printful", home: "https://www.printful.com/", url: "" },
  { id: "printify", name: "Printify", emoji: "🧢", line: "Print it on a hat, bag or sticker.", cta: "Try Printify", home: "https://printify.com/", url: "" },
  // Zazzle A (v "mug", Kevin 2026-11-20): the visitor's own cut-out drawn on a mug, on the device. The old A
  // (v "a": "Turn it into a mug, card or sticker." to the home page) is retired; its counts stay under "a".
  { id: "zazzle", name: "Zazzle", emoji: "☕", v: "mug", product: "mug", line: "Your cut-out on a mug.", cta: "Make a mug",
    home: "https://www.zazzle.com/", url: "https://www.zazzle.com/custom?rf=238003133086051540", // Ambassador ID: 15% of the sale
    variants: [
      // B: does landing on "create your own" (with matching copy) beat the home page? Started 2026-11-20.
      // "b" (emoji + "Put your cut-out on anything.") retired 2026-11-21: next to drawn products it looked out of
      // place (Kevin). Its counts stay under "b".
      { v: "sticker", product: "sticker", line: "Your cut-out as a sticker.", cta: "Make a sticker", url: "https://www.zazzle.com/custom?rf=238003133086051540" },
      { v: "shirt", product: "shirt", line: "Your cut-out on a t-shirt.", cta: "Make a shirt", url: "https://www.zazzle.com/custom?rf=238003133086051540" },
      // Zazzle best sellers (2026-11-21): photo ornaments, phone cases, throw pillows, keychains.
      { v: "ornament", product: "ornament", line: "Your cut-out on an ornament.", cta: "Make an ornament", url: "https://www.zazzle.com/custom?rf=238003133086051540" },
      { v: "phonecase", product: "phonecase", line: "Your cut-out on a phone case.", cta: "Make a case", url: "https://www.zazzle.com/custom?rf=238003133086051540" },
      { v: "pillow", product: "pillow", line: "Your cut-out on a pillow.", cta: "Make a pillow", url: "https://www.zazzle.com/custom?rf=238003133086051540" },
      { v: "keychain", product: "keychain", line: "Your cut-out as a keychain.", cta: "Make a keychain", url: "https://www.zazzle.com/custom?rf=238003133086051540" },
      { v: "tote", product: "tote", line: "Your cut-out on a tote bag.", cta: "Make a tote", url: "https://www.zazzle.com/custom?rf=238003133086051540" },
    ] },
];

// Prototype (?zazzlecap=1, docs/zazzle-cap.md): Zazzle's Create-a-Product (CAP) link opens a template product
// with the visitor's cut-out swapped into its image slot. Each template is a product Kevin makes in his own
// Zazzle store (made "templatable", image object named IMAGE_SLOT); `pd` is its product ID. Until a product's
// pd is filled in, its card goes to the usual link.
export const ZAZZLE_CAP = {
  // Store "goodbyebg" (made 2026-11-21). Zazzle's own link builder (zazzle.com/my/ambassador/create) makes
  // /api/create/at-<member>?pd=…&ed=true&ax=Linkover&t_image1_iid=… with no rf=, which matches the Ambassador rule
  // that self-promotion links carry no rf=. The member ID is the same number as the Ambassador ID.
  member: "238003133086051540",
  slot: "image1", // the template object's name in the design tool: the link sets t_<slot>_iid to the image URL
  // Templates in store goodbyebg, all Direct-only (not listed or searchable; reachable by link), 5% royalty
  // (Zazzle's minimum), image slot "image1", Fit. Product types: classic 11 oz mug, 4x4 custom-cut vinyl sticker,
  // white Hanes men's crew tee (front), natural budget tote (front), round porcelain ornament (front), iPhone 17 slim
  // case, 16x16 throw pillow (front), square single-sided acrylic keychain.
  pd: {
    mug: "256109521733566200", sticker: "256879772313558885", shirt: "256111263575769583", tote: "256390505328741347",
    ornament: "256350244847406024", phonecase: "256140659304551868", pillow: "256722353463187898", keychain: "256661193721206477",
  },
};
export function capLink(p, product, imageUrl, cap = ZAZZLE_CAP) {
  const pd = p.id === "zazzle" && cap.pd[product];
  if (!pd || !cap.member) return null;
  const q = new URLSearchParams({ pd, ed: "true", ax: "Linkover", tc: "goodbye_bg", [`t_${cap.slot}_iid`]: imageUrl });
  return `https://www.zazzle.com/api/create/at-${cap.member}?${q}`;
}
