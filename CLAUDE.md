# goodbye.bg

Background remover that runs in the browser. Replacement for remove.bg, which shuts down
1 December 2026. Photos are cut out on the device, never uploaded for it (a click on a Zazzle product ad takes
that one cut-out along, see Ads). Kevin uses it often, so it must be
zero friction: fun copy and small animations are fine, delays and popups are not.

Measurements and the history behind the decisions below: `docs/history.md`. Other docs: `docs/birefnet.md`,
`docs/quality-1000.md`, `docs/quality-products.md`, `docs/platforms-and-phone-model.md`, `docs/removebg-parity.md`,
`docs/zazzle-cap.md`, `docs/ads.md`, `docs/seo.md`, `docs/launch-drafts.md`, `docs/domain-cutover.md`, `docs/i18n.md`.

## Commands

    npm ci               # install (native packages: always install on the Mac, never copy node_modules)
    npm run dev          # build dist/ and serve at http://localhost:8788 with production headers
    npm run build        # build only
    npm run deploy       # manual fallback: wrangler pages deploy to project goodbye-bg-git
    npm run test         # smoke tests (about 40 s): build, serve, headless Chrome; run before pushing
    node scripts/test/offline.mjs   # offline/install test (about 1.5 min); its upgrade step edits dist/: rebuild after
    npm run test:x       # WebKit (computer + iPhone) and Firefox via Playwright (about 2 min); once: npx playwright install webkit firefox

Deploys: Cloudflare Pages project `goodbye-bg-git` builds from GitHub. Every push to `main`
deploys; other branches get preview URLs (`<branch>.goodbye-bg-git.pages.dev`). No GitHub
Actions. The old upload-only project `goodbye-bg` can be deleted.

## Layout

- `src/` static site: `index.html`, `style.css`, `app.js` (the page), `early.js` (first thing in <body>: starts a reload
  with kept photos in its photos layout), `engine.js` (model worker), `formats.js` (HEIC/TIFF/RAW worker), `gif.js`,
  `render3d.js` (3D ad products), `sw.js` (offline caches, Android share target), `manifest.webmanifest`, `_headers`
  (security headers, also used by local dev), `_redirects` (`/share` to `/` when the service worker missed it),
  `404.html` (no scripts), `ad.html` (sandboxed ad slot, ads off), `remove-bg-alternative/` and
  `how-to-remove-background/` (SEO pages, `docs/seo.md`), the same two under `de/ es/ fr/ pt-br/ id/`,
  `bulk-background-remover/` and `remove-background-from-gif/` (SEO pages, English
  only so far; a text page is any folder whose index.html holds `<!--%HREFLANG%-->`, and it needs its CSP line in
  `_headers`, a sitemap entry and a place in the smoke test's lists; the build minifies the page's own scripts and
  styles, `NO_MINIFY=1` keeps them readable), `i18n.js` (UI
  strings in other languages, inlined into early.js by the build; see Languages).
- `functions/` Cloudflare Pages Functions: `api/fetch.js` (image for a pasted link: same-origin only, 30 MB cap, follows
  og:image), `api/rate.js`, `api/crash.js`, `api/count.js`, `api/diag.js`, `api/cap/[key].js` and `cap/[file].js`
  (Zazzle hand-off), `go/[id].js` (ad redirect and counts).
- `lib/partners.mjs` (ad partners and Zazzle templates), `lib/test-traffic.mjs` (drops test traffic).
- `scripts/build.mjs` assembles `dist/`. `scripts/serve.mjs` local server: applies `_headers`, runs the functions,
  mirrors Pages routing; passes `/api/count` to the live site and never writes analytics.
- `weights/birefnet/` BiRefNet, committed as 20 MiB parts with a manifest (size, sha256); the build copies it to
  `m/birefnet-<hash>/`. `scripts/birefnet.sh` regenerates it (download, then `deform-to-gridsample.py` and
  `narrow-onnx.py`; needs Python with onnx). Not part of the build.
- `README.md` for people who click Source.

## Rules

- Content-Security-Policy on the app page allows network only to its own origin. Keep it that way.
- No cookies, no third-party scripts or fonts on the app page. Only anonymous counts the page sends to its own
  server (votes, crashes, cut-outs, page views): no IP addresses, no identifiers. The one image the page uploads is
  the cut-out on a clicked Zazzle ad (functions/api/cap): R2, random one-time key, deleted once Zazzle has it.
- Dark/light follows the system. No toggle.
- Copy: plain, short, active voice. Kevin, 2026-11-22: "Shorter is always better as long as understanding is preserved.
  Make every word and every character count." Try the shortest version of any string first, in all six languages. Quips are the one place for playful text; everything else is plain and only what
  people need.
