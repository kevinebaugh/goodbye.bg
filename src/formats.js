// Formats the browser can't open on its own, decoded on the device in a module Worker (so the page never stalls):
// - HEIC/HEIF (iPhone photos on Chrome, Edge, Firefox): libheif (LGPL-3.0) compiled to wasm, served from here.
// - TIFF: UTIF (MIT).
// - Camera RAW (DNG, CR2, CR3, NEF, ARW, RAF, ORF, RW2, ...): the camera stores its own full-size JPEG inside the
//   file; we use that, turned the way the camera says. No RAW developing.
// Bundled into formats.mjs at build time and started only when such a file arrives. One file per worker.
import * as UTIF from "utif2";

const RAW = /\.(dng|cr2|cr3|crw|nef|nrw|arw|srf|sr2|orf|rw2|raf|pef|srw|raw|rwl|3fr|erf|kdc|dcr|mrw|x3f|iiq|mos|mef)$/i;

onmessage = async ({ data: { buf, name, type } }) => {
  try {
    const bitmap = await decode(buf, name || "", type || "");
    postMessage({ bitmap }, [bitmap]);
  } catch (e) {
    postMessage({ error: e.message || String(e), raw: RAW.test(name || "") });
  }
};

async function decode(buf, name, type) {
  const b = new Uint8Array(buf);
  const brand = b.length > 12 && ascii(b, 4, 4) === "ftyp" ? ascii(b, 8, 4) : "";
  if (/^(heic|heix|heim|heis|hevc|hevx|mif1|msf1|avif|avis)$/.test(brand) || /hei[cf]/i.test(type) || /\.hei[cf]$/i.test(name)) return heif(b);
  const tiff = (b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a) || (b[0] === 0x4d && b[1] === 0x4d && b[3] === 0x2a);
  if (tiff && !RAW.test(name)) {
    const t = tiffImage(buf);
    if (t) return t;
  }
  return preview(b, tiff ? orientationOf(buf) : 1);
}

const ascii = (b, at, n) => String.fromCharCode(...b.subarray(at, at + n));

// ---------- HEIC ----------
let lib;
async function heif(bytes) {
  if (!lib) {
    const { default: factory } = await import("libheif-js/libheif-wasm/libheif.js");
    const wasmBinary = await (await fetch(new URL("./libheif.wasm", import.meta.url))).arrayBuffer();
    lib = await factory({ wasmBinary });
  }
  const images = new lib.HeifDecoder().decode(bytes);
  if (!images?.length) throw new Error("This HEIC file has no picture in it.");
  const img = images[0], w = img.get_width(), h = img.get_height();
  const id = new ImageData(w, h);
  await new Promise((res, rej) => img.display(id, (d) => (d ? res() : rej(new Error("Could not read this HEIC photo.")))));
  for (const i of images) i.free?.();
  return createImageBitmap(id);
}

// ---------- TIFF ----------
// The largest picture in the file that holds real colours (RAW sensor data, photometric 32803/34892, is not one).
function tiffImage(buf) {
  let ifds;
  try { ifds = UTIF.decode(buf); } catch { return null; }
  const all = [];
  const walk = (list) => { for (const f of list || []) { all.push(f); walk(f.subIFD); } };
  walk(ifds);
  const pics = all.filter((f) => f.t256 && f.t257 && [0, 1, 2, 3, 5, 6].includes(f.t262?.[0] ?? 2))
    .sort((a, b) => b.t256[0] * b.t257[0] - a.t256[0] * a.t257[0]);
  for (const f of pics) {
    try {
      UTIF.decodeImage(buf, f, ifds);
      const w = f.width, h = f.height;
      if (!w || !h) continue;
      const rgba = UTIF.toRGBA8(f);
      if (rgba.length < w * h * 4) continue;
      return orient(new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, w * h * 4), w, h), f.t274?.[0] || ifds[0]?.t274?.[0] || 1);
    } catch {}
  }
  return null;
}

function orientationOf(buf) {
  try { return UTIF.decode(buf)[0]?.t274?.[0] || 1; } catch { return 1; }
}

