# goodbye.bg

Background remover that runs in the browser. Replacement for remove.bg, which shuts down
1 December 2026. Photos from the device never leave it. Kevin uses it often, so it must be
zero friction: fun copy and small animations are fine, delays and popups are not.

## Commands

    npm ci               # install (native packages: always install on the Mac, never copy node_modules)
    npm run dev          # build dist/ and serve at http://localhost:8788 with production headers
    npm run build        # build only
    npm run deploy       # manual fallback: wrangler pages deploy to project goodbye-bg-git

Deploys: Cloudflare Pages project `goodbye-bg-git` builds from GitHub. Every push to `main`
deploys; other branches get preview URLs (`<branch>.goodbye-bg-git.pages.dev`). No GitHub
Actions. The old upload-only project `goodbye-bg` can be deleted.

## Layout

- `src/` static site: `index.html`, `style.css`, `app.js` (everything), `sw.js` (Android share target),
  `manifest.webmanifest`, `_headers` (security headers, also used by local dev), `ad.html` (sandboxed ad slot, ads off)
- `functions/api/fetch.js` Cloudflare Pages Function. Fetches an image for a pasted link (same-origin only,
  30 MB cap, follows og:image for web pages). The only server code.
- `scripts/build.mjs` assembles `dist/`. `scripts/serve.mjs` local server that applies `_headers` and runs the function.
- `src/engine.js` the model worker. `weights/birefnet/` BiRefNet for the GPU engine, committed as 20 MiB parts with
  a manifest (size, sha256); the build copies it to `m/birefnet-<hash>/`. `scripts/birefnet.sh` regenerates it
  (download, then `deform-to-gridsample.py` and `narrow-onnx.py`; needs Python with onnx). Not part of the build.

## Rules

- Content-Security-Policy on the app page allows network only to its own origin. Keep it that way.
- No cookies, no third-party scripts or fonts on the app page. Only anonymous counts the page sends to its own
  server (votes, crashes, cut-outs, page views): no IP addresses, no identifiers.
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
Other test switches: `?engine=gpu|cpu`, `?model=isnet|birefnet`, `?threads=N`, `?nowarm=1`, `?gpufail=init|run|hang`.

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
- Votes and crash reports call the engines `gpu-birefnet`, `gpu` (ISNet) and `cpu` (ISNet).

The GPU worker does a warm-up run before "Ready", which compiles the shaders and proves the GPU works. If the GPU fails to start, fails a run, hangs (30 s warm-up, 15 s per run), or
returns NaN, the page terminates that worker and a CPU worker redoes the same photo. A separate worker is
required: a failed WebGPU run aborts ORT's wasm instance for the whole realm.

- `?engine=gpu` or `?engine=cpu` forces one (a forced gpu never falls back). `?gpufail=init|run|hang`
  simulates a broken GPU.
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

Rejected:
- ISNet **small** (quint8): garbage (61% of pixels unsure).

Requirement from Kevin: 10 to 30 seconds per photo is unacceptable. Target a few seconds.

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
  TIFF orientation. No developing. Older Canons store only about 2 MP (a 40D-era CR2 gave 1936x1288); a NEF gave
  the full 4256x2832. A RAW without a usable preview says so.
- ZIPs (picked, dropped or in a dropped folder) open with fflate's `unzipSync`: pictures by extension, in natural name
  order, skipping `__MACOSX` and dot-files, at most `MAX_BATCH`.

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
Tested: headless Chrome (reload in a restarted browser, Back still from bfcache); iOS Simulator (iPhone 17, iOS 27): force-quitting Safari and reopening brings back both photos in order with the 👍 lit, a removed card stays gone, and Download on a restored photo shares the full-size PNG. Not tested: 👎 retries and GIFs after a restore, the size cap.

## UX decisions (2026-11-20, from Kevin)

- One screen, no scrolling. No double-tap zoom; pinch-zoom is allowed for accessibility (Kevin, 2026-11-20). Cards are square and sized to fit; a batch appears at
  once, in the order picked, and processing goes top-left first.
- Only the photo being worked on waves and shows a quip; waiting cards stay still. Quips are the one place
  for playful text; everything else is plain and only what people need.
- Results are cropped to the subject by default (crop icon switches to the whole frame). 👎 retries zoomed in (merged into the first result outside the zoomed part, feathered where they meet; mergeRetry)
  on the subject, a second 👎 restores the first result. One vote per result: the chosen emoji stays lit and the
  other steps aside; a retry that finds a new result brings both back for it.
- Nothing ever overlaps the image. Every card control (crop, Download, 👍 👎, remove) lives in the bar below it.
- A finished cut-out is an `<img>`, so long-press on iPhone offers Save to Photos (a press swaps in the
  full-size PNG). Safari ignores `touch-action` for double taps, so app.js swallows a second
  tap within 350 ms.
- Hover effects only on devices with a real pointer (phones keep :hover after a tap).
- QA pass 2026-11-21 (details in git log):
  - 👎 zooms in only when the subject's padded box is under 80% of the photo; otherwise it is a vote only and its
    label says "Bad result" instead of "Bad result, try again" (most phone photos fill the frame).
  - The card bar drops controls so Download stays at least ~40 px wide (card widths): 187+ px everything; 154 to 186 px
    no crop toggle (a phone in portrait with 1 to 3 photos is 165 px: Kevin, 2026-11-21, voting beats crop there; results
    stay cropped to the subject); 133 to 153 px crop but no 👍 👎; 132 px and under (a dozen photos) Download and remove only.
  - Short screens (height 520 px or less, a phone on its side): the wordmark sits left of the buttons (buttons go
    right), the privacy note is hidden, spacing tightens; the empty page shrinks the headline so the footer fits.
  - Download and Download all shimmer while a big PNG or the zip is built; repeat taps don't start it again. A failed
    save says so. Failed cards hide Download.
  - See-through inputs (PNG cut-outs, SVG logos) reach the model on white, or on black when the subject is light.
    SVGs are drawn at least 2048 px on their longest side.
  - Drags that start on the page (a cut-out dragged out) are ignored if dropped back on it.
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
iPhones shut the engine down once idle (its ~1.8 GB never shrinks; 7 to 8 photos in one tab crashed Safari).