- Every claim on the site must stay true, including once ads run.
- Palette: the cool side of Giant Goldfish only (aqua, deep teal, sage). No orange; red only for errors.
- Requirement from Kevin: 10 to 30 seconds per photo is unacceptable. Target a few seconds.
- Typical photos: phone camera rolls. People, kids, pets, products, cars. Busy scenes (car interiors, a
  small cat in a dark yard) are the model's weak spot; don't over-tune for them.

## Engines

Two models (BiRefNet at two sizes), three tiers. `src/engine.js` runs ONNX Runtime Web 1.31.1 in its own module Worker;
the page sends RGBA pixels at 1024x1024, the worker builds its model's input (BiRefNet 640 boxes it down to 640 and
scales the mask back up).
- **BiRefNet lite** (MIT, fp16, 93 MB after the rewrite) on WebGPU, computers only (`any-pointer: fine`): 280 to 300 ms
  a photo, GPU peak +3.0 GB. ImageNet mean/std in, logits out (the worker applies the sigmoid).
  `refineEdge` in app.js (`docs/mask-postprocess.md`; `?pp=0` off, skipped for ISNet and GIF frames): a colour guided
  filter redraws the mask from the photo in soft zones wider than 3 px (hair, fur, fluff); crisp edges stay. Runs on
  BiRefNet 640 too. Held-out half: 12 photos better, 0 worse (640: 8 and 0). Streams rows (12 MB at most); 0.27 s median at 6x CPU throttling, 45 ms unthrottled.
- **ISNet medium** (IMG.LY, fp16, AGPL, 88 MB) on WebGPU: 150 to 300 ms a photo, GPU peak +1.0 GB. Input (x-128)/256,
  output 0..1. `hardenHaze` in app.js (ISNet only; `?haze=0` off): wide half see-through areas become solid at 0.3 or
  more, else clear.
- **BiRefNet lite at 640 on the CPU** (WebAssembly, 4 threads; 2 on iPhones; `weights/birefnet640/`, 95 MB, made by
  `scripts/birefnet640.sh`): the CPU engine since 2026-11-22 (`docs/phone-birefnet640.md`). Headless Chrome with the
  iPhone UA: 2.9 to 3.7 s inferred, peak about 50 MB above ISNet (under 2.0 GB). Loses thin legs, cables and frames
  that ISNet keeps (`docs/quality-products.md`), so a 👎 on its result runs **ISNet 1024 on the whole photo** (one
  engine at a time: the 640 worker goes, 3 s gap on iPhones; `retryModel`). `?model=isnet` runs ISNet on the CPU as
  before. A 👎 during a batch cuts in line (Kevin, 2026-11-22): the photo on the engine finishes, the batch waits
  (`cutIn`, `inPhoto`), about 15 s more on an iPhone. Kevin's iPhone (2026-11-22, Safari in front): 5.3 to 8.3 s a
  photo, 24 MP photos, 8 + 2 in a tab and a 👎 right after a batch, no crash (before `refineEdge` ran on 640: not
  timed on a phone yet). Watch crashes by engine and 👎 on `cpu-birefnet640` for a week.
