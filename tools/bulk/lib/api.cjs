// remove.bg's POST /v1.0/removebg parameters, checked the way their API documents them
// (https://www.remove.bg/api, OpenAPI file https://www.remove.bg/api/swagger.yaml). Errors use their shape and codes:
// { errors: [{ code, title, detail }] }. Codes they don't have (marked "ours") are for what this server can't do.
"use strict";
const sharp = require("sharp");

class ApiError extends Error {
  constructor(status, code, title, detail) { super(title); Object.assign(this, { status, code, title, detail }); }
}
const bad = (code, title, detail) => new ApiError(400, code, title, detail);

const SIZES = { preview: "preview", small: "preview", regular: "preview", medium: "medium", hd: "hd", full: "full", "4k": "full", "50mp": "50mp", auto: "auto" };
const TYPES = new Set(["auto", "car", "product", "person", "animal", "graphic", "transportation", "other"]);

const str = (v) => (v == null ? "" : typeof v === "string" ? v.trim() : typeof v === "object" ? "" : String(v).trim());
const present = (v) => v != null && (typeof v === "object" ? v.size > 0 : str(v) !== "");
function bool(v, dflt, code, name) {
  const s = str(v).toLowerCase();
  if (s === "") return dflt;
  if (["true", "1", "yes", "on"].includes(s)) return true;
  if (["false", "0", "no", "off"].includes(s)) return false;
  if (code) throw bad(code, `Invalid ${name} parameter given`);
  return dflt;
}
// "30px", "10%", "30" (pixels).
const LEN = /^(\d+(?:\.\d+)?)(px|%)?$/i;
const len = (s) => { const m = LEN.exec(s); return m && { v: +m[1], unit: m[2] === "%" ? "%" : "px" }; };

