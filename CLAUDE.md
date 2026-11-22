# goodbye.bg

Background remover that runs in the browser. Replacement for remove.bg, which shuts down
1 December 2026. Photos are cut out on the device, never uploaded for it (a click on a Zazzle product ad takes
that one cut-out along, see below). Kevin uses it often, so it must be
zero friction: fun copy and small animations are fine, delays and popups are not.

## Commands

    npm ci               # install (native packages: always install on the Mac, never copy node_modules)
    npm run dev          # build dist/ and serve at http://localhost:8788 with production headers
    npm run build        # build only
    npm run deploy       # manual fallback: wrangler pages deploy to project goodbye-bg-git
    npm run test         # smoke tests (about 40 s): build, serve, headless Chrome; run before pushing
    node scripts/test/offline.mjs   # offline/install test (about 1.5 min); its upgrade step edits dist/: rebuild after
    npm run test:x       # WebKit (computer + iPhone) and Firefox via Playwright (about 2 min); once: npx playwright install webkit firefox

`npm run test` (`scripts/test/smoke.mjs`, no dependencies beyond Chrome; `--no-build` reuses dist/, `CHROME=` picks
another Chrome) drives headless Chrome over the DevTools protocol, each check in a fresh profile, and prints PASS/FAIL/SKIP;
exit code 1 on any failure. Covers: build placeholders, CSP/COOP/COEP headers, empty page clean (no console errors, CSP
violations, crash reports), one photo on the GPU engine (when headless has WebGPU with shader-f16, else CPU) and one on
the CPU engine with PNG downloads, `?adtest=1` ad cards, White background -> JPG, 3 photos + Download all (zip names),
reload with CLS 0 (desktop, and phone width at 300 ms latency), Remove/Undo and removal surviving a reload, an animated
GIF staying animated, a ZIP opening, the 404 page and `/share`, the SEO pages (CSP, no sideways scroll at 390 px, first
visit drawn in Nunito). Test photos are generated. Each cut-out adds to the public count (serve.mjs passes `/api/count` to
the live site); ad cards are never clicked. `scripts/serve.mjs` mirrors Pages for unknown paths (404.html, status 404),
`/dir` -> `/dir/`, `.html` -> clean URL and `_redirects`.

`npm run test:x` (`scripts/test/xbrowser.mjs`; `--browser webkit|firefox`, `--device desktop|iphone`, `--no-build`)
runs the same flow in Playwright (devDependency; browsers in ~/Library/Caches/ms-playwright, nothing global) on
webkit-desktop (1280x800), webkit-iphone (Playwright's iPhone 15: touch, iPhone user agent, so the app takes its iPhone
paths; the share sheet is stubbed to record the files) and firefox-desktop: cross-origin isolation, the landing View
Transition, one photo + Download, 3D ad cards, White -> JPG and the colour input, the options row (Square; WebP button
only where the browser encodes WebP; 16 px controls on touch), 3 photos + Download all, a tell() bubble, reload with kept
photos, Remove/Undo, offline through the service worker, HEIC, an animated GIF, `?engine=cpu`, 404 and SEO pages, and
a WebKit private window. Persistent profiles, because an ephemeral WebKit context acts like Private Browsing.