Crash reports carry the page's last 20 steps (blob6; the same step names as `?debug=1`, kept in memory and in the
localStorage note, never sent unless something fails). Page views: the page's first GET `/api/count?view=1&from=<host>`
writes blob1 'view', blob2 device, blob3 referring host, blob4 country (no IP, no cookies). A Pages Function on `/`
was avoided: `_headers` (COEP/COOP, which give iPhones their threads) would not apply to its responses.

Ads (affiliate, Kevin 2026-11-20): `lib/partners.mjs` lists partners (Printful, Printify, Zazzle; Canva's program is closed to us); one shows only once its
`url` holds Kevin's affiliate link (`?adtest=1` shows them all, linking to home pages). The ad card fills a grid cell
that would otherwise be empty, after the batch is done, one partner per visit, marked "Ad", not in Download all, no
rating. Links go through `/go/<id>` (functions/go/[id].js), which counts the click (blob1 'adclick') and redirects;
a POST there counts the card being shown ('adseen'). EthicalAds would need the below-results slot (their rules forbid
ads inside the main content) and a proxy (Safari blocks their images under COEP require-corp).

Ads fill the grid (Kevin, 2026-11-20: "always fill the grid"): up to 3 photos are laid out as 4 cells (1 photo + 3 ads,
2 + 2, 3 + 1); more photos fill out their last row. The cells are reserved from the start so photos don't resize when
the ads arrive after the batch. Each card is a different variant (product), using a different cut-out when there are
several, and with 2+ cut-outs one card at a time changes cut-out every 4 s, round-robin (the old one dips out, the
next rises in), starting a full beat after ads come on screen; off when hidden or with reduced motion. Ads appear once the first cut-out is done; they wait 1.1 s after it (the cut-out gets the stage), come in one after another with a shimmering placeholder, and each product rises in once drawn (at least 0.45 s after its card), and the 3D code is fetched while the first photo is still being worked on. The label is centered. Products follow light/dark (black mug/shirt/tote in dark mode). Button names the product ("Make a mug", "Make a sticker", ...), outlined so Download stays the loud button.
Zazzle's Create-a-Product API could pre-print the cut-out on the product, but it needs the image at a public URL, so
only as an explicit per-photo opt-in that updates the "never uploaded" copy. Not built.

Products render in real 3D (src/render3d.js + Three.js 0.187.0, MIT, bundled by esbuild into dist/render3d.mjs,
~150 KB gzipped, loaded only when ads show): lathe-turned glazed mug with a real handle, die-cut vinyl sticker with a
peeling corner, canvas tote with straps front and back, flat-lay t-shirt with folds, porcelain ornament on a gold cap with a ribbon,
phone case with camera bump, throw pillow, die-cut acrylic keychain; physical materials, a studio
environment (RoomEnvironment, no download), a soft blob shadow (not a shadow map: on iPhones the shadow test failed and the
whole floor turned into a dark slab); each product sways slowly and leans toward a moving mouse, a few degrees at most; one shared WebGL context, ~20 ms a render. The 2D canvas
drawings in app.js are the fallback (crash step '3d-failed'). The mug camera centres on the body, not the handle.

Clicking an ad card also saves the cut-out shown on it (the card keeps that photo as `artIt`), ready to upload on the partner's site: a normal download on computers; on phones the share sheet comes first (Safari won't save from a tab that went to the background), then the partner opens (tested in the iOS Simulator 2026-11-21).

Zazzle variant "mug" (the A): the visitor's first finished cut-out drawn on a mug in a canvas on the device
(drawMug in app.js: cylinder wrap column by column, shading, rim, shadow); nothing is uploaded, and Zazzle doesn't
receive the image. Variant "b": "Put your cut-out on anything." Both go to zazzle.com/custom. `?adv=<v>` forces a
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

1. Mac Safari still picks the GPU engine; not tested there. A smaller GPU footprint might make WebGPU
   safe on iPhones again (try once ORT or the model changes).
2. BiRefNet untested on Safari's WebGPU, Windows and Linux GPUs, and 8 GB Macs (3 GB GPU peak).
3. Not yet tested on real devices: Android share target, desktop "Open with", folder drops, live link fetching.

## Open items outside the code

- Domain goodbye.bg ordered at Netim (trustee service) on 2026-11-19, waiting on the trustee ID check.
  Nameservers are set to Cloudflare (`lou.ns.cloudflare.com`, `mira.ns.cloudflare.com`). When it registers:
  click "Check nameservers" on the zone, then add goodbye.bg as a custom domain on `goodbye-bg-git`.
- Git email: repo uses the GitHub noreply address. The first commit (aa3d4bd) still has the work email;
  fix with `git commit --amend --reset-author --no-edit && git push --force-with-lease` if wanted.
- License: repo is AGPL-3.0 because the ISNet model is AGPL. BiRefNet (MIT) only replaces it on computer GPUs;
  the CPU engine (iPhones, fallback) still needs ISNet, so the AGPL reason stays.
