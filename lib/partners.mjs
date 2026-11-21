// Affiliate partners for the ad card (src/app.js) and the /go/<id> redirect (functions/go/[id].js).
// A partner shows only once `url` holds Kevin's affiliate link. Copy must stay true (see CLAUDE.md).
// Swap or add partners here; nothing else changes. Canva is out: its affiliate program only takes
// Canvassadors (tutorial creators), and that program was closed to applications on 2026-11-20.
export const PARTNERS = [
  { id: "printful", name: "Printful", emoji: "👕", line: "Put it on a shirt or mug and sell it.", cta: "Try Printful", home: "https://www.printful.com/", url: "" },
  { id: "printify", name: "Printify", emoji: "🧢", line: "Print it on a hat, bag or sticker.", cta: "Try Printify", home: "https://printify.com/", url: "" },
  { id: "zazzle", name: "Zazzle", emoji: "☕", line: "Turn it into a mug, card or sticker.", cta: "Try Zazzle", home: "https://www.zazzle.com/", url: "https://www.zazzle.com/?rf=238003133086051540" }, // Ambassador ID: 15% of the sale
];