Tested 2026-11-22 (Playwright 1.65.0: WebKit 27.2 = Safari's engine on macOS, Firefox 159), all passing:
- WebKit: cross-origin isolated with COEP require-corp (threads on), also offline from the service worker's cache.
  Computer: WebGPU with shader-f16, so it picks BiRefNet on the GPU, and it works (warm-up 0.4 to 1.6 s, about 1 s a
  photo here). iPhone profile: CPU engine with 2 threads, about 4 s a photo. View Transition runs and finishes. WebGL2 3D
  ad cards draw. HEIC opens natively (createImageBitmap; libheif not fetched). WebP can't be encoded (it hands back a
  PNG), so the WebP button stays hidden and those photos save as PNG/JPG. A 16384x16384 canvas works on the Mac (the
  16 MP cap is the iPhone's).
- WebKit private window: IndexedDB refuses Blobs ("Not kept: null" warning), so nothing is kept across a reload; photos
  still work. Real Safari Private Browsing likely the same.
- Firefox: WebGPU is blocklisted in headless (so the CPU engine; real Firefox may differ), isolated, View Transition,
  WebGL2, HEIC through libheif, WebP encodes. Firefox's default for a downloaded .webp is to save it and also open it
  in a new tab (WebP is "viewable internally"; an octet-stream blob doesn't change that, it goes by extension).
- Not covered by Playwright: real iOS memory limits, the real share sheet (stubbed; Download all awaits the PNGs before
  `navigator.share`, which a real iPhone may refuse once the tap's activation has lapsed), touch gestures (clicks are
  mouse events), select wheels and focus zoom (only the 16 px font size is checked).

Deploys: Cloudflare Pages project `goodbye-bg-git` builds from GitHub. Every push to `main`
deploys; other branches get preview URLs (`<branch>.goodbye-bg-git.pages.dev`). No GitHub
Actions. The old upload-only project `goodbye-bg` can be deleted.

## Layout

- `src/` static site: `index.html`, `style.css`, `app.js` (everything), `sw.js` (Android share target, offline caches),
  `manifest.webmanifest`, `_headers` (security headers, also used by local dev), `ad.html` (sandboxed ad slot, ads off),
  `404.html` (real 404 for unknown paths; no scripts), `_redirects` (`/share` to `/` when the service worker missed it),
  `remove-bg-alternative/` and `how-to-remove-background/` (SEO pages, see `docs/seo.md`; launch drafts in `docs/launch-drafts.md`)
- `functions/api/fetch.js` Cloudflare Pages Function. Fetches an image for a pasted link (same-origin only,
  30 MB cap, follows og:image for web pages). The only server code.
- `scripts/build.mjs` assembles `dist/`. `scripts/serve.mjs` local server that applies `_headers` and runs the function.
- `src/engine.js` the model worker. `weights/birefnet/` BiRefNet for the GPU engine, committed as 20 MiB parts with
  a manifest (size, sha256); the build copies it to `m/birefnet-<hash>/`. `scripts/birefnet.sh` regenerates it
  (download, then `deform-to-gridsample.py` and `narrow-onnx.py`; needs Python with onnx). Not part of the build.

## Rules

- Content-Security-Policy on the app page allows network only to its own origin. Keep it that way.
- No cookies, no third-party scripts or fonts on the app page. Only anonymous counts the page sends to its own
  server (votes, crashes, cut-outs, page views): no IP addresses, no identifiers. The one image the page uploads is
  the cut-out on a clicked Zazzle ad (functions/api/cap): R2, random one-time key, deleted once Zazzle has it.
- Dark/light follows the system. No toggle.
- Copy: plain, short, active voice.

## Engines

iPhones and iPads always use the CPU engine (2 threads: 4 threads peaked at 2.1 GB in the Simulator and crashed an
18.75 MP photo half the time on Kevin's iPhone; 2 threads peak about 300 MB lower). Tested 2026-11-20 on Kevin's iPhone with
`?debug=1`: the WebGPU engine crashed the tab ("A problem repeatedly occurred") on the first real photo,
even with no warm-up run (one try in two); the CPU engine never crashed: 7.3 s a photo on 1 thread,
5.0 s on 2, 3.5 s on 4. Safari needs `Cross-Origin-Embedder-Policy: require-corp` (it ignores
`credentialless`) to be cross-origin isolated, which threads need.

Debugging on phones: `?debug=1` sends step names and numbers (never photo data) to `/api/diag`, which
only writes to the Functions log. Read it with `npx wrangler pages deployment tail <deployment-id>
--project-name goodbye-bg-git --format json` (find the ID with `wrangler pages deployment list`).
Other test switches: `?keepmax=N`, `?keepmb=N` (kept-photo limits), `?engine=gpu|cpu`, `?model=isnet|birefnet`, `?threads=N`, `?nowarm=1`, `?gpufail=init|run|hang|birefnet-init|birefnet-oom|birefnet-slow|birefnet-slowrun`, `?haze=0` (ISNet without haze hardening), `?adpartner=zazzle|printful|printify` (with `?adtest=1`).

Memory on phones (measured in the iOS Simulator, CPU engine): ISNet at 1024x1024 needs about 1.5 to
2 GB of wasm heap, mostly activations; it can't run smaller (a Concat inside is fixed to 1024). Asking
for only the first of its 13 outputs, freeing the model bytes after session creation, one PNG at a
time, and compositing the mask instead of copying pixels took 3 photos from 2.1 GB to 1.46 GB.
Safari caps photos at 16 MP (canvas limit); the original bitmap is kept and scaled when drawn.

Two models, two engines. `src/engine.js` runs ONNX Runtime Web 1.31.1 inside its own module Worker. `app.js`
starts it with WebGPU when the adapter has `shader-f16`, else with WebAssembly (4 threads).
- GPU on computers (`any-pointer: fine`): **BiRefNet lite** (MIT, fp16, 93 MB after the rewrite below).
- CPU, and GPU on phones/tablets: IMG.LY **ISNet medium** (fp16, AGPL, 88 MB). BiRefNet on the CPU is 10 s
  and 6.7 GB (Node, 64-bit): no.
- Votes and crash reports call the engines `gpu-birefnet`, `gpu` (ISNet) and `cpu` (ISNet). A vote names the engine
  that made that photo's mask, even after a fallback.

The GPU worker does a warm-up run before "Ready", which compiles the shaders and proves the GPU works. If the GPU fails to start, fails a run, hangs (30 s warm-up, 15 s per run), or
returns NaN, the page terminates that worker and the next tier redoes the same photo. A separate worker is
required: a failed WebGPU run aborts ORT's wasm instance for the whole realm.

GPU gate (2026-11-22, for weak GPUs; the proposal in `docs/platforms-and-phone-model.md`, decision 3). Three tiers:
BiRefNet on the GPU, then ISNet on the GPU (a third of the GPU memory), then the CPU.
- BiRefNet steps down to ISNet on the GPU when its start fails, a run fails or its worker dies (out of GPU memory
  shows up as one of these), its start (session and warm-up, after the download) takes over 10 s, or its first
  photo over 2 s (M5 Pro: about 2 s and 0.3 s). The time limits count only while the page stays in view (computers
  start the model at load, often in a background tab); hidden, only the 30 s hang counts. A slow first photo keeps its BiRefNet result. ISNet on the GPU
  steps down to the CPU on a failure or a hang.
- Computers that report `navigator.deviceMemory` under 8 (Chrome only, capped at 8) start on ISNet on the GPU.
- The outcome is kept in localStorage `gb-gpu` (tier, user agent, runtime/model version, date), so later visits skip
  the try that failed. A browser update, a new runtime or BiRefNet export, or 30 days start over. Never written
  under `?engine=`, `?model=` or `?gpufail=`.
- Each step down is sent at once to `/api/crash` with the engine that failed: `birefnet-start-failed`,
  `birefnet-run-failed`, `birefnet-slow-start`, `birefnet-slow-run`, `gpu-start-failed`, `gpu-run-failed`
  (the same names in `?debug=1`, plus `gpu-lowmem` and `gpu-remembered`).
- Tested in headless Chrome (M5 Pro): every case below, a photo added while ISNet starts after a failed BiRefNet,
  a kept tier (and a stale one ignored), deviceMemory 4, a hidden tab, a vote on a restored photo. Not tested on a
  real weak GPU, Safari, Windows or Linux.

- `?engine=gpu` or `?engine=cpu` forces one (a forced gpu never falls back to the CPU; BiRefNet can still step down
  to ISNet on the GPU). `?model=birefnet` turns the gate off. `?gpufail=init|run|hang` simulates a broken GPU (every
  GPU tier); `?gpufail=birefnet-init|birefnet-oom|birefnet-slow|birefnet-slowrun` a GPU too weak for BiRefNet only
  (start fails after 3 s, worker dies on the first photo, start hangs, first photo takes 2.5 s).
- ISNet: input (x-128)/256, output 0..1. BiRefNet: ImageNet mean/std, output logits (the worker applies the
  sigmoid). Both fixed 1024x1024; the page sends RGBA pixels and the worker builds its model's input.
- Runtime is served from `rt/<version>/` (cached forever, so upgrades get new URLs). Its 28.7 MB wasm is split
  into parts (Pages limit is 25 MiB per file) and passed in as `ort.env.wasm.wasmBinary`.
- ORT 1.21 cannot run ISNet on WebGPU (MaxPool with ceil mode unsupported).

ISNet, measured 2026-11-20, Chrome 157, M5 Pro:
- **gpu: 150 to 300 ms per photo**, warm-up about 0.3 s. Four photos end to end: 1.35 s.
- **cpu: 5 to 7 s per photo.**
- GPU and CPU masks match on five test photos: mean difference at most 0.002, max 0.05, no pixel off by more
  than 0.1, no NaN.
- Quality (same for both): clean on people, pets in scenes, the tree. Hair edges blocky. Fails on close-ups
  over a soft blurred background (keeps the blur), and keeps blobs of busy backdrops (graffiti).
- Tested: every forced GPU failure finishes the photo on the CPU; photos added during the first download wait
  and then run; a dropped model part is retried.

BiRefNet on WebGPU (2026-11-21; numbers and side-by-sides in `docs/birefnet.md`). The onnx-community export needs
two rewrites, both in `scripts/birefnet.sh`:
  1. Concat ops with up to 1024 inputs and Split ops with 8, 16 and 32 outputs exceed the 10 storage
     buffers per shader. `scripts/narrow-onnx.py` rewrites them into trees of at most 6.
  2. The decoder's 20 deformable convs were spelled out as GatherND/Mul over all taps at once (392 MiB fp16
     tensors for the 7x7 at 256x256x64, `std::bad_alloc`). `scripts/deform-to-gridsample.py` replaces each with
     GridSample (bilinear, zeros, align_corners=1: what the export computes) a few kernel rows at a time
     (at most 64 MB a chunk), a strided Conv per chunk and a sum. Mask matches the original on CPU: mean
     difference 0.0005, nothing crosses 0.5. All 3820 nodes run on WebGPU.
- **gpu-birefnet: 280 to 300 ms per photo** (ISNet 86 ms), session 1.2 s, warm-up 0.3 to 0.7 s. GPU memory
  peak +3.0 GB (ISNet +1.0 GB), hence computers only.
- Quality: much better than ISNet on close-ups over a blurred background (cats, Larry: no leftover blur),
  busy backdrops (bicycle on graffiti: no blobs), see-through objects (headphone case), small subjects
  (yard cat), sky gaps in the tree. Hair about the same at 1024.

Quality on 1,073 public photos (2026-11-21, `docs/quality-1000.md`, harness in `scripts/quality/`): by eye, of 104
cut-outs, gpu-birefnet 85 good / 14 usable / 5 bad, ISNet 57 / 32 / 15. Mean IoU on 923 photos with real masks 0.960
vs 0.894. ISNet loses or fades parts of the subject; BiRefNet's flaw is which thing it keeps. Hair is a solid shape
on both; see-through objects fail on both. The harness copies the page's mask handling: change both together.
ISNet haze hardening (2026-11-22, `hardenHaze` in app.js, ISNet only): wide half see-through areas become solid at 0.3
or more, else clear. 102 photos better, 27 worse of 1,073; real-mask IoU 0.894 to 0.901. Rejected after measuring: an
automatic zoomed second pass (the 👎 retry done unasked), whole or edge band only: worse on both models at these photo
sizes (about 1.7 MP; untested on 12 MP). Both BiRefNet exports are fixed at 1024, so a smaller one for phones needs a new export.

Rejected:
- ISNet **small** (quint8): garbage (61% of pixels unsure).

Requirement from Kevin: 10 to 30 seconds per photo is unacceptable. Target a few seconds.

## First visit (2026-11-22)

Measured on production first: Lighthouse mobile LCP 1.2 s (simulated; 1.5 s with DevTools throttling), CLS 0, TBT 0,
score 100; desktop LCP 0.3 s. The model download never competed with first paint (it started after the h1 was drawn).
Time to the first cut-out is download-bound (116 MB on the CPU engine, 121 MB with BiRefNet): every second the download
starts later is about a second later for the first photo. So the trade-off is data (and iPhone memory) against speed:
- **At once**: returning visitors (`gb-model` in localStorage, set when an engine was ready: the files are cached for a
  year), kept photos, `?url=`, shares. `addSources` starts the model before it decodes or fetches anything.
- **Computers** (`any-pointer: fine`, no Save-Data): right after `load`, at idle. Same time to first cut-out as before.
- **Phones, tablets, Save-Data**: on intent only: pointer over, touch or focus on Choose photos / Paste, a drag over the
  page, a paste. A phone visitor who leaves without adding a photo downloads 0.2 MB instead of 116 MB. Cost: the dwell
  before the tap. Headless, 20 Mbps, photo added 8 s after load with the tap 4 s before: first cut-out at 58.8 s instead
  of 56.1 s (+5%); added at 20 s: 72 s instead of 53 s (someone who reads 16 s first waits for the download after).
  To go back to eager on phones, start the model in the `else` branch at the end of app.js.
- engine.js fetches the runtime wasm and the model in parallel (no measurable change at a fixed bandwidth; saves round trips).
- fflate (ZIPs) loads on first use; its static import held up app.js by about 0.7 s on slow 4G.
- Landing to grid is a View Transition (`landing()` in app.js, about 0.3 s): the headline fades out, the buttons and the
  wordmark glide, the cards fade in. For the one frame where the layout changes, `main` and the footer are hidden
  (`body.moving`), which keeps that step out of CLS (it was 0.20 on a computer, 0.37 on a phone; now 0, with and without
  the API). Reduced motion or no API: instant (one blank frame).

## Offline and install (2026-11-22)

Before: offline after a visit, nothing loaded (the page revalidates, `max-age=0`); the runtime and models sat in the
HTTP cache only (`immutable`, never in the Cache API). Now `src/sw.js` keeps the app on the device; online it behaves as
before. `scripts/build.mjs` writes its version list into sw.js (`"%SW%"`): every shell file with a hash, and the
runtime/model folders with their files.
- Shell (index, app.js, style.css, engine.js, workers, lazy modules, icons): network first, so deploys are live at once
  and freshen() can't loop; a per-build copy (`gb-shell-<build>`) answers when the network fails. An update copies
  unchanged files from the old copy by hash and refetches changed ones only if they were used. Install keeps only what
  the page loads anyway (index, app.js, style.css, early.js, font, favicon, manifest); the lazy modules (GIF, HEIC/TIFF/RAW,
  3D, zip, confetti, ~2.5 MB) are kept once the engine loads. Other pages go to `gb-pages` as visited.
- `rt/<version>/` and `m/<name>/`: cache first, one cache each (`gb-rt-1.31.1`, `gb-m-isnet-<sha8>`,
  `gb-m-birefnet-<hash>`), kept on use; activate deletes `gb-*` caches not in the list (never `share-inbox`). Downloads
  use `cache: "no-store"`, so the 116 MB (210 MB with both models) are stored once. Chrome's `only-if-cached` from the
  worker never hit what the page had put in the HTTP cache (tested), so it isn't used. Parts the engine fetched before the
  worker took over (a first visit where the model starts at once) are fetched again 5 s after the engine's last request
  (`whole()`), so the set is whole offline: up to one model's worth of extra download, once.
- Never cached: `/api/`, `/go/`, `/cap/`, `/version.txt`, `/ad.html`, `/sw.js`, non-GET. The share POST is handled as before.
- Stored responses keep the server's COOP/COEP/CSP, so offline the page is `crossOriginIsolated` and the CPU engine runs
  with its 3 thread workers (same speed as online).
- Manifest: `id`, icons with `purpose`, `icon-maskable-512.png` (favicon glyph full-bleed, inside the safe zone), two wide
  screenshots (launch kit) and one narrow (local build, three CC0 launch-kit photos + the Zazzle card), `categories`.
  No install prompt UI; browsers show their own. Chrome reports no installability errors.
Tested (`scripts/test/offline.mjs`, headless Chrome, server stopped and tab offline): reload, kept photos, a GPU photo
(BiRefNet), a CPU photo (worker isolated, threads), GIF, TIFF (formats worker), 3D ad previews, the share-target POST,
no requests leave; an existing visitor (old worker) works offline after one more online visit; an upgrade to a new
runtime folder deletes the old shell and runtime caches, keeps share-inbox, and the next load keeps the new runtime.
Not true offline: a computer that only ever ran the GPU engine has no CPU model, so a GPU failure offline fails the photo;
after a runtime or model upgrade, one online run first (the first page after an update may still use the old worker);
link fetching and ads clicks need the network. Not tested: Safari (iPhone or Mac), Firefox, Android install/share.
Safari also deletes site storage after 7 days without a visit. The Cache API shares quota with kept photos.

## Animated GIFs (2026-11-21)

An animated GIF is read with gifuct-js and written back with gifenc (both MIT, bundled into `dist/gif.mjs`, loaded
only when one is added). Every frame goes through the model (at most 100, or 16 on iPhones and without WebGPU:
longer GIFs keep every n-th frame and add up the delays) and the result is an animated GIF with on/off transparency
(soft edges become hard). The card plays it; Download and long-press save the GIF. No crop and no zoomed retry
for GIFs (👎 is a vote only). Measured: 10 frames at 360x540 in 5.7 s on the GPU engine.

## Formats and ZIPs (2026-11-22)

Anything the browser opens goes straight in. HEIC and TIFF on Chrome/Edge/Firefox and camera RAW everywhere go to
`src/formats.js` (bundled to `dist/formats.mjs`), a module Worker started per file and terminated after it:
- HEIC: libheif 1.23.5 (`libheif-js`, LGPL-3.0; `libheif.wasm` 1.4 MB served next to it with `libheif-LICENSE.txt`).
  Fetched only when a HEIC arrives on a browser without HEIC. 1920x2306 decodes in about 0.16 s.
- TIFF: UTIF (`utif2`, MIT), the largest colour picture in the file, EXIF orientation applied.
- RAW (DNG, CR2, CR3, NEF, ARW, RAF, ORF, RW2, ...): the largest baseline JPEG the camera stored inside, turned by the
  TIFF orientation, or by that JPEG's own EXIF orientation when it has one (iPhone ProRAW; Chrome turns it while decoding,
  so swapped sides mean it is done; portrait DNGs came out sideways before 2026-11-22). No developing. Older Canons store only about 2 MP (a 40D-era CR2 gave 1936x1288); a NEF gave
  the full 4256x2832. A RAW without a usable preview says so.
- ZIPs (picked, dropped or in a dropped folder) open with fflate's `unzipSync`: pictures by extension, in natural name
  order, skipping `__MACOSX` and dot-files, at most `MAX_BATCH` (the first by name; a name-only first pass picks them).
- Tested 2026-11-22 (headless Chrome, raw.pixls.us samples): CR2 1936x1288, NEF 6016x4000, iPhone 12 Pro DNG 3024x4032,
  Sony A7 III ARW 1616x1080 (the largest preview that camera stores), CR3 3408x2272; HEIC 6016x6016 in 1.9 s; LZW TIFF;
  a portrait HEIC (irot) comes out upright; broken HEIC/TIFF/fake DNG give an error card; mixed ZIP (nested folders, HEIC, CR2, TIFF, junk) in name order.

## Kept on the device (2026-11-21)

Kevin: leaving and coming back lost every photo. Cause: nothing was stored. The page is bfcache-eligible (headless Chrome
restores it on Back, IndexedDB open included), and desktop ad clicks already open a new tab, but bfcache drops big pages
and anything over 10 min, a reload or new visit starts empty, iPhones discard background tabs, and on phones
`window.open` after the share sheet can be blocked, which sends this tab to the partner.
Now every photo is kept in IndexedDB (`goodbye-bg`, stores `files` and `state`, keyed in grid order) until removed:
the original file, a preview (JPEG, PNG for see-through types), mask(s) as PNG, crop, vote, retry (and the first result),
the finished GIF. On load the cards come back in place without the model; unfinished photos run. FIFO (Kevin: "into
perpetuity, sane limit"): newest 50 photos within 1 GB on computers, 400 MB on phones; oldest out first; quota errors
drop the oldest and retry, then give up quietly. Removing a card deletes its copy. `navigator.storage.persist()` is
asked except in Firefox (it prompts there). Safari still clears site storage after 7 days without a visit.
Tested: headless Chrome (reload in a restarted browser, Back still from bfcache); iOS Simulator (iPhone 17, iOS 27): force-quitting Safari and reopening brings back both photos in order with the 👍 lit, a removed card stays gone, and Download on a restored photo shares the full-size PNG; an animated GIF comes back playing. Headless Chrome: a 👎 retry comes back with its first result (2048 merged mask, 1024 first), a 👎 after the reload still puts the first back, and that sticks; a GIF's Download after a reload is the GIF. Cap (headless Chrome, `?keepmax=N` / `?keepmb=N` lower it to test): 52 photos in two batches keep 50 (the two at the end of the grid go), about 2 MB a photo (97 MB for 50); with 5 MB, older photos go first and a single photo bigger than the whole limit is not kept (it used to push out everything). Restoring 50: cards up in 60 ms, all drawn in 1.0 s warm, 9.5 s on a cold start next to the CPU engine starting. Not tested: a real QuotaExceededError.

## UX decisions (2026-11-20, from Kevin)

- One screen, no scrolling. No double-tap zoom; pinch-zoom is allowed for accessibility (Kevin, 2026-11-20). Cards are square and sized to fit; a batch appears at
  once, in the order picked, and processing goes top-left first.
- Only the photo being worked on waves and shows a quip; waiting cards stay still. It is also the lightest photo on screen,
  with a soft light sweeping across it (2026-11-22; it used to be the darkest, so the eye went to the waiting ones). A failed
  card says which file it was. The wave and quip live in the card's bar (where
  Download appears when done), never on the photo: the subject is what stays (Kevin, 2026-11-21). Phone cards hide remove while working
  so the quip fits two lines; the smallest cards show only the wave. Footer: "Goodbye to N backgrounds since 2026."
- Kept photos load without jitter: `src/early.js` (first thing in <body>) reads the count `gb-kept` that app.js keeps in
  localStorage and starts the page in its photos layout, grid and footer hidden ("restoring") until layout() has sized the
  cards and the first kept photo is drawn (1.5 s failsafe; waiting for the whole first row hit it on a 6x-throttled phone). Restored cards don't pop. A stale count falls back to the landing.
  Jitter on reload, round 2 (2026-11-22, measured with a CDP script: layout-shift observer, per-frame rects, screencast):
  the partner list is written into app.js by the build (`%PARTNERS%`; partners.json stays as the fallback), because a
  fetched list arrived after the kept photos were laid out and the photo shrank from 1 cell to 4 (production, 300 ms
  latency: CLS 0.08 desktop, 0.24 phone). A layout before the masks were back reset `adsAt`, so restored ads waited the
  1.1 s reveal pause: now `adsStraight` puts them in the first visible frame, without their entrance (`.adcard.back`);
  the placeholder crossfades into the product. early.js modulepreloads render3d.mjs. The footer has a fixed width (the
  count text arriving moved its box). While photos are added, the footer used to land 34 px off and then move: hugFooter
  measured a card mid pop-in (scaled .92); it reads offsetHeight now. After: CLS 0 in every case (1 to 4 photos, desktop and phone, light and dark).
- Remove can be undone for 5 s (Kevin, 2026-11-21): a pill at the bottom, "Removed." + Undo, with a ring on the button that
  runs down (hover or focus pauses it; Cmd/Ctrl+Z works). The stored copy is deleted at once and rewritten on Undo; memory
  is freed when the time is up. One at a time: a second removal settles the first.
- Messages sit next to what they're about (Kevin, 2026-11-21), one look everywhere: `tell(msg, button)` in app.js shows one
  bubble pointing at the button (adding photos: Choose photos/Paste; a failed save: that Download; a failed zip: Download all),
  below it or above when there's no room. Trouble with one photo stays on its card. No bottom toast; zip progress is on the
  Download all button. Undo is the only thing at the bottom. With photos on screen, a message about adding photos sits
  above Choose photos/Paste (below, it covered the photos; 2026-11-22). Quips are the one place
  for playful text; everything else is plain and only what people need.
- Results are cropped to the subject by default (crop icon switches to the whole frame). 👎 retries zoomed in (merged into the first result outside the zoomed part, feathered where they meet; mergeRetry)
  on the subject, a second 👎 restores the first result. One vote per result (on phones, which never hover, 👍 👎 rest at full strength on a soft chip instead of grey at 70%, which read as disabled; still grey, for the palette): the chosen emoji stays lit and the
  other steps aside; a retry that finds a new result brings both back for it.
- Nothing ever overlaps the image. Every card control (crop, Download, 👍 👎, remove) lives in the bar below it.
- A finished cut-out is an `<img>`, so long-press on iPhone offers Save to Photos (a press swaps in the
  full-size PNG). Safari ignores `touch-action` for double taps, so app.js swallows a second
  tap within 350 ms.
- Hover effects only on devices with a real pointer (phones keep :hover after a tap).
- QA pass 2026-11-21 (details in git log):
  - 👎 zooms in only when the subject's padded box is under 80% of the photo; otherwise it is a vote only and its
    label says "Bad result" instead of "Bad result, try again" (most phone photos fill the frame).
  - The card bar drops controls so Download stays at least ~40 px wide (measured: 50+ px at every width). Bar order:
    crop, background, Download, 👍 👎, remove. What the bar has no room for moves into the background picker, so crop
    and remove are never lost (card widths): 218+ px everything; 186 to 217 no crop; 150 to 185 (a phone in portrait with
    1 to 3 photos, 165 px) no crop and no remove, 👍 👎 stay (Kevin, 2026-11-21: voting beats crop; moving remove into the
    picker was an overnight call on 2026-11-22, easy to reverse); 122 to 149 background, Download, remove; under 122
    background and Download. The picker drops swatches as it narrows (sage and light aqua under 218, black under 150, any colour
    under 122; measured to fit at 96 to 420 px with the sliders button).
    Cards without a picker (waiting, failed, animated GIFs) keep remove in the bar, in the background button's place, so
    Download doesn't move when a card finishes. A background or crop change on a phone builds the PNG ahead only when no
    batch or retry is running.
  - Short screens (height 520 px or less, a phone on its side): the wordmark sits left of the buttons (buttons go
    right), the privacy note is hidden, spacing tightens; the empty page shrinks the headline so the footer fits.
  - Download and Download all shimmer while a big PNG or the zip is built; repeat taps don't start it again. A failed
    save says so. Failed cards hide Download.
  - See-through inputs (PNG cut-outs, SVG logos) reach the model on white, or on black when the subject is light.
    SVGs are drawn at least 2048 px on their longest side.
  - Drags that start on the page (a cut-out dragged out) are ignored if dropped back on it.
  - Background (2026-11-22, remove.bg parity): a round button in the bar shows the cut-out's background (checkerboard =
    see-through, the default). Tapping it swaps the bar for a row of swatches at the same height (never over the photo,
    cards never resize): see-through, white, black, light aqua, sage, any colour (`<input type=color>`, live on the card).
    A tap on a swatch, outside the bar or Escape closes it. The card, Download, long press, Download all and the
    partner-ad save follow it; a solid background downloads as a JPG (0.92), see-through stays PNG. Ad card art and the
    cut-out sent to Zazzle stay see-through. Not for animated GIFs (no button). Kept in IndexedDB (`bg` in the state record).
    Your own photo as a background: not built (a second full-size image is the iPhone memory problem again).
  - Output options (2026-11-22, sellers, parity items 5 and 7): the picker's last button (sliders) swaps the swatches
    for a second row at the bar's height: Size (native select: Original, Square, 4:5, 16:9, Custom W x H up to 5000 px,
    4096 on iPhones), Margin (0, 4%, 10%, 20% of the subject's longer side; 4% is the old crop), a ground shadow toggle,
    All, WebP. Phones build the PNG ahead when the row closes, not per change; controls are 16 px on touch (iOS focus zoom). Narrow cards scroll the row sideways with a fade at the end (most used first). All off by default, and then
    the output is byte-for-byte the old one. Original never goes past the photo's edges; a ratio grows the canvas around
    the subject at the photo's own resolution (no resampling); Custom scales into exactly W x H; centred; the margin is
    see-through or the background colour (the cut-out is clipped to the subject's box). The shadow is a radial-gradient
    ellipse under the subject's bottom edge (no canvas filter: Safari). Output capped at 16 MP on iPhones, 64 elsewhere.
    WebP only where the browser encodes it (a 1x1 test at load; not tested in Safari), quality 0.9,
    keeps transparency. Card, Download, long press, Download all and the partner-ad save follow; the Zazzle upload and ad
    art stay the plain see-through crop (`fullBlob(it, true)`). All copies this photo's background and options to every
    other photo (not GIFs) and to photos added later in this visit (memory only, not across visits). Kept in IndexedDB
    (`out` in the state record). A see-through Square looks like Original on the card (the checkerboard fills the cell);
    with a colour the frame shows. No marketplace names in the UI: a see-through square doesn't meet Amazon's white rule.
  - Removing a photo frees its bitmap and moves any ad card showing it to another cut-out; focus goes to the next card.
- Buttons follow one small system in style.css (Kevin, 2026-11-21: "a mature design system"): spacing tokens
  `--s1..--s5` (4 px scale), heights `--h-sm/md/lg` (32/40/48), every button a size plus a variant (`.primary`,
  `.ghost`, plain). Set `--h`, `--px`, `--fs` instead of padding by hand. Whimsy: lift on hover, press on click.
- Palette: the cool side of Giant Goldfish only (aqua, deep teal, sage). No orange; red only for errors.
- Every claim on the site must stay true, including once ads run.
- Typical photos: phone camera rolls. People, kids, pets, products, cars. Busy scenes (car interiors, a
  small cat in a dark yard) are the model's weak spot; don't over-tune for them.

Anonymous counts the page sends (never photo data): 👍/👎 to `/api/rate`; crash reports to `/api/crash` (the page
leaves a note in localStorage while working on a photo; the next visit sends it if the tab died: step, engine,
device kind, photos done, megapixels); `/api/count` adds one to a single global number in D1
(`goodbye-bg-counter`, binding COUNTER) per finished cut-out, and every 100th gets confetti (`?confetti=1` forces it).
The footer: one GET `/api/count` on load (total + pace since a snapshot the row keeps 10 to 20 min back), then it grows
locally at that pace with random gaps, no more requests (Kevin: "one accurate-ish number on load, then contrived growth";
it can drift ahead of the real total). A visitor's own cut-out counts at once. Its line is always reserved, so it never moves
the cards. Shown from the first cut-out (Kevin, 2026-11-20); tapping it throws confetti. Kevin: tests count toward the total, never reset it.
Haptics: a light tick on result, crop, 👍/👎 and Download (Android vibrate; iOS 18+ hidden switch control).
iPhone 16 MP PNG crash (crash step "png", one report): a full-size PNG built on iOS now first stops the engine if it is
up and nothing is waiting for it (`fullBlob`, debug step `engine-png`); the export stays full size (the pages promise the
photo's own resolution). Untested on a real iPhone. iPhones shut the engine down once idle (its ~1.8 GB never shrinks; 7 to 8 photos in one tab crashed Safari).

Crash reports carry the page's last 20 steps (blob6; the same step names as `?debug=1`, kept in memory and in the
localStorage note, never sent unless something fails). Page views: the page's first GET `/api/count?view=1&from=<host>`
writes blob1 'view', blob2 device, blob3 referring host, blob4 country (no IP, no cookies). A Pages Function on `/`
was avoided: `_headers` (COEP/COOP, which give iPhones their threads) would not apply to its responses.

Ads (affiliate, Kevin 2026-11-20): `lib/partners.mjs` lists partners (Printful, Printify, Zazzle; Canva's program is closed to us); one shows only once its
`url` holds Kevin's affiliate link (`?adtest=1` shows them all, linking to home pages). Each card is a different product, never a repeat: a partner with
one variant (Printful, Printify) leaves the other reserved cells empty. The ad card fills a grid cell
that would otherwise be empty, after the batch is done, one partner per visit, marked "Ad", not in Download all, no
rating. Links go through `/go/<id>` (functions/go/[id].js), which counts the click (blob1 'adclick') and redirects;
a POST there counts the card being shown ('adseen'). EthicalAds would need the below-results slot (their rules forbid
ads inside the main content) and a proxy (Safari blocks their images under COEP require-corp).

Ads fill the grid (Kevin, 2026-11-20: "always fill the grid"): up to 3 photos are laid out as 4 cells (1 photo + 3 ads,
2 + 2, 3 + 1); more photos fill out their last row. The cells are reserved from the start so photos don't resize when
the ads arrive after the batch. Each card is a different variant (product), using a different cut-out when there are
several, and with 2+ cut-outs one card at a time changes cut-out every 4 s, round-robin (the old one dips out, the
next rises in), starting a full beat after ads come on screen; off when hidden or with reduced motion. Ads appear once the first cut-out is done; they wait 1.1 s after it (the cut-out gets the stage), come in one after another with a shimmering placeholder, and each product rises in once drawn (at least 0.45 s after its card), and the 3D code is fetched while the first photo is still being worked on. The label is centered. Products follow light/dark (black mug/shirt/tote in dark mode). Button names the product ("Put it on a mug", "Put it on a sticker", ...; it was "Make a mug" until the click took the cut-out along), outlined so Download stays the loud button.
Zazzle cards take the cut-out along (Create-a-Product, Kevin 2026-11-21: the click implies it, no interstitial;
the button says "Put it on a mug"; no footer line (Kevin: the hero says "cut out right on your device" where people decide); the remove.bg page's FAQ has the details). The click PUTs the cut-out shown on the card (at most 2400 px) to `/api/cap/<random key>` (R2
bucket goodbye-bg-cap, binding CAP) and opens `/go/zazzle?...&k=<key>`, which waits up to 10 s for it and redirects to
that product's template in Kevin's store goodbyebg with the image on it. Zazzle copies the image on the first fetch;
`/cap/<key>.png` deletes ours 20 s later (never fetched: gone after an hour; a lifecycle rule clears `cap/` after a
day). Upload fails or times out: the usual link, and computers still get the cut-out saved. GIFs and
`?zazzlecap=0` keep the old behaviour. Clicks that sent one count as 'adcap' next to 'adclick'. Templates, findings and
the open commission question (Ambassador agreement §2.1.3, asked of api.help@zazzle.com 2026-11-21) in
`docs/zazzle-cap.md`.

Products render in real 3D (src/render3d.js + Three.js 0.187.0, MIT, bundled by esbuild into dist/render3d.mjs,
~150 KB gzipped, loaded only when ads show): lathe-turned glazed mug with a real handle, die-cut vinyl sticker with a
peeling corner, canvas tote with straps front and back, flat-lay t-shirt with folds, porcelain ornament on a gold cap with a ribbon,
phone case with camera bump, throw pillow, die-cut acrylic keychain; physical materials, a studio
environment (RoomEnvironment, no download), a soft blob shadow (not a shadow map: on iPhones the shadow test failed and the
whole floor turned into a dark slab); each product sways slowly and leans toward a moving mouse, a few degrees at most; one shared WebGL context, ~20 ms a render. The 2D canvas
drawings in app.js are the fallback (crash step '3d-failed'). The mug camera centres on the body, not the handle.

Clicking a non-Zazzle ad card (or any card with `?zazzlecap=0`) saves the cut-out shown on it (the card keeps that photo as `artIt`), ready to upload on the partner's site: a normal download on computers; on phones the share sheet comes first (Safari won't save from a tab that went to the background), then the partner opens (tested in the iOS Simulator 2026-11-21).

Zazzle variant "mug" (the A): the visitor's first finished cut-out drawn on a mug in a canvas on the device
(drawMug in app.js: cylinder wrap column by column, shading, rim, shadow); drawing it uploads nothing; Zazzle gets
the image only when the card is clicked. Variant "b": "Put your cut-out on anything." Both go to zazzle.com/custom. `?adv=<v>` forces a
variant, `?adtest=1` shows partners without links.

Ad blockers hide the card (class names like `adcard`) and block `/go/` beacons; that is the visitor's choice, so we
don't work around it. A failing card is reported as crash step 'ad-failed' or 'mug-failed' (the mug falls back to the
emoji) instead of disappearing silently.

Product test: Zazzle's variants are products drawn from the visitor's cut-out (mug, sticker, shirt, tote; drawProduct
functions in app.js, light and dark) plus "b" (text card); one per visit. Button-wording test: "Make it on Zazzle" vs
"Make it", blob7 = c (0 or 1), independent of the product and the label.

Reading the ad A/B test (blob5 = variant): `SELECT blob1 AS kind, blob2 AS partner, blob5 AS variant, count() AS n
FROM goodbye_bg_ratings WHERE blob1 IN ('adseen','adclick') GROUP BY kind, partner, variant` (clicks / shows per variant;
expect a few hundred clicks per variant before trusting a difference). Label test, independent of the variant:
blob6 = 'ad' or 'sponsored' (the card's label, picked at random per visit); group by blob6 the same way.

Referrers (2026-11-22): blob3 was empty because the visits had none (typed, bookmarked, apps); a cross-site click does
send its host (tested). Launch links can carry `?ref=<tag>` (or `utm_source`): the page sends it as `from=ref.<tag>`
(a-z 0-9 . - only, 40 chars) and takes `ref`/`utm_*` out of the address bar so a shared link doesn't count again.
E.g. `https://goodbye.bg/?ref=hn` shows up as blob3 `ref.hn`. No change to functions/.

Reading views: `SELECT toDate(timestamp) AS day, blob2 AS device, blob3 AS from_site, count() AS views
FROM goodbye_bg_ratings WHERE blob1 = 'view' GROUP BY day, device, from_site ORDER BY day DESC`

Reading crashes: `SELECT blob2 AS engine, blob3 AS step, blob4 AS device, count() AS n, avg(double1) AS done,
avg(double2) AS mp FROM goodbye_bg_ratings WHERE blob1 = 'crash' GROUP BY engine, step, device`

Reading ratings (Workers Analytics Engine, dataset `goodbye_bg_ratings`; blob1 vote, blob2 engine,
blob3 first/retry, double1 ms, double2 megapixels):

    POST /accounts/<account>/analytics_engine/sql   (text/plain body)
    SELECT blob1 AS vote, blob2 AS engine, blob3 AS kind, count() AS n, avg(double1) AS ms
    FROM goodbye_bg_ratings GROUP BY vote, engine, kind ORDER BY n DESC

## Next steps

1. Mac Safari picks the GPU engine (BiRefNet); it works in Playwright's WebKit 27.2 (see Commands), not yet checked in
   Safari itself. A smaller GPU footprint might make WebGPU safe on iPhones again (try once ORT or the model changes).
2. BiRefNet untested on Windows and Linux GPUs and 8 GB Macs (3 GB GPU peak).
3. Not yet tested on real devices: Android share target, desktop "Open with", folder drops, live link fetching.

## Open items outside the code

- Domain goodbye.bg ordered at Netim (trustee service) on 2026-11-19, waiting on the trustee ID check.
  Nameservers are set to Cloudflare (`lou.ns.cloudflare.com`, `mira.ns.cloudflare.com`). When it registers:
  click "Check nameservers" on the zone, then add goodbye.bg as a custom domain on `goodbye-bg-git`.
- Git email: repo uses the GitHub noreply address. The first commit (aa3d4bd) still has the work email;
  fix with `git commit --amend --reset-author --no-edit && git push --force-with-lease` if wanted.
- License: repo is AGPL-3.0 because the ISNet model is AGPL. BiRefNet (MIT) only replaces it on computer GPUs;
  the CPU engine (iPhones, fallback) still needs ISNet, so the AGPL reason stays.
