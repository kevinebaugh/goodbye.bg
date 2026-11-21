// Animated GIFs: read every frame (gifuct-js, MIT) and write the cut-out back as an animated GIF (gifenc, MIT).
// Bundled into gif.mjs at build time and loaded only when someone adds an animated GIF. Runs on the device.
import { parseGIF, decompressFrames } from "gifuct-js";
import { GIFEncoder, quantize, applyPalette } from "gifenc";

// The frames as whole pictures (GIF frames are often patches over the previous one), at most `max` of them:
// longer GIFs keep every n-th frame and add up the delays, so the timing stays the same.
export function readGif(buf, max, budget = 120e6) {
  const gif = parseGIF(buf), raw = decompressFrames(gif, true);
  const w = gif.lsd.width, h = gif.lsd.height;
  if (raw.length < 2) return null; // a still GIF goes the normal way
  max = Math.max(2, Math.min(max, Math.floor(budget / (w * h * 4)))); // frames are kept whole: cap the memory
  const step = Math.max(1, Math.ceil(raw.length / max));
  const screen = new OffscreenCanvas(w, h), sx = screen.getContext("2d"), patch = new OffscreenCanvas(w, h), px = patch.getContext("2d");
  const frames = [];
  let saved = null, prev = null;
  raw.forEach((f, i) => {
    if (prev?.disposalType === 2) sx.clearRect(prev.dims.left, prev.dims.top, prev.dims.width, prev.dims.height);
    else if (prev?.disposalType === 3 && saved) { sx.clearRect(0, 0, w, h); sx.putImageData(saved, 0, 0); }
    if (f.disposalType === 3) saved = sx.getImageData(0, 0, w, h);
    const { left, top, width, height } = f.dims;
    patch.width = width; patch.height = height;
    px.putImageData(new ImageData(new Uint8ClampedArray(f.patch), width, height), 0, 0);
    sx.drawImage(patch, left, top); // drawImage keeps what shows through the patch's transparent pixels
    prev = f;
    if (i % step === 0) {
      const c = new OffscreenCanvas(w, h); c.getContext("2d").drawImage(screen, 0, 0);
      frames.push({ canvas: c, delay: 0 });
    }
    frames[frames.length - 1].delay += f.delay || 100;
  });
  return { w, h, frames, total: raw.length };
}

// Cut-out frames (RGBA with the subject opaque) to an animated GIF. GIF transparency is on or off per pixel,
// so soft edges become hard ones.
export function writeGif(frames, w, h) {
  const enc = GIFEncoder();
  for (const { rgba, delay } of frames) {
    const palette = quantize(rgba, 256, { format: "rgba4444", oneBitAlpha: true });
    const index = applyPalette(rgba, palette, "rgba4444");
    const transparentIndex = palette.findIndex((p) => p[3] === 0);
    enc.writeFrame(index, w, h, { palette, delay, transparent: transparentIndex >= 0, transparentIndex: Math.max(0, transparentIndex), dispose: 2 });
  }
  enc.finish();
  return new Blob([enc.bytes()], { type: "image/gif" });
}
