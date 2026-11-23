// Tells search engines about new or changed pages right away (IndexNow: Bing, which ChatGPT search and Copilot draw
// on, plus Yandex, Naver, Seznam; one call reaches them all). Run after a deploy that changed text pages:
//   node scripts/indexnow.mjs            pages whose <lastmod> in the live sitemap is today (UTC)
//   node scripts/indexnow.mjs --all      every page in the sitemap
// The key file is src/<KEY>.txt, served at the site's root; it only proves the site asked, it is no secret.
import { readdirSync } from "node:fs";

const SITE = process.env.SITE || "https://goodbye.bg";
const KEY = readdirSync(new URL("../src/", import.meta.url)).find((f) => /^[0-9a-f]{32}\.txt$/.test(f))?.slice(0, -4);
if (!KEY) throw new Error("No IndexNow key file (src/<32 hex>.txt)");

const xml = await (await fetch(`${SITE}/sitemap.xml`)).text();
const today = new Date().toISOString().slice(0, 10);
const all = process.argv.includes("--all");
const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>(?:<lastmod>([^<]+)<\/lastmod>)?/g)].filter((m) => all || m[2] === today).map((m) => m[1]);
if (!urls.length) { console.log(`No page in the sitemap changed today (${today}). Use --all to send every page.`); process.exit(0); }

const r = await fetch("https://api.indexnow.org/indexnow", {
  method: "POST",
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify({ host: new URL(SITE).host, key: KEY, keyLocation: `${SITE}/${KEY}.txt`, urlList: urls }),
});
console.log(`IndexNow: ${r.status} ${r.statusText} for ${urls.length} page(s)`);
if (r.status >= 400) { console.log(await r.text()); process.exit(1); }
