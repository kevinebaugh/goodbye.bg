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
- `src/engine.js` the model worker. `scripts/narrow-onnx.py` (not in the build) rewrites wide ONNX ops for WebGPU.

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
Other test switches: `?engine=gpu|cpu`, `?threads=N`, `?nowarm=1`, `?gpufail=init|run|hang`.

Memory on phones (measured in the iOS Simulator, CPU engine): ISNet at 1024x1024 needs about 1.5 to
2 GB of wasm heap, mostly activations; it can't run smaller (a Concat inside is fixed to 1024). Asking
for only the first of its 13 outputs, freeing the model bytes after session creation, one PNG at a
time, and compositing the mask instead of copying pixels took 3 photos from 2.1 GB to 1.46 GB.
Safari caps photos at 16 MP (canvas limit); the original bitmap is kept and scaled when drawn.

One model, two engines. `src/engine.js` runs IMG.LY ISNet medium (fp16, AGPL, 88 MB) on ONNX Runtime Web
1.31.1 inside its own module Worker. `app.js` starts it with WebGPU when the adapter has `shader-f16`, else
with WebAssembly (4 threads). The GPU worker does a warm-up run before "Ready", which compiles the shaders
and proves the GPU works. If the GPU fails to start, fails a run, hangs (30 s warm-up, 15 s per run), or
returns NaN, the page terminates that worker and a CPU worker redoes the same photo. A separate worker is
required: a failed WebGPU run aborts ORT's wasm instance for the whole realm.

- `?engine=gpu` or `?engine=cpu` forces one (a forced gpu never falls back). `?gpufail=init|run|hang`
  simulates a broken GPU.
- Input (x-128)/256, output 0..1, fixed 1024x1024.
- Runtime is served from `rt/<version>/` (cached forever, so upgrades get new URLs). Its 28.7 MB wasm is split
  into parts (Pages limit is 25 MiB per file) and passed in as `ort.env.wasm.wasmBinary`.
- ORT 1.21 cannot run ISNet on WebGPU (MaxPool with ceil mode unsupported).

Measured 2026-11-20, Chrome 157, M5 Pro:
- **gpu: 150 to 300 ms per photo**, warm-up about 0.3 s. Four photos end to end: 1.35 s.
- **cpu: 5 to 7 s per photo.**
- GPU and CPU masks match on five test photos: mean difference at most 0.002, max 0.05, no pixel off by more
  than 0.1, no NaN.
- Quality (same for both): clean on people, pets in scenes, the tree. Hair edges blocky. Fails on close-ups
  over a soft blurred background (keeps the blur), and keeps blobs of busy backdrops (graffiti).
- Tested: every forced GPU failure finishes the photo on the CPU; photos added during the first download wait
  and then run; a dropped model part is retried.

Rejected:
- ISNet **small** (quint8): garbage (61% of pixels unsure).
- **BiRefNet lite** (MIT, better edges) on WebGPU, two blockers:
  1. Concat ops with up to 1024 inputs and Split ops with 8, 16 and 32 outputs exceed the 8 to 10 storage
     buffers per shader. `scripts/narrow-onnx.py` rewrites them into trees of at most 6 and fixes this.
  2. The decoder's deformable conv (7x7 taps at 256x256x64) creates 392 MiB fp16 tensors through
     GatherND and Mul. Total memory blows the 4 GB wasm32 heap (`std::bad_alloc`). Needs a rewrite of that
     block, a smaller input, or a different export. Not attempted.

Requirement from Kevin: 10 to 30 seconds per photo is unacceptable. Target a few seconds.

## UX decisions (2026-11-20, from Kevin)

- One screen, no scrolling. No double-tap zoom; pinch-zoom is allowed for accessibility (Kevin, 2026-11-20). Cards are square and sized to fit; a batch appears at
  once, in the order picked, and processing goes top-left first.
- Only the photo being worked on waves and shows a quip; waiting cards stay still. Quips are the one place
  for playful text; everything else is plain and only what people need.
- Results are cropped to the subject by default (crop icon switches to the whole frame). 👎 retries zoomed in
  on the subject, a second 👎 restores the first result. One vote per result: the chosen emoji stays lit and the
  other steps aside; a retry that finds a new result brings both back for it.
- Nothing ever overlaps the image. Every card control (crop, Download, 👍 👎, remove) lives in the bar below it.
- A finished cut-out is an `<img>`, so long-press on iPhone offers Save to Photos (a press swaps in the
  full-size PNG). Safari ignores `touch-action` for double taps, so app.js swallows a second
  tap within 350 ms.
- Hover effects only on devices with a real pointer (phones keep :hover after a tap).
- Palette: the cool side of Giant Goldfish only (aqua, deep teal, sage). No orange; red only for errors.
- Every claim on the site must stay true, including once ads run.
- Typical photos: phone camera rolls. People, kids, pets, products, cars. Busy scenes (car interiors, a
  small cat in a dark yard) are the model's weak spot; don't over-tune for them.

Anonymous counts the page sends (never photo data): 👍/👎 to `/api/rate`; crash reports to `/api/crash` (the page
leaves a note in localStorage while working on a photo; the next visit sends it if the tab died: step, engine,
device kind, photos done, megapixels); `/api/count` adds one to a single global number in D1
(`goodbye-bg-counter`, binding COUNTER) per finished cut-out, and every 100th gets confetti (`?confetti=1` forces it).
The footer shows that real total, ticking like a live counter but never ahead of it: it starts ~30 s of cut-outs behind
(GET `/api/count` returns the total and the pace since a snapshot the row keeps 10 to 20 min back) and each 30 s refresh
ticks one by one at uneven moments. A visitor's own cut-out counts at once. Its line is always reserved, so it never moves
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

Zazzle variant "mug" (the A): the visitor's first finished cut-out drawn on a mug in a canvas on the device
(drawMug in app.js: cylinder wrap column by column, shading, rim, shadow); nothing is uploaded, and Zazzle doesn't
receive the image. Variant "b": "Put your cut-out on anything." Both go to zazzle.com/custom. `?adv=<v>` forces a
variant, `?adtest=1` shows partners without links.

Ad blockers hide the card (class names like `adcard`) and block `/go/` beacons; that is the visitor's choice, so we
don't work around it. A failing card is reported as crash step 'ad-failed' or 'mug-failed' (the mug falls back to the
emoji) instead of disappearing silently.

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
2. Better quality than ISNet for close-ups and busy backgrounds: BiRefNet on WebGPU (see blockers above) or
   another model that fits WebGPU and a 4 GB heap.
3. Not yet tested on real devices: Android share target, desktop "Open with", folder drops, live link fetching.

## Open items outside the code

- Domain goodbye.bg ordered at Netim (trustee service) on 2026-11-19, waiting on the trustee ID check.
  Nameservers are set to Cloudflare (`lou.ns.cloudflare.com`, `mira.ns.cloudflare.com`). When it registers:
  click "Check nameservers" on the zone, then add goodbye.bg as a custom domain on `goodbye-bg-git`.
- Git email: repo uses the GitHub noreply address. The first commit (aa3d4bd) still has the work email;
  fix with `git commit --amend --reset-author --no-edit && git push --force-with-lease` if wanted.
- License: repo is AGPL-3.0 because the ISNet model is AGPL. If the engine moves off ISNet,
  the license can change.