- WebGPU is used when the adapter has `shader-f16`. iPhones and iPads always use the CPU engine (2 threads: 4 threads peaked at 2.1 GB in the Simulator and crashed an
  18.75 MP photo half the time on Kevin's iPhone; 2 threads peak about 300 MB lower; 5.0 s a photo). WebGPU crashed
  the tab there one try in two (2026-11-20). Safari needs `Cross-Origin-Embedder-Policy: require-corp` (it ignores
  `credentialless`) to be cross-origin isolated, which threads need.
- One photo on the engine at a time (`infer` queues in the page): a 👎 retry during a batch used to send a second run
  to the same worker; on the GPU one never came back, which read as a GPU failure (BiRefNet off for 30 days) and left
  the batch waiting forever. A job whose engine was stopped under it (`stopped`) runs on the next engine, no step-down.
- Votes and crash reports call the engines `gpu-birefnet`, `gpu` (ISNet), `cpu-birefnet640` and `cpu` (ISNet: a 👎
  retry on a 640 result, or `?model=isnet`). A vote names the engine
  that made that photo's mask, even after a fallback.

GPU gate (for weak GPUs; `docs/platforms-and-phone-model.md`, decision 3). The GPU worker does a warm-up run before
"Ready" (compiles shaders, proves the GPU works). A failure terminates that worker and the next tier redoes the same
photo; a separate worker is required because a failed WebGPU run aborts ORT's wasm instance for the whole realm.
- BiRefNet steps down to ISNet on the GPU when its start fails, a run fails or its worker dies (out of GPU memory looks
  like one of these), its start (session and warm-up, after the download) takes over 10 s, or its first photo over 2 s.
  The time limits count only while the page is in view; hidden, only the hang limit counts. A slow first photo keeps
  its result. ISNet on the GPU steps down to the CPU on a failure, NaN, or a hang (30 s warm-up, 15 s a run).
- A failure before the worker has the model (download, offline, worker script) is not a GPU failure: "Could not load".
- Computers reporting `navigator.deviceMemory` under 8 start on ISNet on the GPU.
- The outcome is kept in localStorage `gb-gpu` (tier, user agent, runtime/model version, date); a browser update, new
  runtime or model, or 30 days start over. Never written under `?engine=`, `?model=` or `?gpufail=`.
- Each step down goes to `/api/crash` at once as `birefnet-start-failed`, `birefnet-run-failed`, `birefnet-slow-start`,
  `birefnet-slow-run`, `gpu-start-failed` or `gpu-run-failed`. Tested in headless Chrome only.

Runtime is served from `rt/<version>/` (cached forever, so upgrades get new URLs). Its 28.7 MB wasm is split into parts
(Pages limit is 25 MiB per file) and passed in as `ort.env.wasm.wasmBinary`.

BiRefNet export rewrites (`scripts/birefnet.sh`; details in `docs/history.md`): `narrow-onnx.py` splits wide
Concat/Split ops (10 storage buffers per shader); `deform-to-gridsample.py` replaces the 20 deformable convs with
chunked GridSample + Conv (mean mask difference 0.0005). All 3820 nodes run on WebGPU.

Quality (`docs/quality-1000.md`; `scripts/quality/` copies the page's mask handling: change both together): real-mask
IoU on 923 photos 0.960 BiRefNet vs 0.894 ISNet (0.901 with haze hardening); by eye of 104, bad 5 vs 15.

Rejected: ISNet **small** (quint8, 61% of pixels unsure); BiRefNet on the CPU (10 s, 6.7 GB); an automatic zoomed
second pass (worse on both models).

Test switches: `?engine=gpu|cpu` (a forced gpu never falls back to the CPU; BiRefNet can still step down to ISNet),
`?model=isnet|birefnet` (`birefnet` turns the gate off), `?threads=N`, `?nowarm=1`,
`?gpufail=init|run|hang` (every GPU tier) or `birefnet-init|birefnet-oom|birefnet-slow|birefnet-slowrun` (BiRefNet only),
`?haze=0`, `?pp=0`, `?keepmax=N`, `?keepmb=N`, `?maxbatch=N`, `?adtest=1`, `?adpartner=zazzle|printful|printify`, `?adv=<v>`,
`?zazzlecap=0`, `?confetti=1`, `?debug=1`, `?ads=0` (no ad cards, for screenshots; `?adtest=0` no longer counts as on).
Reports to `/api/crash` start their trail with the GPU's maker and family as the browser names them (`gpu apple metal-3`),
when the page asked for a GPU: tells hardware apart in GPU failures, names no device.
The hero's second line has a phone version without "Drop" (`.sub.touch`, shown for `pointer: coarse`).

Debugging on phones: `?debug=1` sends step names and numbers (never photo data) to `/api/diag`, which
only writes to the Functions log. Read it with `npx wrangler pages deployment tail <deployment-id>
--project-name goodbye-bg-git --format json` (find the ID with `wrangler pages deployment list`).

## Memory on phones

Measured in the iOS Simulator, CPU engine: ISNet at 1024x1024 needs about 1.5 to 2 GB of wasm heap, mostly
activations; it can't run smaller (a Concat inside is fixed to 1024). Asking for only the first of its 13 outputs,
freeing the model bytes after session creation, one PNG at a time, and compositing the mask instead of copying pixels
took 3 photos from 2.1 GB to 1.46 GB. Safari caps photos at 16 MP (canvas limit); the original bitmap is kept and
scaled when drawn.
- iPhones shut the engine down once idle (its ~1.8 GB never shrinks; 7 to 8 photos in one tab crashed Safari).
  `startEngine` waits until 3 s after that shutdown (`engineFree`) so two engines never overlap (measured 3.3 to
  4.6 GB in Chrome without the wait). Untested on a real iPhone; if Safari frees more slowly, keep the engine a few
  seconds after a batch.
- A full-size PNG on iOS first stops an idle engine (`fullBlob`, debug step `engine-png`; one crash report at step
  "png"). The export stays full size. Untested on a real iPhone.

## First visit

Lighthouse mobile 100 (LCP 1.2 s, CLS 0, TBT 0). Time to the first cut-out is download-bound (116 MB on the CPU engine,
121 MB with BiRefNet). When the model starts downloading:
- **At once**: returning visitors (`gb-model` in localStorage), kept photos, `?url=`, shares.
- **Computers** (`any-pointer: fine`, no Save-Data): right after `load`, at idle.
- **Phones, tablets**: the first touch or scroll anywhere, or 3 s of the page being visible (count paused while hidden)
  when `navigator.connection.effectiveType` is 4g or the API is missing (iPhones, Firefox); slower connections only
  on the touch. A visitor who leaves
  within 3 s without touching downloads 0.5 MB, not 116 MB; one who stays 10 s, 17 MB at 20 Mbps. Tap at 16 s, photo
  4 s later, 20 Mbps, CPU engine: first cut-out at 55.5 s (intent-only 68.5 s; headless Chrome, 2026-11-22).
- **Save-Data** (any device): on intent only (pointer over, touch or focus on
  Choose photos / Paste, a drag, a paste). Code: the `else` branch at the end of app.js.
- Landing to grid is a View Transition (`landing()`); `body.moving` hides the one changing frame (CLS 0).

## Formats

Anything the browser opens goes straight in. HEIC and TIFF on Chrome/Edge/Firefox and camera RAW everywhere go to
`src/formats.js` (bundled to `dist/formats.mjs`), a module Worker started per file and terminated after it:
- HEIC: libheif 1.23.5 (`libheif-js`, LGPL-3.0; `libheif.wasm` 1.4 MB served with `libheif-LICENSE.txt`), fetched only
  when a HEIC arrives on a browser without HEIC.
- TIFF: UTIF (`utif2`, MIT), the largest colour picture in the file, EXIF orientation applied.
- RAW (DNG, CR2, CR3, NEF, ARW, RAF, ORF, RW2, ...): the largest baseline JPEG the camera stored inside, turned by the
  TIFF orientation or that JPEG's own EXIF orientation (iPhone ProRAW). No developing; older Canons store only about 2 MP.
  A RAW without a usable preview says so.
- ZIPs (picked, dropped or in a dropped folder): fflate, pictures by extension in natural name order, skipping
  `__MACOSX` and dot-files, the first `MAX_BATCH` by name.
- Animated GIFs: gifuct-js in, gifenc out (MIT, `dist/gif.mjs`, loaded when one is added). Every frame goes through the
  model, at most 100, or 16 when the CPU engine runs them (longer GIFs keep every n-th frame and add up the delays).
  On/off transparency (soft edges become hard). The card plays it; Download and long-press save the GIF. No crop, no
  zoomed retry (👎 is a vote only). 10 frames at 360x540 in 5.7 s on the GPU.
- See-through inputs reach the model on white, or on black when the subject is light. SVGs are drawn at 2048 px+.
- Names: a file keeps "#" and "?" in its name (only a link loses its query), cut at 80 whole characters (`baseName`).
- A file that can't be opened never gets a card; one bubble at Choose photos names them. A photo the model fails on
  keeps its card.

Batches: `MAX_BATCH` per drop, paste, folder or ZIP: 100 on computers (fine pointer, not iOS, `deviceMemory` 8 or
unknown), 50 otherwise (about 10 MB of page memory per finished photo). Download all streams its zip.

## Kept photos

Kevin: leaving and coming back lost every photo. Every photo is kept in IndexedDB (`goodbye-bg` version 2, stores
`files`, `state`, and `backs`, emptied since backgrounds went, keyed in grid order as `-time x 1024 + n`) until removed: the original file, a preview (JPEG,
PNG for see-through types), mask(s) as PNG, vote, retry (and the first result), the finished GIF. On load the cards come back in place without the model; unfinished photos run. FIFO (Kevin: "into
perpetuity, sane limit"): newest 50 photos (`KEEP_MAX`; photos past it aren't written) within 1 GB on computers, 400 MB
on phones; oldest out first; a photo bigger than the whole limit isn't kept; quota errors drop the oldest and retry,
then give up quietly.
`navigator.storage.persist()` is asked except in Firefox (it prompts there). Safari clears site storage after 7 days
without a visit; private windows refuse Blobs, so nothing is kept there.
- Reload without jitter: early.js reads `gb-kept` and starts in the photos layout, hidden ("restoring") until the
  first kept photo is drawn (1.5 s failsafe). The partner list is built into app.js (`%PARTNERS%`) so the first layout
  knows the ad cells; restored ads come straight in (`adsStraight`). CLS 0.

## UX decisions

- One screen, no scrolling. No pull-to-refresh, no double-tap zoom, no pinch-zoom on touch screens (Kevin, 2026-11-22:
  "Scroll to refresh and pinch to zoom seem to be back 👎"; this replaces 2026-11-20's "pinch-zoom is allowed").
  `touch-action: pan-x pan-y`, `overscroll-behavior: none`, and early.js cancels Safari's gesture events. Cards are
  square and sized to fit; a batch appears at once, in the order picked, and processing goes top-left first. The grid
  fits down to 84 px cards (a phone in portrait fits 12, 3 x 4, with Download all in sight); past that it scrolls and
  Download all sticks to its bottom edge. The grid uses the window's width (up to 1800 px).
- Only the photo being worked on waves and shows a quip; waiting cards stay still. It is the lightest photo on screen,
  with a soft light sweeping across it. The wave and quip live in the card's bar (where
  Download appears when done), never on the photo: the subject is what stays (Kevin, 2026-11-21). Phone cards (165 px
  and under) hide remove while working so the quip gets the room; the smallest cards show only the wave. A quip can
  never make the bar taller (a third line borrows the bar's padding; `.say` has a `max-height`). A failed card says which
  file it was, on an opaque panel, and hides Download.
- Results are always cropped to the subject (no crop toggle; GIFs keep the whole frame). 👎 retries zoomed in on the
  subject (merged into the first result outside the zoomed part, feathered where they meet; `mergeRetry`), only when
  the subject's padded box is under 80% of the photo; otherwise it is a vote only, labelled "Bad result" instead of
  "Bad result, try again". A 640 result's 👎 always runs ISNet on the whole photo instead. A second 👎 restores the first result. One vote per result: the chosen emoji stays lit and
  the other steps aside; a retry that finds a new result brings both back.
- Nothing ever overlaps the image. Every card control (crop, Download, 👍 👎, remove) lives in the bar below it.
- A finished cut-out is an `<img>`, so long-press on iPhone offers Save to Photos (a press swaps in the
  full-size PNG). Safari ignores `touch-action` for double taps, so app.js swallows a second tap within 350 ms.
- Hover effects only on devices with a real pointer (phones keep :hover after a tap).
- Remove can be undone for 5 s (Kevin, 2026-11-21): a pill at the bottom, "Removed." + Undo, in the footer's place
  (the footer fades out), with a ring that runs down (hover or focus pauses it; Cmd/Ctrl+Z works). The deadline is a
  JS timer (`UNDO_MS`). `placeUndo` puts it where the footer will be once the cards left are laid out again, and again
  on every layout (a turned phone, a resized window); with no footer on screen (a phone on its side, a packed grid) it
  sits at the bottom edge, over whatever is there. Undo also finishes a photo removed mid-run. One at a time. Removing frees the bitmap, moves any
  ad card showing it to another cut-out, and focuses the next card.
- Messages sit next to what they're about (Kevin, 2026-11-21), one look everywhere: `tell(msg, button)` in app.js shows one
  bubble pointing at the button (adding photos: Choose photos/Paste, above them once photos are up; a failed save:
  that Download; a failed zip: Download all), placed again on every layout. An add-photos bubble closes when photos
  arrive. Trouble with one photo stays on its card. No bottom toast; zip progress is on Download all. Undo is the only
  thing at the bottom.
- Download and Download all shimmer while a big PNG or the zip is built; repeat taps don't start it again.
- Short screens (height 520 px or less): the wordmark sits left of the buttons, the privacy note is hidden, spacing
  tightens; the empty page shrinks the headline so the footer fits.
  Also 660 px wide or more (a phone on its side): Download all joins Choose photos / Paste up top and the footer is hidden
  while photos are on screen, so the cards get the height and keep 👍 👎; when it scrolls, one row is as tall as the
  screen allows (Kevin, 2026-11-22: on his iPhone on its side the bars were cut off under Download all and 👎 was gone).
- When the photos would scroll with the footer in place, the footer steps aside (`packed`; decided as if it were shown, so
  no loop). Kevin, 2026-11-22: on a phone with 10 photos it sat under Download all while the cards scrolled.
- Drags that start on the page (a cut-out dragged out) are ignored if dropped back on it.
- Haptics: a light tick on result, crop, 👍/👎 and Download (Android vibrate; iOS 18+ hidden switch control).
- Buttons follow one small system in style.css (Kevin, 2026-11-21: "a mature design system"): spacing tokens
  `--s1..--s5` (4 px scale), heights `--h-sm/md/lg` (32/40/48), every button a size plus a variant (`.primary`,
  `.ghost`, plain). Set `--h`, `--px`, `--fs` instead of padding by hand. Whimsy: lift on hover, press on click.
- Accessibility (audit 2026-11-22, `docs/history.md`): `announce()` reads out finished and failed photos; every
  icon-only control has a `title`; ad motion stops after about 24 s; on computers the page may scroll at 300-400% browser zoom (touch screens never scroll the page).

## Card bar (just the cut-out)

Kevin, 2026-11-22: "Wildly simplify/reduce the image editing controls. We lost the plot of goodbye.bg. It's not a full
image editor." A finished card has Download, 👍 👎 and remove, in one row (all four down to 100 px cards; below that 👍 steps out, see below). The output is always the
see-through PNG of the crop (or the GIF). Removed that day, on purpose: backgrounds (colours, blur, your own photo),
size/margin/shadow/WebP/Apply to all, the crop toggle, and the mask editor (#2, "Tap a piece? To do what?"); the
history is in git (before f4612b5) and `docs/history.md`. Don't bring them back without Kevin asking.
- Narrow cards shrink the buttons instead of dropping them (style.css container queries): 32 px down to 160 px cards,
  26 px to 130, 24 px to 116, 22 px to 110, 20 px below (12 photos on a phone on its side: 103 px cards); under 100 px 👍 steps out (👎 stays:
  it retries). Download is an icon under 240 px. Every bar control is a faint ink chip; Download is the loud button.
- Kept photos from before keep their masks; their old background and options are ignored, the `backs` store is
  emptied on load.
- A last row with empty cells sits in the middle (`centreLastRow`, a `translate`, no layout shift).

## Offline

`src/sw.js` keeps the app on the device; online it behaves as before. The build writes its file list into sw.js (`%SW%`).
- Shell: network first (deploys are live at once), a per-build copy (`gb-shell-<build>`) answers offline.
- `rt/` and `m/`: cache first, one `gb-*` cache each; activate deletes `gb-*` caches not in the list (never
  `share-inbox`). Parts fetched before the worker took over are fetched again (`whole()`), up to 40 MB once.
- Never cached: `/api/`, `/go/`, `/cap/`, `/version.txt`, `/ad.html`, `/sw.js`, non-GET. Stored responses keep
  COOP/COEP/CSP, so offline the CPU engine still has threads. No install prompt UI.
- Not offline: the CPU fallback on a computer that only ever ran the GPU engine; the first page after an upgrade;
  link fetching and ad clicks. Tested in headless Chrome (`scripts/test/offline.mjs`) and by Kevin in Safari (2026-11-22: works). Claimed quietly,
  "Works offline: After your first cut-out", in the remove.bg page's table (six languages) and the launch kit; not
  in the hero (Kevin: "I don't know how loudly we need to advertise that"). "After your first visit" would be false on
  phones (the model downloads on intent) and needs every model downloaded up front, about 210 MB.
- Offline, the footer's counter line says so (`offlineNote`, Kevin 2026-11-22: "a subtle indicator"): "Offline.
  goodbye.bg still works." when an engine was ready here before (`gb-model`), else "Offline. Connect once to load the
  model."; the count comes back online. Not shown where the footer is hidden (many photos, a phone on its side).

## Ads and Zazzle

Ads (affiliate, Kevin 2026-11-20): `lib/partners.mjs` lists partners (Printful, Printify, Zazzle; Canva's program is
closed to us); one shows only once its `url` holds Kevin's affiliate link (`?adtest=1` shows them all, linking to home
pages). Today only Zazzle has a link. One partner per visit. Each card is a different product, never a repeat: a
partner with one variant (Printful, Printify) leaves the other reserved cells empty. Marked "Ad" or "Sponsored"
(random per visit), not in Download all, no rating. Links go through `/go/<id>`, which counts the click ('adclick')
and redirects; a POST there counts the card being shown ('adseen').
- Ads among the photos (Kevin, 2026-11-22, replacing 2026-11-20's "always fill the grid"): one beside 1 to 3 photos;
  from 4 photos one after every 6th photo (after the last when there are fewer), at most 3, never in the first row of a
  grid with more than one (it moves to the second row's start) (`adCount`, `adCells`). Ads never make the photos
  scroll: fewer of them when the photos alone would fit. Their cells are reserved from the start as empty `.spare` cells,
  so no photo moves when an ad arrives (smoke test "ads: one after the 6th photo of 8"). Ads appear once the first cut-out is done, 1.1 s after it (`ADS_PAUSE`), one after another with a shimmering
  placeholder; the 3D code is fetched while the first photo is worked on.
- Zazzle's 8 variants draw the visitor's cut-out on a product (mug, sticker, shirt, tote, ornament, phone case, pillow,
  keychain), a different cut-out per card when there are several. Every 4 s one card changes: with one photo its
  product (Kevin, 2026-11-22: "Should the product also rotate, not just the photo?"; `swapProduct` rebuilds the card in
  place with the next product no other card shows, same cut-out), with 2+ photos the cut-out and the product take turns.
  Tapping a finished photo puts it on every product card and keeps it there (`showArt`); the products keep changing.
  All motion stops after about 24 s and never runs with reduced motion.
  The button names the product ("Put it on a mug"), outlined so Download stays the loud button; on cards of 160 px and
  under the label takes two lines. Ad cards have no
  surface, a solid hairline. Products follow light/dark.
- Products render in 3D (`src/render3d.js` + Three.js 0.187.0, MIT, ~150 KB gzipped, loaded only when ads show): a
  blob shadow (a shadow map turned the floor into a dark slab on iPhones), slow sway, a lean toward the mouse; one
  shared WebGL context. The 2D drawings in app.js (`drawMug` and friends) are the fallback (crash step '3d-failed').
- Zazzle cards take the cut-out along (Create-a-Product, Kevin 2026-11-21: the click implies it, no interstitial;
  no footer line (Kevin: the hero says "cut out right on your device" where people decide); the remove.bg page's FAQ
  has the details). The click PUTs the cut-out shown on the card (see-through, at most 2400 px) to
  `/api/cap/<random key>` (R2 bucket goodbye-bg-cap, binding CAP) and opens `/go/zazzle?...&k=<key>`. That tab first
  shows a tiny waiting page (Kevin, 2026-11-22: no blank tab; "keep the whimsy"): 👋 and five messages looping in CSS
  ("Packing your photo…", `goQuips` in i18n.js per language, `&lang=`), no script; a refresh after 1 s loads the link
  with `&w=1`, which waits up to
  10 s for it and redirects to that product's template in Kevin's store goodbyebg. Zazzle copies the image on the
  first fetch; `/cap/<key>.png` deletes ours 20 s later (never fetched: gone after an hour; a lifecycle rule clears
  `cap/` after a day). Upload fails or times out: the usual link, and computers still get the cut-out saved. Clicks
  that sent one count as 'adcap'. Templates, findings and the open commission question in `docs/zazzle-cap.md`.
- Other partners, GIFs, or `?zazzlecap=0`: the partner opens in a new tab and this tab saves the cut-out on the card
  (`artIt`) as the see-through PNG Download saves (`png`): a download on computers; on phones the share sheet first
  (Safari won't save from a tab that went to the background), then the partner (tested in the iOS Simulator).
- Ad blockers hide the card and block `/go/` beacons; that is the visitor's choice, so we don't work around it. A
  failing card is reported as 'ad-failed' or 'mug-failed'. EthicalAds: see `docs/ads.md`.

## Languages (on main since 2026-11-22, not yet reviewed by native speakers)

German, Spanish, French, Brazilian Portuguese and Indonesian (`docs/i18n.md`: why these, sources, open questions).
The app page follows the browser's language list (English first stays English; `?lang=xx` to test, a test switch); no
switcher, nothing stored. Strings: `src/i18n.js`, keyed by the English text in index.html/app.js; app.js calls
`t(english, { slot })`. The build inlines it into early.js, which translates `data-t*` elements as the parser passes
them (no English flash, CLS 0). **Changing an English string means changing its key in all five** (the smoke test
lists missing and stale keys). Text pages: `src/<de|es|fr|pt-br|id>/{remove-bg-alternative,how-to-remove-background}/`,
same claims as the English ones (change all six together), hreflang filled in by the build, own CSP lines in `_headers`.
Quips must fit two lines in a 165 px card's bar.

## Analytics and test traffic

Anonymous counts the page sends (never photo data), to Workers Analytics Engine dataset `goodbye_bg_ratings`:
- 👍/👎 to `/api/rate`: blob1 vote, blob2 engine, blob3 first/retry, double1 ms, double2 megapixels.
- Translation votes (other languages only): one line at the end of the footer's links, "Gute Übersetzung? 👍 👎" (Kevin,
  2026-11-22: "a super subtle way to rate the translation"); one tap, then "Danke." and never again in that browser
  (`gb-tr`). `/api/rate` with `kind: "lang"`: blob1 'tr-up'/'tr-down', blob2 the language. Per language, not per string.
- Crash reports to `/api/crash`: the page leaves a note in localStorage while working on a photo; the next visit sends
  it if the tab died (blob2 engine, blob3 step, blob4 device, blob6 the last 20 steps, double1 photos done, double2
  megapixels). GPU step-downs are sent at once.
- Page views: the first GET `/api/count?view=1&from=<host>` writes blob1 'view', blob2 device, blob3 referring host,
  blob4 country (no IP, no cookies). Launch links can carry `?ref=<tag>` (or `utm_source`), sent as `from=ref.<tag>`
  and then taken out of the address bar. A Pages Function on `/` was avoided: `_headers` (COEP/COOP) would not apply.
- Ads (`functions/go/[id].js`): blob1 'adseen'/'adclick'/'adcap', blob2 partner, blob5 variant, blob6 label ('ad' or
  'sponsored'), blob7 cta index.
- The count: `/api/count` adds one to a single global number in D1 (`goodbye-bg-counter`, binding COUNTER) per
  finished cut-out; every 100th gets confetti (`?confetti=1` forces it). The footer ("Goodbye to N backgrounds since
  2026."): one GET on load (total + pace since a snapshot the row keeps 10 to 20 min back), then it grows locally at
  that pace with random gaps, no more requests (Kevin: "one accurate-ish number on load, then contrived growth"; it can
  drift ahead of the real total). It never shows less than this browser showed before (`gb-count`). A visitor's own
  cut-out counts at once. Its line is always reserved. Shown from the first cut-out (Kevin, 2026-11-20); tapping it
  throws confetti. Kevin: tests count toward the total, never reset it.
- Test traffic: a visit with a test switch (`TEST_SWITCHES`) or `navigator.webdriver` marks its `/go/`, `/api/rate` and
  `/api/crash` requests `t=1`; `lib/test-traffic.mjs` drops those and `HeadlessChrome` unwritten. `/api/count` is not filtered.

Queries (`POST /accounts/<account>/analytics_engine/sql`, text/plain body):

    SELECT blob1 AS vote, blob2 AS engine, blob3 AS kind, count() AS n, avg(double1) AS ms
    FROM goodbye_bg_ratings GROUP BY vote, engine, kind ORDER BY n DESC
    SELECT blob2 AS engine, blob3 AS step, blob4 AS device, count() AS n, avg(double1) AS done, avg(double2) AS mp
    FROM goodbye_bg_ratings WHERE blob1 = 'crash' GROUP BY engine, step, device
    SELECT toDate(timestamp) AS day, blob2 AS device, blob3 AS from_site, count() AS views
    FROM goodbye_bg_ratings WHERE blob1 = 'view' GROUP BY day, device, from_site ORDER BY day DESC
    SELECT blob1 AS kind, blob2 AS partner, blob5 AS variant, count() AS n
    FROM goodbye_bg_ratings WHERE blob1 IN ('adseen','adclick') GROUP BY kind, partner, variant
    SELECT blob2 AS lang, blob1 AS vote, count() AS n
    FROM goodbye_bg_ratings WHERE blob1 IN ('tr-up','tr-down') GROUP BY lang, vote

Ad tests: clicks / shows per variant (blob5) or label (blob6); expect a few hundred clicks per variant before trusting
a difference.

## Testing

- `npm run test` (`scripts/test/smoke.mjs`; `--no-build`, `CHROME=`): headless Chrome over DevTools, a fresh profile per
  check, exit 1 on failure. Test photos are generated; each cut-out adds to the public count; ads are never clicked.
- `npm run test:x` (`scripts/test/xbrowser.mjs`; `--browser webkit|firefox`, `--device desktop|iphone`): WebKit desktop,
  WebKit iPhone (share sheet stubbed), Firefox. Persistent profiles (ephemeral WebKit acts like Private Browsing).
- What each covers and the 2026-11-22 results: `docs/history.md`. In short, WebKit runs BiRefNet on WebGPU on the Mac,
  2 CPU threads on the iPhone profile, HEIC natively, no WebP encoding (button hidden).
- Real-world situations (2026-11-22; the list tried and what each found is in `docs/history.md`): the smoke suite
  turns a phone on its side and back (mid-batch, done, with Undo up; 3 and 12 photos), drags a window through split-view
  and zoom sizes, puts every quip and every ad label of every language in cards of every width, and 👎s during a GPU
  batch. Its `LAYOUT` audit lists what must hold at any size (nothing outside the window, nothing over a card, bars
  keep their controls, a row's cards the same height): run it after layout changes.
- Not covered anywhere: real iOS memory limits, the real share sheet, touch gestures, real Safari, a real weak GPU.

## Next steps

1. Real-device tests: Mac Safari works (Kevin, 2026-11-22). Still: a
   real iPhone (engine restart after idle, the 16 MP PNG, the share sheet after Download all), Android (share target,
   install), desktop "Open with", folder drops, live link fetching; BiRefNet on Windows and Linux GPUs and 8 GB Macs.
2. Open draft PR for Kevin to decide: #5 the bulk tool.
   Time `refineEdge` with BiRefNet 640 on a real iPhone (0.3 to 0.7 s a photo at 6x throttling in Chrome).
4. A smaller GPU footprint might make WebGPU safe on iPhones again (try once ORT or the model changes).

## Open items outside the code

- Zazzle: the commission question (Ambassador agreement §2.1.3, asked of api.help@zazzle.com 2026-11-21) is unanswered.
- Domain: goodbye.bg live since 2026-11-23 (Netim, trustee service; Cloudflare nameservers). Custom domain on
  `goodbye-bg-git`; zone settings: SSL Full, Always Use HTTPS on, Email Obfuscation off, Browser Cache TTL "respect
  existing headers" (it forced 4 h on sw.js); pages.dev redirects to it (Bulk Redirect, branch previews excluded).
  `SITE` in scripts/build.mjs is the one place the origin lives. Steps and rollback: `docs/domain-cutover.md`.
- Git email: repo uses the GitHub noreply address. The first commit (aa3d4bd) still has the work email;
  fix with `git commit --amend --reset-author --no-edit && git push --force-with-lease` if wanted.
- License: repo is AGPL-3.0 because the ISNet model is AGPL. BiRefNet (MIT) runs on computer GPUs
  and, since 2026-11-22, on the CPU engine, but the site still ships ISNet (the 👎 retry on the CPU engine, the GPU
  step-down), so the AGPL reason stays until every ISNet path goes.
