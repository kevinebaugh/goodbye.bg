// The ground shadow (lib/shadow.cjs) and serve's shadow parameters (lib/api.cjs parseShadow), without the model.
//   node test/shadow-test.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const S = require("../lib/shadow.cjs");
const { parseShadow } = require("../lib/api.cjs");

let failed = 0, passed = 0;
const check = (name, ok, info = "") => { ok ? passed++ : failed++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${info ? `  (${info})` : ""}`); };
const near = (a, b, e = 1e-9) => Math.abs(a - b) < e;

// The site's gradient stops (src/app.js underlay): 0.34 at the centre, 0.16 halfway, 0 at the rim.
check("alpha 0.34 at the centre", near(S.alphaAt(0), 0.34));
check("alpha 0.16 halfway out", near(S.alphaAt(0.5), 0.16));
check("alpha 0.25 a quarter out (linear between stops)", near(S.alphaAt(0.25), 0.25));
check("alpha 0 at and past the rim", S.alphaAt(1) === 0 && S.alphaAt(1.5) === 0);
check("opacity 0 is no shadow", S.alphaAt(0, 0) === 0);
check("opacity 100 is twice the site's look", near(S.alphaAt(0, 100), 0.68));
check("never past 1", S.alphaAt(0, 1000) === 1);

// Geometry: 90% of the subject's width, 12% as tall as wide, centre a third of its height above the bottom.
const e = S.ellipse({ left: 100, top: 50, width: 200, height: 300 });
check("ellipse size and place", near(e.rx, 90) && near(e.ry, 10.8) && near(e.cx, 200) && near(e.cy, 350 - 3.78) && near(e.bottom, e.cy + 11.88), JSON.stringify(e));
check("a thin subject still gets 3 px of height", S.ellipse({ left: 0, top: 0, width: 10, height: 10 }).ry === 3);
check("no shadow under a subject cut by the bottom edge", S.cutAtBottom({ x0: 0.1, y0: 0.1, x1: 0.9, y1: 1 }) && !S.cutAtBottom({ x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.95 }));

// Drawing: black under an empty canvas; nothing changes under an opaque pixel.
const W = 40, H = 20, buf = new Uint8Array(W * H * 4);
const opaque = (10 * W + 20) * 4; buf.set([200, 100, 50, 255], opaque);
S.drawUnder(buf, W, H, { cx: 20, cy: 10, rx: 15, ry: 5 }, 50);
const at = (x, y) => Array.from(buf.subarray((y * W + x) * 4, (y * W + x) * 4 + 4));
check("opaque pixels keep their colour", at(20, 10).join() === "200,100,50,255");
// Pixel (21, 10) has its middle at d = sqrt(0.1² + 0.1²) = 0.141: 0.34 - 0.141 * 0.36 = 0.289.
check("near the centre: black, 0.289", at(21, 10)[0] === 0 && Math.abs(at(21, 10)[3] - 0.289 * 255) <= 1, at(21, 10).join());
check("fades outwards", at(21, 10)[3] > at(28, 10)[3] && at(28, 10)[3] > at(34, 10)[3], `${at(21, 10)[3]} ${at(28, 10)[3]} ${at(34, 10)[3]}`);
check("nothing outside the ellipse", at(2, 10)[3] === 0 && at(20, 0)[3] === 0);
const half = new Uint8Array(4); half.set([255, 255, 255, 128]);
S.drawUnder(half, 1, 1, { cx: 0.5, cy: 0.5, rx: 10, ry: 10 }, 50);
check("under a half-transparent pixel: darker, more opaque", half[3] > 128 && half[0] < 255, Array.from(half).join());

// fillUnder: a colour under the shadow, as the canvas does.
const f = new Uint8Array([0, 0, 0, 87, 0, 0, 0, 0]);
S.fillUnder(f, [255, 255, 255, 255]);
check("white under a 0.34 black shadow is grey, opaque", f[3] === 255 && Math.abs(f[0] - 255 * (1 - 87 / 255)) <= 1 && f[4] === 255 && f[7] === 255, Array.from(f).join());

// Parameters: the foreground type is the request's type, or "other".
const p = (fields, t = "") => { try { return parseShadow(fields, t); } catch (e) { return e.code; } };
check("no shadow parameters: none", p({}) === null);
check("shadow_type=none: none", p({ shadow_type: "none" }) === null);
check("shadow_type=drop: opacity 50", JSON.stringify(p({ shadow_type: "drop" })) === '{"kind":"drop","opacity":50}');
check("shadow_type=3D (any case)", p({ shadow_type: "3D" })?.kind === "3d");
check("shadow_type=auto without a type: drop (other)", p({ shadow_type: "auto" })?.kind === "drop");
check("shadow_type=auto, type=person: 3d", p({ shadow_type: "auto" }, "person")?.kind === "3d");
check("shadow_type=auto, type=car: car, opacity 90", JSON.stringify(p({ shadow_type: "auto" }, "car")) === '{"kind":"car","opacity":90}');
check("shadow_opacity=80", p({ shadow_type: "drop", shadow_opacity: "80" })?.opacity === 80);
check("shadow_opacity=auto is the default", p({ shadow_type: "drop", shadow_opacity: "auto" })?.opacity === 50);
check("add_shadow without type=car: none", p({ add_shadow: "true" }) === null);
check("add_shadow with type=car: car", p({ add_shadow: "true" }, "car")?.kind === "car");
check("shadow_type[product]=drop, type=product", p({ "shadow_type[product]": "drop" }, "product")?.kind === "drop");
check("shadow_type [product]=drop (with a space)", p({ "shadow_type [product]": "drop" }, "product")?.kind === "drop");
check("shadow_type[product]=drop, no type: none (other unmentioned)", p({ "shadow_type[product]": "drop" }) === null);
check("shadow_type[other]=drop, no type", p({ "shadow_type[other]": "drop" })?.kind === "drop");
check("JSON per-type objects", JSON.stringify(p({ shadow_type: { product: "drop" }, shadow_opacity: { product: "70" } }, "product")) === '{"kind":"drop","opacity":70}');
check("shadow_opacity[person]=20 for a person", p({ shadow_type: "3D", "shadow_opacity[person]": "20" }, "person")?.opacity === 20);
check("shadow_opacity[person] does not apply to others", p({ shadow_type: "drop", "shadow_opacity[person]": "20" }, "animal")?.opacity === 50);
check("error multiple_shadow_params", p({ add_shadow: "true", shadow_type: "drop" }) === "multiple_shadow_params");
check("error multiple_shadow_params (per type)", p({ add_shadow: "true", "shadow_type[car]": "car" }) === "multiple_shadow_params");
check("error invalid_shadow_opacity", p({ shadow_type: "drop", shadow_opacity: "300" }) === "invalid_shadow_opacity");
check("error invalid_shadow_opacity (per type)", p({ shadow_type: "drop", "shadow_opacity[car]": "-1" }) === "invalid_shadow_opacity");
check("error invalid_shadow_type", p({ shadow_type: "long" }) === "invalid_shadow_type");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