// ---------- Camera RAW: the camera's own JPEG inside the file ----------
// Every baseline/progressive JPEG in the file, biggest first. Lossless JPEG (SOF3) is sensor data, not a picture.
function jpegsIn(b) {
  const out = [];
  for (let i = 0; i < b.length - 4; i++) {
    if (b[i] !== 0xff || b[i + 1] !== 0xd8 || b[i + 2] !== 0xff) continue;
    let p = i + 2, w = 0, h = 0, ok = false;
    while (p + 4 < b.length && b[p] === 0xff) {
      const m = b[p + 1];
      if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) { p += 2; continue; }
      const len = (b[p + 2] << 8) | b[p + 3];
      if (len < 2) break;
      if (m === 0xc0 || m === 0xc1 || m === 0xc2) { h = (b[p + 5] << 8) | b[p + 6]; w = (b[p + 7] << 8) | b[p + 8]; }
      if (m === 0xc3) { w = 0; break; }
      if (m === 0xda) { ok = true; p += 2 + len; break; }
      p += 2 + len;
    }
    if (!ok || !w || !h) continue;
    // Entropy-coded data until the end marker (FF 00 and FF D0..D7 can appear inside it).
    let e = p;
    for (; e < b.length - 1; e++) if (b[e] === 0xff && b[e + 1] === 0xd9) break;
    if (e >= b.length - 1) continue;
    out.push({ start: i, end: e + 2, w, h });
    i = e + 1; // a JPEG's own thumbnail lives in its header, before the scan: skip past this one
  }
  return out.sort((a, b2) => b2.w * b2.h - a.w * a.h);
}

async function preview(b, orientation) {
  for (const j of jpegsIn(b)) {
    if (j.w * j.h < 640 * 480) break; // only thumbnails left
    try {
      const jpg = b.subarray(j.start, j.end);
      const bmp = await createImageBitmap(new Blob([jpg], { type: "image/jpeg" }));
      // A JPEG with its own EXIF orientation (iPhone ProRAW DNGs, portrait shots on some cameras) follows that one, not
      // the RAW's. Chrome turns it while decoding, other browsers may not: sides swapped from the stored size means
      // it was turned already (2 to 4 can't be told apart that way; those are left as decoded).
      const own = exifOrientation(jpg);
      if (own > 1) {
        if (own < 5 || bmp.width !== j.w) return bmp;
        orientation = own;
      } else if (orientation === 1) return bmp;
      const c = new OffscreenCanvas(bmp.width, bmp.height); c.getContext("2d").drawImage(bmp, 0, 0); bmp.close();
      return orient(c.getContext("2d").getImageData(0, 0, c.width, c.height), orientation);
    } catch {}
  }
  throw new Error("RAW");
}

// The orientation tag in a JPEG's own EXIF (APP1) block, or 0 if it has none.
function exifOrientation(j) {
  for (let p = 2; p + 4 < j.length && j[p] === 0xff;) {
    const m = j[p + 1], len = (j[p + 2] << 8) | j[p + 3];
    if (m === 0xda || len < 2) break;
    if (m === 0xe1 && ascii(j, p + 4, 6) === "Exif\0\0") {
      const t = p + 10, le = j[t] === 0x49;
      const u16 = (o) => (le ? j[t + o] | (j[t + o + 1] << 8) : (j[t + o] << 8) | j[t + o + 1]);
      const u32 = (o) => (le ? u16(o) + u16(o + 2) * 65536 : u16(o) * 65536 + u16(o + 2));
      const ifd = u32(4);
      if (t + ifd + 2 > j.length) return 0;
      for (let i = 0, n = u16(ifd); i < n && t + ifd + 14 + i * 12 <= j.length; i++) {
        const e = ifd + 2 + i * 12;
        if (u16(e) === 274) return u16(e + 8);
      }
      return 0;
    }
    p += 2 + len;
  }
  return 0;
}

// EXIF orientation 1..8 applied to pixels.
async function orient(id, o) {
  if (!(o >= 2 && o <= 8)) return createImageBitmap(id);
  const src = await createImageBitmap(id), w = id.width, h = id.height, swap = o >= 5;
  const c = new OffscreenCanvas(swap ? h : w, swap ? w : h), x = c.getContext("2d");
  const t = { 2: [-1, 0, 0, 1, w, 0], 3: [-1, 0, 0, -1, w, h], 4: [1, 0, 0, -1, 0, h], 5: [0, 1, 1, 0, 0, 0],
    6: [0, 1, -1, 0, h, 0], 7: [0, -1, -1, 0, h, w], 8: [0, -1, 1, 0, 0, w] }[o];
  x.setTransform(...t); x.drawImage(src, 0, 0); src.close();
  return createImageBitmap(c);
}
