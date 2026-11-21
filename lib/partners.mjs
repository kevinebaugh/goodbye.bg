// Affiliate partners for the ad card (src/app.js) and the /go/<id> redirect (functions/go/[id].js).
// A partner shows only once `url` holds Kevin's affiliate link. Copy must stay true (see CLAUDE.md).
// Swap or add partners here; nothing else changes.
export const PARTNERS = [
  { id: "canva", name: "Canva", emoji: "🎨", line: "Put your cut-out in a design.", cta: "Try Canva", home: "https://www.canva.com/", url: "" },
  { id: "printful", name: "Printful", emoji: "👕", line: "Put it on a shirt or mug and sell it.", cta: "Try Printful", home: "https://www.printful.com/", url: "" },
  { id: "zazzle", name: "Zazzle", emoji: "☕", line: "Turn it into a mug, card or sticker.", cta: "Try Zazzle", home: "https://www.zazzle.com/", url: "" },
];