async function parseColor(s) {
  let c = s.replace(/^#/, "");
  if (/^([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(c)) {
    if (c.length <= 4) c = [...c].map((x) => x + x).join("");
    return [0, 2, 4, 6].map((k) => (k < c.length ? parseInt(c.slice(k, k + 2), 16) : 255));
  }
  if (!/^[a-z]{3,24}$/i.test(s)) return null;
  try { // a colour name: sharp knows the CSS names
    const { data } = await sharp({ create: { width: 1, height: 1, channels: 4, background: s.toLowerCase() } }).raw().toBuffer({ resolveWithObject: true });
    return [data[0], data[1], data[2], data[3]];
  } catch { return null; }
}

// fields: name -> string, number, boolean or Blob (multipart files). Returns the worker's options and where the image
// and the background image come from. Throws ApiError.
async function parseRequest(fields, { harden }) {
  const g = (k) => fields[k];
  const sources = ["image_file", "image_file_b64", "image_url"].filter((k) => present(g(k)));
  if (sources.length > 1) throw bad("multiple_sources", "Multiple image sources given: Please provide either the image_url, image_file or image_file_b64 parameter.");
  if (!sources.length) throw bad("missing_source", "No image given", "Please provide the source image in the image_url, image_file or image_file_b64 parameter.");
  let image;
  if (sources[0] === "image_file") {
    if (typeof g("image_file") !== "object") throw bad("missing_source", "No image given", "image_file must be a file upload (multipart/form-data). Use image_file_b64 for base64.");
    image = { kind: "file", blob: g("image_file") };
  } else if (sources[0] === "image_file_b64") {
    const b = Buffer.from(str(g("image_file_b64")).replace(/^data:[^,]*,/, ""), "base64");
    if (!b.length) throw bad("failed_to_read_image", "There was an error reading the image.");
    image = { kind: "bytes", bytes: b };
  } else {
    const u = str(g("image_url"));
    if (!/^https?:\/\//i.test(u) || !URL.canParse(u)) throw bad("invalid_image_url", "Invalid image_url: Please provide a valid URL.");
    image = { kind: "url", url: u };
  }

  const size = SIZES[str(g("size")).toLowerCase() || "preview"];
  if (!size) throw bad("invalid_size", "Invalid value for parameter 'size'");
  const t = str(g("type")).toLowerCase();
  if (t && !TYPES.has(t)) throw bad("invalid_type", "Invalid value for parameter 'type'"); // not in their list of codes; ours
  const tl = str(g("type_level")).toLowerCase();
  if (tl && !["none", "1", "2", "latest"].includes(tl)) throw bad("invalid_type_level", "Invalid value for parameter 'type_level'"); // ours
  let format = str(g("format")).toLowerCase() || "auto";
  if (format === "jpeg") format = "jpg";
  if (!["auto", "png", "jpg", "zip", "webp"].includes(format)) throw bad("invalid_format", "Invalid format parameter given");
  const channels = str(g("channels")).toLowerCase() || "rgba";
  if (!["rgba", "alpha"].includes(channels)) throw bad("invalid_channels", "Invalid value for parameter 'channels'");

  let roi = null;
  const roiS = str(g("roi"));
  if (roiS) {
    const parts = roiS.split(/\s+/).map(len);
    if (parts.length !== 4 || parts.some((p) => !p)) throw bad("invalid_roi", "Invalid roi parameter given");
    if (!(parts[0].v === 0 && parts[1].v === 0 && parts[2].unit === "%" && parts[2].v === 100 && parts[3].unit === "%" && parts[3].v === 100)) roi = parts;
  }

  const crop = bool(g("crop"), false);
  let margin = null;
  const cm = str(g("crop_margin")) || "0";
  {
    const parts = cm.split(/\s+/).map(len);
    if (![1, 2, 4].includes(parts.length) || parts.some((p) => !p)) throw bad("invalid_crop_margin", "Invalid crop_margin parameter given");
    margin = parts.length === 1 ? [parts[0], parts[0], parts[0], parts[0]] : parts.length === 2 ? [parts[0], parts[1], parts[0], parts[1]] : parts; // top right bottom left
    if (margin.some((p) => p.unit === "%" && p.v > 50)) throw bad("invalid_crop_margin", "Invalid crop_margin parameter given");
  }

  let scale = null;
  const sc = str(g("scale")).toLowerCase();
  if (sc && sc !== "original") {
    const m = /^(\d+(?:\.\d+)?)%$/.exec(sc);
    if (!m || +m[1] < 10 || +m[1] > 100) throw bad("invalid_scale", "Invalid scale parameter given");
    scale = +m[1] / 100;
  }
  let position = null;
  const po = str(g("position")).toLowerCase();
  if (po) {
    if (po === "original" || po === "center") position = po;
    else {
      const parts = po.split(/\s+/).map((p) => /^(\d+(?:\.\d+)?)%$/.exec(p));
      if (![1, 2].includes(parts.length) || parts.some((p) => !p || +p[1] > 100)) throw bad("invalid_position", "Invalid position parameter given");
      position = [+parts[0][1] / 100, +(parts[1] || parts[0])[1] / 100];
    }
  }

  bool(g("semitransparency"), true, "invalid_semitransparency", "semitransparency"); // car windows only at remove.bg; nothing to do here
  const addShadow = bool(g("add_shadow"), false);
  const shadowType = str(g("shadow_type")).toLowerCase();
  if (addShadow && shadowType) throw bad("multiple_shadow_params", "Multiple shadow parameters given: Please provide either the add_shadow or the shadow_type parameter.");
  const so = str(g("shadow_opacity")).toLowerCase();
  if (so && so !== "auto" && !(/^\d+$/.test(so) && +so <= 100)) throw bad("invalid_shadow_opacity", "Invalid shadow_opacity parameter given");
  // add_shadow only ever made a car shadow, and only for a car; this server never detects one, so only type=car asks for it.
  const perType = Object.keys(fields).some((k) => /^shadow_type\s*\[/.test(k) && !["", "none"].includes(str(fields[k]).toLowerCase())); // shadow_type[car]=car
  if ((addShadow && t === "car") || (shadowType && shadowType !== "none") || perType)
    throw bad("unsupported_parameter", "Shadows are not supported by this local server", "Leave out shadow_type (or set it to none) and add_shadow."); // ours

  const bgs = ["bg_color", "bg_image_url", "bg_image_file"].filter((k) => present(g(k)));
  if (bgs.length > 1) throw bad("multiple_bg_sources", "Multiple background sources given: Please provide either the bg_color, the bg_image_url or the bg_image_file parameter.");
  let bg = null, bgImage = null;
  if (bgs[0] === "bg_color") {
    bg = await parseColor(str(g("bg_color")));
    if (!bg) throw bad("invalid_bg_color", "Invalid bg_color parameter given");
  } else if (bgs[0] === "bg_image_url") {
    const u = str(g("bg_image_url"));
    if (!/^https?:\/\//i.test(u) || !URL.canParse(u)) throw bad("invalid_bg_image_url", "Invalid bg_image_url: Please provide a valid URL.");
    bgImage = { kind: "url", url: u };
  } else if (bgs[0] === "bg_image_file") {
    if (typeof g("bg_image_file") !== "object") throw bad("invalid_bg_image_url", "bg_image_file must be a file upload (multipart/form-data)."); // close enough; ours in wording
    bgImage = { kind: "file", blob: g("bg_image_file") };
  }

  return { image, bgImage, o: { harden, roi, channels, crop, margin, scale, position, bg, format, size } };
}

module.exports = { parseRequest, ApiError, parseColor };
