// Checks a running `goodbye-bg serve` against remove.bg's documented behaviour.
//   node test/serve-test.mjs <photo.jpg> [base URL, default http://localhost:5000/v1.0]
// Needs a photo with a clear subject. Start the server with --allow-urls to include the image_url checks
// (they fetch the photo back from a tiny server this script runs on 127.0.0.1).
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const sharp = require("sharp");
const { unzipSync } = require("fflate");

const photo = process.argv[2];
const BASE = (process.argv[3] || "http://localhost:5000/v1.0").replace(/\/$/, "");
if (!photo) { console.error("usage: node test/serve-test.mjs <photo.jpg> [base URL]"); process.exit(2); }
const jpg = fs.readFileSync(photo);
const meta = await sharp(jpg).metadata();
const blank = await sharp({ create: { width: 800, height: 600, channels: 3, background: "#808080" } }).jpeg().toBuffer();

let failed = 0, passed = 0;
const check = (name, ok, info = "") => { ok ? passed++ : failed++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${info ? `  (${info})` : ""}`); };

async function post(fields, { headers = {}, as = "multipart" } = {}) {
  let body;
  if (as === "multipart") {
    body = new FormData();
    for (const [k, v] of Object.entries(fields)) Buffer.isBuffer(v) ? body.append(k, new Blob([v], { type: "image/jpeg" }), "photo.jpg") : body.append(k, String(v));
  } else if (as === "json") { body = JSON.stringify(fields); headers["content-type"] = "application/json"; }
  else { body = new URLSearchParams(fields).toString(); headers["content-type"] = "application/x-www-form-urlencoded"; }
  const res = await fetch(`${BASE}/removebg`, { method: "POST", body, headers: { "X-Api-Key": "anything", ...headers } });
  const buf = Buffer.from(await res.arrayBuffer());
  let json = null; try { json = JSON.parse(buf.toString()); } catch {}
  return { status: res.status, h: res.headers, buf, json, code: json?.errors?.[0]?.code };
}
const dims = async (buf) => { const m = await sharp(buf).metadata(); return { w: m.width, h: m.height, ch: m.channels, fmt: m.format }; };

// The documented default is size=preview: 0.25 megapixels.
let r = await post({ image_file: jpg });
let d = await dims(r.buf);
check("default size=preview is at most 0.25 MP", r.status === 200 && d.w * d.h <= 250000 && d.w * d.h > 240000, `${d.w}x${d.h}`);
check("X-Width/X-Height match the image", +r.h.get("x-width") === d.w && +r.h.get("x-height") === d.h);
check("X-Credits-Charged is 0", r.h.get("x-credits-charged") === "0");
check("X-Foreground-* present", ["top", "left", "width", "height"].every((k) => r.h.get(`x-foreground-${k}`) !== null));
check("format=auto gives PNG for a cut-out", r.h.get("content-type") === "image/png" && d.fmt === "png" && d.ch === 4);

r = await post({ image_file: jpg, size: "full" }); d = await dims(r.buf);
check("size=full keeps the photo's size (under 10 MP)", d.w === meta.width && d.h === meta.height, `${d.w}x${d.h}`);
r = await post({ image_file: jpg, size: "auto", format: "jpg" }); d = await dims(r.buf);
check("format=jpg", r.h.get("content-type") === "image/jpeg" && d.fmt === "jpeg");
r = await post({ image_file: jpg, size: "auto", format: "webp" }); d = await dims(r.buf);
check("format=webp keeps alpha", d.fmt === "webp" && d.ch === 4);
r = await post({ image_file: jpg, size: "auto", format: "zip" });
const z = r.status === 200 && unzipSync(new Uint8Array(r.buf));
check("format=zip holds color.jpg and alpha.png", z && z["color.jpg"] && z["alpha.png"], z ? Object.keys(z).join(", ") : r.status);
r = await post({ image_file: jpg, size: "auto", bg_color: "81d4fa" }); d = await dims(r.buf);
check("bg_color hex: format=auto gives JPG", r.h.get("content-type") === "image/jpeg");
r = await post({ image_file: jpg, size: "preview", bg_color: "green" });
check("bg_color name", r.status === 200 && r.h.get("content-type") === "image/jpeg");
r = await post({ image_file: jpg, size: "preview", bg_color: "81d4fa77" }); d = await dims(r.buf);
check("bg_color with alpha stays see-through (PNG)", r.h.get("content-type") === "image/png" && d.ch === 4);
r = await post({ image_file: jpg, size: "preview", channels: "alpha" }); d = await dims(r.buf);
check("channels=alpha gives a one-channel matte", r.status === 200 && d.ch === 1, `${d.ch} channel(s)`);
r = await post({ image_file: jpg, size: "auto", crop: "true" }); d = await dims(r.buf);
const fw = +r.h.get("x-foreground-width"), fh = +r.h.get("x-foreground-height");
check("crop=true is tight to the subject", d.w === fw && d.h === fh, `${d.w}x${d.h}, foreground ${fw}x${fh}`);
r = await post({ image_file: jpg, size: "auto", crop: "true", crop_margin: "30px" }); d = await dims(r.buf);
check("crop_margin=30px adds 30 px a side", d.w === fw + 60 && d.h === fh + 60, `${d.w}x${d.h}`);
r = await post({ image_file: jpg, size: "auto", crop: "true", crop_margin: "10% 0" }); d = await dims(r.buf);
check("crop_margin two values (10% top/bottom, 0 left/right)", d.w === fw && d.h === fh + 2 * Math.round(fh * 0.1), `${d.w}x${d.h}`);
r = await post({ image_file: jpg, size: "auto", scale: "50%" }); d = await dims(r.buf);
const sw = +r.h.get("x-foreground-width"), sh = +r.h.get("x-foreground-height");
check("scale=50%: subject half the canvas, canvas the photo's size, centred", d.w === meta.width && Math.max(sw / d.w, sh / d.h) > 0.49 && Math.max(sw / d.w, sh / d.h) < 0.51, `fg ${sw}x${sh} at ${r.h.get("x-foreground-left")},${r.h.get("x-foreground-top")}`);
r = await post({ image_file: jpg, size: "auto", scale: "50%", position: "0% 100%" });
check("position=0% 100% puts it bottom left", +r.h.get("x-foreground-left") === 0 && +r.h.get("x-foreground-top") + +r.h.get("x-foreground-height") === meta.height);
r = await post({ image_file: jpg, size: "auto", roi: "0% 0% 50% 100%" });
check("roi: nothing right of it", r.status === 200 && +r.h.get("x-foreground-left") + +r.h.get("x-foreground-width") <= Math.ceil(meta.width / 2) + 2, `fg right edge ${+r.h.get("x-foreground-left") + +r.h.get("x-foreground-width")}`);
r = await post({ image_file_b64: jpg.toString("base64"), size: "preview" }, { as: "json" });
check("JSON body with image_file_b64", r.status === 200 && r.h.get("content-type") === "image/png");
r = await post({ image_file_b64: jpg.toString("base64"), size: "preview" }, { as: "urlencoded" });
check("urlencoded body with image_file_b64", r.status === 200);
r = await post({ image_file: jpg, size: "preview" }, { headers: { accept: "application/json" } });
check("Accept: application/json gives result_b64 and foreground_*", r.json?.data?.result_b64 && Number.isInteger(r.json.data.foreground_width));
r = await post({ image_file: jpg, size: "preview", type: "person", type_level: "2", semitransparency: "false", add_shadow: "false", shadow_type: "none", shadow_opacity: "auto" });
check("no-op values are accepted", r.status === 200, r.code);

// Shadows: the site's soft ground shadow under the subject. The photo gets a white band below it, so its subject is
// never cut by the bottom edge (no shadow goes under a cut subject, checked at the end).
{
  const sjpg = await sharp(jpg).rotate().extend({ bottom: Math.round(meta.height * 0.25), background: "#ffffff" }).jpeg({ quality: 95 }).toBuffer();
  const crop = { image_file: sjpg, size: "auto", crop: "true" };
  const plain = await post(crop), pd = await dims(plain.buf);
  const fgB = (x) => ({ l: +x.h.get("x-foreground-left"), t: +x.h.get("x-foreground-top"), w: +x.h.get("x-foreground-width"), h: +x.h.get("x-foreground-height") });
  const px = async (buf, x, y) => { const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); const j = (y * info.width + x) * 4; return Array.from(data.subarray(j, j + 4)); };
  r = await post({ ...crop, shadow_type: "drop" }); d = await dims(r.buf);
  const f = fgB(r), below = r.status === 200 ? await px(r.buf, Math.round(f.l + f.w / 2), f.t + f.h + 1) : [];
  check("shadow_type=drop with crop: same width, taller, PNG", r.status === 200 && r.h.get("content-type") === "image/png" && d.w === pd.w && d.h > pd.h, `${r.status} ${r.code || ""} ${pd.w}x${pd.h} -> ${d.w}x${d.h}`);
  check("X-Foreground-* is still the subject", f.w === fgB(plain).w && f.h === fgB(plain).h);
  check("below the subject: soft black", below[0] < 20 && below[3] > 10 && below[3] < 255, below.join());
  r = await post({ ...crop, shadow_type: "drop", shadow_opacity: "100" });
  const dark = r.status === 200 ? await px(r.buf, Math.round(f.l + f.w / 2), f.t + f.h + 1) : [];
  check("shadow_opacity=100 is darker than 50", dark[3] > below[3] * 1.5, `${dark[3]} vs ${below[3]}`);
  r = await post({ ...crop, shadow_type: "drop", shadow_opacity: "0" });
  check("shadow_opacity=0: no shadow, same size as none", r.status === 200 && (await dims(r.buf)).h === pd.h);
  r = await post({ ...crop, shadow_type: "none" });
  check("shadow_type=none: the same bytes as no shadow", r.status === 200 && Buffer.compare(r.buf, plain.buf) === 0);
  r = await post({ ...crop, add_shadow: "true" });
  check("add_shadow without type=car: no shadow (a car shadow is for cars)", r.status === 200 && Buffer.compare(r.buf, plain.buf) === 0);
  r = await post({ ...crop, add_shadow: "true", type: "car" });
  check("add_shadow with type=car: a shadow", r.status === 200 && (await dims(r.buf)).h > pd.h);
  r = await post({ ...crop, "shadow_type[product]": "drop", type: "product" });
  check("shadow_type[product]=drop with type=product: a shadow", r.status === 200 && (await dims(r.buf)).h > pd.h, `${r.status} ${r.code || ""}`);
  r = await post({ ...crop, "shadow_type[product]": "drop" });
  check("shadow_type[product]=drop without a type: none (other is unmentioned)", r.status === 200 && Buffer.compare(r.buf, plain.buf) === 0);
  r = await post({ ...crop, shadow_type: "drop", bg_color: "ffffff" });
  const g = r.status === 200 ? await px(r.buf, Math.round(f.l + f.w / 2), f.t + f.h + 1) : [], corner = r.status === 200 ? await px(r.buf, 0, 0) : [];
  check("bg_color with a shadow: JPG, grey below the subject, white elsewhere", r.h.get("content-type") === "image/jpeg" && g[0] < 245 && g[0] > 100 && corner[0] > 250, `${g.join()} / ${corner.join()}`);
  r = await post({ image_file: sjpg, size: "auto", shadow_type: "drop" }); d = await dims(r.buf);
  const sm = await sharp(sjpg).metadata();
  check("shadow without crop: the photo's own size", r.status === 200 && d.w === sm.width && d.h === sm.height, `${d.w}x${d.h}`);
  // The same subject cut by the bottom edge (the photo cropped through it): no shadow, the same bytes as without one.
  const fs0 = fgB(r), cutH = Math.round(fs0.t + fs0.h * 0.6); // r: no crop, so the box is in the photo's pixels
  const cjpg = await sharp(sjpg).extract({ left: 0, top: 0, width: sm.width, height: cutH }).jpeg({ quality: 95 }).toBuffer();
  const a = await post({ image_file: cjpg, size: "auto", crop: "true" }), b = await post({ image_file: cjpg, size: "auto", crop: "true", shadow_type: "drop" });
  if (a.code === "unknown_foreground") console.log(`skip no shadow under a subject cut by the bottom edge  (nothing found in this photo cut at ${cutH} px)`);
  else check("no shadow under a subject cut by the bottom edge", a.status === 200 && b.status === 200 && Buffer.compare(a.buf, b.buf) === 0, `${a.status} ${b.status} ${a.code || ""} cut at ${cutH} of ${sm.height}`);
}

// Errors: status 400 and remove.bg's codes.
const errs = [
  ["missing_source", {}],
  ["multiple_sources", { image_file: jpg, image_url: "https://example.com/a.jpg" }],
  ["invalid_image_url", { image_url: "not a url" }],
  ["invalid_size", { image_file: jpg, size: "huge" }],
  ["invalid_format", { image_file: jpg, format: "gif" }],
  ["invalid_channels", { image_file: jpg, channels: "rgb" }],
  ["invalid_roi", { image_file: jpg, roi: "0 0 10" }],
  ["roi_exceeds_bounds", { image_file: jpg, roi: "0% 0% 120% 100%" }],
  ["roi_region_empty", { image_file: jpg, roi: "50% 0% 50% 100%" }],
  ["invalid_crop_margin", { image_file: jpg, crop: "true", crop_margin: "1 2 3" }],
  ["invalid_scale", { image_file: jpg, scale: "5%" }],
  ["invalid_position", { image_file: jpg, position: "left" }],
  ["invalid_bg_color", { image_file: jpg, bg_color: "notacolour" }],
  ["multiple_bg_sources", { image_file: jpg, bg_color: "fff", bg_image_url: "https://example.com/b.jpg" }],
  ["invalid_semitransparency", { image_file: jpg, semitransparency: "maybe" }],
  ["multiple_shadow_params", { image_file: jpg, add_shadow: "true", shadow_type: "drop" }],
  ["invalid_shadow_opacity", { image_file: jpg, shadow_opacity: "300" }],
  ["invalid_shadow_type", { image_file: jpg, shadow_type: "long" }],
  ["invalid_file_type", { image_file: Buffer.from("this is not an image at all") }],
  ["unknown_foreground", { image_file: blank }],
];
for (const [code, fields] of errs) {
  r = await post(fields);
  check(`error ${code}`, r.status === 400 && r.code === code && typeof r.json.errors[0].title === "string", `${r.status} ${r.code || ""}`);
}
r = await post({ image_file: Buffer.alloc(23 * 1024 * 1024, 1) });
check("error file_too_large", r.status === 400 && r.code === "file_too_large", `${r.status} ${r.code}`);
const huge = await sharp({ create: { width: 8000, height: 6400, channels: 3, background: "#808080" } }).jpeg().toBuffer(); // 51.2 MP
r = await post({ image_file: huge });
check("error resolution_too_high", r.status === 400 && r.code === "resolution_too_high", `${r.status} ${r.code}`);

// A background image: cover-resized under the cut-out, so the result is opaque (JPG with format=auto).
const bgJpg = await sharp({ create: { width: 500, height: 900, channels: 3, background: "#2a9d8f" } }).jpeg().toBuffer();
r = await post({ image_file: jpg, size: "auto", bg_image_file: bgJpg }); d = await dims(r.buf);
check("bg_image_file: opaque JPG at the photo's size", r.status === 200 && r.h.get("content-type") === "image/jpeg" && d.w === meta.width && d.h === meta.height, `${r.status} ${r.code || ""} ${d.w}x${d.h}`);

// HEIC (macOS: made with sips).
if (process.platform === "darwin") {
  const os = await import("node:os"), { execFileSync } = await import("node:child_process");
  const heic = path.join(os.tmpdir(), `serve-test-${process.pid}.heic`);
  try {
    execFileSync("sips", ["-s", "format", "heic", photo, "--out", heic], { stdio: "ignore" });
    r = await post({ image_file: fs.readFileSync(heic), size: "auto" }); d = await dims(r.buf);
    check("HEIC input", r.status === 200 && d.w === meta.width && d.h === meta.height, `${r.status} ${r.code || ""} ${d.w}x${d.h}`);
  } finally { fs.rmSync(heic, { force: true }); }
}

// image_url and bg_image_url: off unless --allow-urls; with it, pictures come from a little server here.
const pics = http.createServer((q, s) => {
  const body = q.url === "/photo.jpg" ? jpg : q.url === "/bg.jpg" ? bgJpg : null;
  if (!body) { s.writeHead(404); return s.end(); }
  s.writeHead(200, { "content-type": "image/jpeg" }); s.end(body);
});
await new Promise((res) => pics.listen(0, "127.0.0.1", res));
const at = (p) => `http://127.0.0.1:${pics.address().port}${p}`;
r = await post({ image_url: at("/photo.jpg"), size: "preview" });
if (r.code === "url_fetch_disabled") {
  check("image_url is off by default", true);
  r = await post({ image_file: jpg, bg_image_url: at("/bg.jpg") });
  check("bg_image_url is off by default", r.code === "url_fetch_disabled");
} else {
  check("image_url fetches with --allow-urls", r.status === 200 && r.h.get("content-type") === "image/png", `${r.status} ${r.code || ""}`);
  r = await post({ image_file: jpg, size: "preview", bg_image_url: at("/bg.jpg") });
  check("bg_image_url fetches with --allow-urls", r.status === 200 && r.h.get("content-type") === "image/jpeg", `${r.status} ${r.code || ""}`);
  r = await post({ image_url: at("/missing.jpg") });
  check("error failed_image_download", r.status === 400 && r.code === "failed_image_download", `${r.status} ${r.code}`);
  r = await post({ image_file: jpg, bg_image_url: at("/missing.jpg") });
  check("error failed_bg_download", r.status === 400 && r.code === "failed_bg_download", `${r.status} ${r.code}`);
}
pics.close();

const acc = await fetch(`${BASE}/account`, { headers: { "X-Api-Key": "x" } }).then((x) => x.json());
check("GET /account has the documented shape", typeof acc?.data?.attributes?.credits?.total === "number" && typeof acc.data.attributes.api.free_calls === "number");
const web = await fetch(`${BASE}/account`, { headers: { origin: "https://evil.example" } });
check("requests from web pages are refused", web.status === 403);

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
