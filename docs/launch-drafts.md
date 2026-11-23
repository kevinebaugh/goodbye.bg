# Launch drafts

Superseded by `docs/launch/README.md` (2026-11-22): tighter copy, checked against the code, plus images and a demo.

Drafts for Kevin to post himself. Nothing here has been posted. Written 2026-11-21.

Before posting:
- Use `https://goodbye.bg` (live since 2026-11-23).
- Re-check every claim against the site that day (features land fast). Facts used below: free, no account, no
  watermark; cut out in the browser (WebGPU on computers, WebAssembly on phones); PNG at the photo's own resolution
  (16 MP cap in Safari/iPhone, 64 MP elsewhere); batches up to 50 per drop with a zip; HEIC, TIFF, camera RAW, ZIP
  and animated GIF in; AGPL source on GitHub; supported by optional product ads (Zazzle etc.). No API, no
  background replacement, sizes or shadows (removed 2026-11-22: just the cut-out), no brush.
- Timing (docs/seo.md §5): HN on a weekday morning US time, Product Hunt the same week, both before 1 December.

## Show HN

**Title** (80 chars max):

    Show HN: goodbye.bg – a background remover that runs entirely in your browser

**URL:** the site. **Text:**

> remove.bg shuts down on 1 December, and I use it all the time, so I built a replacement that runs on your
> device instead of a server.
>
> How it works: ONNX Runtime Web runs a segmentation model in a Web Worker. On computers with WebGPU it uses
> BiRefNet lite (MIT), about 300 ms a photo on an M-series Mac. Everywhere else, including every iPhone, it uses
> IMG.LY's ISNet on WebAssembly with threads, a few seconds a photo. The model downloads once (about 90 MB) and
> is cached. Photos never leave the page to be cut out; the CSP only allows the page's own origin.
>
> Things that were harder than expected:
> - BiRefNet's export has Concat ops with up to 1024 inputs and deformable convs spelled out as huge GatherND
>   tensors. WebGPU allows 10 storage buffers per shader and the gathers hit `bad_alloc`, so a script rewrites the
>   Concats into trees and each deformable conv into chunked GridSample + Conv.
> - iPhones: the WebGPU path crashed Safari tabs on real photos, so phones run on the CPU with 2 threads (4
>   threads peaked at 2.1 GB). Safari only gives you threads with `COEP: require-corp`.
> - Safari caps canvases at about 16.7 MP, so big photos are kept as bitmaps and scaled when drawn.
>
> It takes JPG, PNG, WebP, HEIC, TIFF, camera RAW (the embedded preview), ZIPs and animated GIFs, gives back
> transparent PNGs at the original size, and keeps your photos in IndexedDB so a reload doesn't lose them.
> No account, no watermark. It's supported by optional product cards (put the cut-out on a mug, etc.).
>
> What it doesn't do yet: no API, no brush to fix edges, no replacing the background. Hair is OK, not great.
>
> Source (AGPL, because the ISNet model is): https://github.com/kevinebaugh/goodbye.bg
>
> I'd love to hear where it fails on your photos.

Be ready in the comments for: "why AGPL" (ISNet's license), "what about the ads and privacy" (the cut-out goes to
Zazzle only when you click a product card; nothing else is uploaded), "how big is the download" (about 90 MB once),
"does it work offline" (not promised: don't say yes).

## Product Hunt

- **Name:** goodbye.bg
- **Tagline** (60 chars max): `Free background remover that runs on your device`
- **Topics:** Photography, Design Tools, Privacy, Open Source
- **Description** (260 chars max):

  > Remove the background from any photo, free, right in your browser. Nothing is uploaded to cut it out. High-res
  > transparent PNGs, batches with zip download, HEIC and RAW in, no account, no watermark. Built as a replacement
  > for remove.bg, which shuts down 1 Dec.

- **Maker's first comment:**

  > Hi PH! remove.bg closes on 1 December and I didn't want to lose it, so I made goodbye.bg. The model runs in your
  > browser (WebGPU on computers, WebAssembly on phones), so your photos stay on your device and there's nothing to
  > pay per image. Drop a folder of product shots and download them all as a zip. It's open source (AGPL).
  > Not there yet: an API, editing brushes, and replacing the background. Tell me what breaks.

- **Gallery** (1270x760): 1. a batch of four results on the grid, 2. before/after of a pet photo, 3. the phone view
  with "press and hold to save", 4. a 20 s clip: drop a folder, results appear, Download all.

## Replies for "what replaces remove.bg?" threads

Answer the question first; disclose that it's yours. One reply per thread, no follow-up pushing.

1. Short:

   > I built goodbye.bg for exactly this (disclosure: it's mine). Free, no account, and it runs in your browser,
   > so photos aren't uploaded to cut them out. Full-size transparent PNG, batches with a zip. No API though.

2. For people who used the API:

   > remove.bg's API page says background removal moves to Leonardo.Ai, so start there. For free, rembg (open source, Python) on your own
   > server is the closest. If you just need the web tool, I made goodbye.bg (free, runs on your device, no
   > account), and its source shows how to run the model in a browser.

3. For privacy-minded threads:

   > goodbye.bg (I made it) does the cut-out on your own device with WebGPU or WebAssembly: the page can only talk
   > to its own server, and photos aren't sent anywhere to be processed. Open source, so you can check. Works on
   > phones too, a few seconds a photo.
