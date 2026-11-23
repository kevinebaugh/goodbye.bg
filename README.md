# goodbye.bg

A free background remover that runs in your browser. Photos are cut out on your device.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/launch/before-after-strip-dark.png">
  <img src="docs/launch/before-after-strip-light.png" alt="A photo before and after goodbye.bg removed its background" width="800">
</picture>

**https://goodbye.bg** · Built because remove.bg stops removing backgrounds on 1 December 2026.

- Free. No account, no watermark.
- Transparent PNG at the photo's own resolution, cropped to the subject.
- Batches of up to 100 photos (50 on phones), a ZIP or a folder; Download all gives a zip.
- JPG, PNG, WebP, AVIF, SVG, HEIC, TIFF, camera RAW and animated GIFs.
- Works offline after your first photo. Six languages.

## How it works

[ONNX Runtime Web](https://onnxruntime.ai) runs the model in a Worker: BiRefNet lite on WebGPU on computers, BiRefNet
lite at 640 px on WebAssembly everywhere else (every iPhone), and IMG.LY's ISNet as the fallback and the 👎 retry.
About 300 ms a photo on a recent Mac, 5 to 8 s on an iPhone. The first photo downloads about 120 MB; the browser keeps it.

Engineering notes: [`docs/birefnet.md`](docs/birefnet.md) (making BiRefNet run on WebGPU),
[`docs/quality-1000.md`](docs/quality-1000.md) (quality on 1,073 photos), [`CLAUDE.md`](CLAUDE.md) (everything else).

## Privacy

The page can only talk to its own server (Content-Security-Policy), sets no cookies and loads no third-party code.
It sends anonymous counts, never photos: views, votes, how each photo went (engine, timings) and crash reports.
No IP addresses, no identifiers.

Two exceptions:
- **A pasted link** is fetched by our server and passed straight back. Nothing is kept.
- **Clicking a Zazzle product card** uploads that one result so it appears on the product. Zazzle copies it, and ours
  is deleted 20 seconds later (if Zazzle never fetches it, it's unreachable after an hour and gone within a day). Details: [`docs/zazzle-cap.md`](docs/zazzle-cap.md).

## Ads

The product cards among your photos pay for the site. They're marked "Ad" or "Sponsored" and use Zazzle affiliate
links. Ad blockers can hide them (`goodbye.bg##.adcard`); the site doesn't work around that.

## Run it locally

    npm ci
    npm run dev     # http://localhost:8788 with the production headers
    npm run test    # smoke tests in headless Chrome (about 2.5 min)

## Licence

AGPL-3.0, because ISNet's weights are. BiRefNet is MIT ([`docs/licenses/BiRefNet.txt`](docs/licenses/BiRefNet.txt)).
Also used: ONNX Runtime Web, Three.js, libheif-js (LGPL-3.0), utif2, fflate, gifuct-js, gifenc, canvas-confetti, Nunito.
Launch photos are CC0 ([`docs/launch/CREDITS.md`](docs/launch/CREDITS.md)).
