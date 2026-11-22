// For ppchrome.mjs. node ppchrome-prep.cjs <repo> <birefnet|bir640>: pick 20 photos (the 10 with the largest soft-zone boxes,
// then every 40th) and 18 MP copies of 4 of them; dump their final BiRefNet masks (after despeck + edge curve) as raw 1024x1024 bytes.
const fs = require("fs"), path = require("path");
const REPO = process.argv[2], WORK = path.join(process.env.HOME, "goodbye-bg-quality"), NAME = process.argv[3] || "birefnet";
const sharp = require(require.resolve("sharp", { paths: [path.join(WORK, "harness")] })), C = require(path.join(REPO, "scripts/quality/ppcands.cjs"));
const src = fs.readFileSync(path.join(REPO, "src/app.js"), "utf8");
const grab = (name) => { const i = src.indexOf(`function ${name}(`); let depth = 0; for (let k = src.indexOf("{", i); k < src.length; k++) { if (src[k] === "{") depth++; else if (src[k] === "}" && !--depth) return src.slice(i, k + 1); } };
const morph = new Function(`const RES = 1024; ${grab("morph")} return morph;`)();
const N = 1024 * 1024, out = path.join(path.join(process.env.HOME, "goodbye-bg-quality", "ppchrome"), NAME); fs.mkdirSync(out, { recursive: true });
(async () => {
  const man = Object.fromEntries(fs.readFileSync(path.join(WORK, "manifest.jsonl"), "utf8").trim().split("\n").map((l) => { const r = JSON.parse(l); return [r.id, r]; }));
  const files = fs.readdirSync(path.join(WORK, "raw", NAME)).filter((f) => f.endsWith(".png")).sort();
  const rows = [];
  for (const f of files) {
    const raw = await sharp(path.join(WORK, "raw", NAME, f)).extractChannel(0).raw().toBuffer(), base = C.lut(C.pre(raw, false));
    let soft = new Uint8Array(N); for (let i = 0; i < N; i++) soft[i] = base[i] > 0 && base[i] < 255 ? 1 : 0;
    soft = morph(morph(soft, 1, false), 1, true);
    let x0 = 1024, y0 = 1024, x1 = -1, y1 = -1;
    for (let i = 0; i < N; i++) if (soft[i]) { const x = i % 1024, y = (i / 1024) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    const cn = x1 < 0 ? 0 : (Math.min(1023, x1 + 12) - Math.max(0, x0 - 12) + 1) * (Math.min(1023, y1 + 12) - Math.max(0, y0 - 12) + 1);
    rows.push({ id: f.slice(0, -4), cn, base });
  }
  const sorted = [...rows].sort((a, b) => b.cn - a.cn);
  const pick = new Map();
  for (const r of sorted.slice(0, 10)) pick.set(r.id, "largest");
  for (let i = 0; pick.size < 20; i += 40) { const r = rows[i % rows.length]; if (!pick.has(r.id)) pick.set(r.id, "spread"); }
  const list = [];
  for (const r of rows) if (pick.has(r.id)) {
    fs.writeFileSync(path.join(out, r.id + ".mask"), r.base);
    const img = path.join(WORK, man[r.id].image), meta = await sharp(img).metadata();
    list.push({ id: r.id, why: pick.get(r.id), cn: r.cn, img, w: meta.width, h: meta.height });
  }
  const dist = rows.map((r) => r.cn).sort((a, b) => a - b), q = (p) => dist[Math.floor(p * (dist.length - 1))];
  console.log(`${NAME}: ${rows.length} masks; box px: none ${dist.filter((v) => !v).length}, median ${q(0.5)}, p90 ${q(0.9)}, max ${q(1)}`);
  fs.writeFileSync(path.join(out, "list.json"), JSON.stringify(list, null, 1));
  const big = []; // 18 MP copies: the page draws every photo to 1024 first, so these should cost the filter the same
  for (const r of list.filter((r) => r.why === "largest").slice(0, 4)) {
    const [W, H] = r.w >= r.h ? [5184, 3456] : [3456, 5184], p = path.join(out, r.id + "-18mp.jpg");
    await sharp(r.img).resize(W, H, { fit: "fill" }).jpeg({ quality: 90 }).toFile(p); big.push({ id: r.id, img: p });
  }
  fs.writeFileSync(path.join(out, "big.json"), JSON.stringify(big));
})();
