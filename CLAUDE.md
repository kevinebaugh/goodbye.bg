# goodbye.bg

Background remover that runs in the browser. Replacement for remove.bg, which shuts down
1 December 2026. Photos are cut out on the device, never uploaded for it (a click on a Zazzle product ad takes
that one cut-out along, see Ads). Kevin uses it often, so it must be
zero friction: fun copy and small animations are fine, delays and popups are not.

Measurements and the history behind the decisions below: `docs/history.md`. Other docs: `docs/birefnet.md`,
`docs/quality-1000.md`, `docs/quality-products.md`, `docs/platforms-and-phone-model.md`, `docs/removebg-parity.md`,
`docs/zazzle-cap.md`, `docs/ads.md`, `docs/seo.md`, `docs/launch-drafts.md`, `docs/domain-cutover.md`.

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
  `how-to-remove-background/` (SEO pages, `docs/seo.md`).
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
- Copy: plain, short, active voice. Quips are the one place for playful text; everything else is plain and only what
  people need.
- Every claim on the site must stay true, including once ads run.
- Palette: the cool side of Giant Goldfish only (aqua, deep teal, sage). No orange; red only for errors.
- Requirement from Kevin: 10 to 30 seconds per photo is unacceptable. Target a few seconds.
- Typical photos: phone camera rolls. People, kids, pets, products, cars. Busy scenes (car interiors, a
  small cat in a dark yard) are the model's weak spot; don't over-tune for them.

## Engines

Two models, three tiers. `src/engine.js` runs ONNX Runtime Web 1.31.1 in its own module Worker; the page sends RGBA
pixels, the worker builds its model's input. Both models are fixed at 1024x1024.
- **BiRefNet lite** (MIT, fp16, 93 MB after the rewrite) on WebGPU, computers only (`any-pointer: fine`): 280 to 300 ms
  a photo, GPU peak +3.0 GB. ImageNet mean/std in, logits out (the worker applies the sigmoid).
- **ISNet medium** (IMG.LY, fp16, AGPL, 88 MB) on WebGPU: 150 to 300 ms a photo, GPU peak +1.0 GB. Input (x-128)/256,
  output 0..1. `hardenHaze` in app.js (ISNet only; `?haze=0` off): wide half see-through areas become solid at 0.3 or
  more, else clear.
- **ISNet on the CPU** (WebAssembly, 4 threads; 2 on iPhones): 5 to 7 s a photo on the M5 Pro.
- WebGPU is used when the adapter has `shader-f16`. iPhones and iPads always use the CPU engine (2 threads: 4 threads peaked at 2.1 GB in the Simulator and crashed an
  18.75 MP photo half the time on Kevin's iPhone; 2 threads peak about 300 MB lower; 5.0 s a photo). WebGPU crashed
  the tab there one try in two (2026-11-20). Safari needs `Cross-Origin-Embedder-Policy: require-corp` (it ignores
  `credentialless`) to be cross-origin isolated, which threads need.
- Votes and crash reports call the engines `gpu-birefnet`, `gpu` (ISNet) and `cpu` (ISNet). A vote names the engine
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
`?haze=0`, `?keepmax=N`, `?keepmb=N`, `?maxbatch=N`, `?adtest=1`, `?adpartner=zazzle|printful|printify`, `?adv=<v>`,
`?zazzlecap=0`, `?confetti=1`, `?debug=1`.

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
  background or options, no zoomed retry (👎 is a vote only). 10 frames at 360x540 in 5.7 s on the GPU.
- See-through inputs reach the model on white, or on black when the subject is light. SVGs are drawn at 2048 px+.
- A file that can't be opened never gets a card; one bubble at Choose photos names them. A photo the model fails on
  keeps its card.

Batches: `MAX_BATCH` per drop, paste, folder or ZIP: 100 on computers (fine pointer, not iOS, `deviceMemory` 8 or
unknown), 50 otherwise (about 10 MB of page memory per finished photo). Download all streams its zip.

## Kept photos

Kevin: leaving and coming back lost every photo. Every photo is kept in IndexedDB (`goodbye-bg` version 2, stores
`files`, `state`, `backs`, keyed in grid order as `-time x 1024 + n`) until removed: the original file, a preview (JPEG,
PNG for see-through types), mask(s) as PNG, crop, vote, retry (and the first result), background, options, the
finished GIF. On load the cards come back in place without the model; unfinished photos run. FIFO (Kevin: "into
perpetuity, sane limit"): newest 50 photos (`KEEP_MAX`; photos past it aren't written) within 1 GB on computers, 400 MB
on phones; oldest out first; a photo bigger than the whole limit isn't kept; quota errors drop the oldest and retry,
then give up quietly. Background photos are stored once (`backs`); unused ones are deleted on load.
`navigator.storage.persist()` is asked except in Firefox (it prompts there). Safari clears site storage after 7 days
without a visit; private windows refuse Blobs, so nothing is kept there.
- Reload without jitter: early.js reads `gb-kept` and starts in the photos layout, hidden ("restoring") until the
  first kept photo is drawn (1.5 s failsafe). The partner list is built into app.js (`%PARTNERS%`) so the first layout
  knows the ad cells; restored ads come straight in (`adsStraight`). CLS 0.

## UX decisions

- One screen, no scrolling. No double-tap zoom; pinch-zoom is allowed for accessibility (Kevin, 2026-11-20). Cards are
  square and sized to fit; a batch appears at once, in the order picked, and processing goes top-left first. The grid
  fits down to 84 px cards (a phone in portrait fits 12, 3 x 4, with Download all in sight); past that it scrolls and
  Download all sticks to its bottom edge. The grid uses the window's width (up to 1800 px).
- Only the photo being worked on waves and shows a quip; waiting cards stay still. It is the lightest photo on screen,
  with a soft light sweeping across it. The wave and quip live in the card's bar (where
  Download appears when done), never on the photo: the subject is what stays (Kevin, 2026-11-21). Phone cards hide
  remove while working so the quip fits two lines; the smallest cards show only the wave. A failed card says which
  file it was, on an opaque panel, and hides Download.
- Results are cropped to the subject by default (crop icon switches to the whole frame). 👎 retries zoomed in on the
  subject (merged into the first result outside the zoomed part, feathered where they meet; `mergeRetry`), only when
  the subject's padded box is under 80% of the photo; otherwise it is a vote only, labelled "Bad result" instead of
  "Bad result, try again". A second 👎 restores the first result. One vote per result: the chosen emoji stays lit and
  the other steps aside; a retry that finds a new result brings both back.
- Nothing ever overlaps the image. Every card control (crop, Download, 👍 👎, remove) lives in the bar below it.
- A finished cut-out is an `<img>`, so long-press on iPhone offers Save to Photos (a press swaps in the
  full-size PNG). Safari ignores `touch-action` for double taps, so app.js swallows a second tap within 350 ms.
- Hover effects only on devices with a real pointer (phones keep :hover after a tap).
- Remove can be undone for 5 s (Kevin, 2026-11-21): a pill at the bottom, "Removed." + Undo, in the footer's place
  (the footer fades out), with a ring that runs down (hover or focus pauses it; Cmd/Ctrl+Z works). The deadline is a
  JS timer (`UNDO_MS`). Undo also finishes a photo removed mid-run. One at a time. Removing frees the bitmap, moves any
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
- Drags that start on the page (a cut-out dragged out) are ignored if dropped back on it.
- Haptics: a light tick on result, crop, 👍/👎 and Download (Android vibrate; iOS 18+ hidden switch control).
- Buttons follow one small system in style.css (Kevin, 2026-11-21: "a mature design system"): spacing tokens
  `--s1..--s5` (4 px scale), heights `--h-sm/md/lg` (32/40/48), every button a size plus a variant (`.primary`,
  `.ghost`, plain). Set `--h`, `--px`, `--fs` instead of padding by hand. Whimsy: lift on hover, press on click.
- Accessibility (audit 2026-11-22, `docs/history.md`): `announce()` reads out finished and failed photos; every
  icon-only control has a `title`; ad motion stops after about 24 s; the page may scroll only at 300-400% zoom.

## Card bar

Bar order: crop, background, Download, 👍 👎, remove. Every bar control is 32 px (`--h-sm`); icons rest at full
strength on a faint ink chip; crop when on has a teal ring on an aqua tint. The bar drops controls so Download stays
at least ~40 px wide (card widths, style.css): 242+ px everything; 206 to 241 no crop; 162 to 205 no crop and no remove,
👍 👎 stay (Kevin, 2026-11-21: voting beats crop); 130 to 161 background, Download, remove; under 130 background and
Download. What the bar hides rides along in the background picker (`wantcrop`/`wantx`), so crop and remove are never
lost. Cards without a picker (waiting, failed, GIFs) keep remove in the background button's place.
- **Roomy bars**: on touch screens only, when cards fill the width first with height to spare (a phone in portrait
  with 1 to 4 photos), `.grid.roomy` gives the bar a second row: background + Download, then crop, 👍 👎, remove. With
  a mouse the bar is always one row. Ad cards keep a one-row bar.
- A last row with empty cells sits in the middle (`centreLastRow`, a `translate`, no layout shift).

## Backgrounds and options

remove.bg parity (`docs/removebg-parity.md`). A round button in the bar shows the cut-out's background (see-through,
the default, is half checkerboard and half aqua; on a device's first cut-out it rings twice until opened,
`gb-bg-seen`). Tapping it swaps the bar for a row of swatches at the same height (never over the photo, cards never
resize). A tap on a swatch, outside the bar or Escape closes it.
- Swatches: see-through, white, black, light aqua, sage, any colour (`<input type=color>`, live); blur soft and strong
  (the photo's own background blurred at 480 px with the subject taken out first, box blur, no canvas filter); your
  own photo (picker, or drop on the row or button; 2048 px on iPhones, 4096 elsewhere; shared by every photo that
  uses it; never uploaded). `it.bg` holds a colour, `"blur:1"`, `"blur:2"` or `"img:<id>"`; everything that paints a
  background goes through `backdrop()`.
- Picking blur switches the card to the whole frame (the portrait-mode look; Kevin may want this off); leaving blur
  puts the crop back (`cropBack`).
- Rows never scroll and never cut a control: `pageRow` pages them (›), breaking between groups; the sliders button
  sits next to › on every page. Narrow cards open the rows in the **dock** (`seat()`): a pill in the footer's place,
  the card ringed in teal, nothing over any photo.
- Output options (sliders): Size (Original, Square, 4:5, 16:9, Custom up to 5000 px, 4096 on iPhones), Margin (0, 4%,
  10%, 20% of the subject's longer side; 4% is the crop), ground shadow, Apply to all (this visit, not GIFs), WebP
  (where the browser encodes it). All off by default, and then the output is byte-for-byte the old one. A side where
  the subject runs off the photo gets no margin and no shadow. Output capped at 16 MP on iPhones, 64 elsewhere.
- The card, Download, long press and Download all follow the background and options; a solid, blur or photo
  background downloads as JPG (0.92), see-through as PNG (or WebP). Ad art, ad-click saves and the Zazzle upload are
  always the plain see-through crop (`plainBlob`). Kept in IndexedDB (`bg`, `out`). No marketplace names in the UI.
- Phones build the PNG ahead when a row closes, only when no batch or retry is running.

## Offline

`src/sw.js` keeps the app on the device; online it behaves as before. The build writes its file list into sw.js (`%SW%`).
- Shell: network first (deploys are live at once), a per-build copy (`gb-shell-<build>`) answers offline.
- `rt/` and `m/`: cache first, one `gb-*` cache each; activate deletes `gb-*` caches not in the list (never
  `share-inbox`). Parts fetched before the worker took over are fetched again (`whole()`), up to 40 MB once.
- Never cached: `/api/`, `/go/`, `/cap/`, `/version.txt`, `/ad.html`, `/sw.js`, non-GET. Stored responses keep
  COOP/COEP/CSP, so offline the CPU engine still has threads. No install prompt UI.
- Not offline: the CPU fallback on a computer that only ever ran the GPU engine; the first page after an upgrade;
  link fetching and ad clicks. Tested in headless Chrome only (`scripts/test/offline.mjs`). **Not claimed on the site**
  until Kevin checks Safari (then add "Works offline after your first cut-out").

## Ads and Zazzle

Ads (affiliate, Kevin 2026-11-20): `lib/partners.mjs` lists partners (Printful, Printify, Zazzle; Canva's program is
closed to us); one shows only once its `url` holds Kevin's affiliate link (`?adtest=1` shows them all, linking to home
pages). Today only Zazzle has a link. One partner per visit. Each card is a different product, never a repeat: a
partner with one variant (Printful, Printify) leaves the other reserved cells empty. Marked "Ad" or "Sponsored"
(random per visit), not in Download all, no rating. Links go through `/go/<id>`, which counts the click ('adclick')
and redirects; a POST there counts the card being shown ('adseen').
- Ads fill the grid (Kevin, 2026-11-20: "always fill the grid"): up to 3 photos are laid out as 4 cells (1 photo + 3
  ads, 2 + 2, 3 + 1); more photos fill out their last row. The cells are reserved from the start so photos don't
  resize. Ads appear once the first cut-out is done, 1.1 s after it (`ADS_PAUSE`), one after another with a shimmering
  placeholder; the 3D code is fetched while the first photo is worked on.
- Zazzle's 8 variants draw the visitor's cut-out on a product (mug, sticker, shirt, tote, ornament, phone case, pillow,
  keychain), a different cut-out per card when there are several; with 2+ one card at a time swaps cut-out every 4 s.
  The button names the product ("Put it on a mug"), outlined so Download stays the loud button. Ad cards have no
  surface, a solid hairline. Products follow light/dark.
- Products render in 3D (`src/render3d.js` + Three.js 0.187.0, MIT, ~150 KB gzipped, loaded only when ads show): a
  blob shadow (a shadow map turned the floor into a dark slab on iPhones), slow sway, a lean toward the mouse; one
  shared WebGL context. The 2D drawings in app.js (`drawMug` and friends) are the fallback (crash step '3d-failed').
- Zazzle cards take the cut-out along (Create-a-Product, Kevin 2026-11-21: the click implies it, no interstitial;
  no footer line (Kevin: the hero says "cut out right on your device" where people decide); the remove.bg page's FAQ
  has the details). The click PUTs the cut-out shown on the card (see-through, at most 2400 px) to
  `/api/cap/<random key>` (R2 bucket goodbye-bg-cap, binding CAP) and opens `/go/zazzle?...&k=<key>`, which waits up to
  10 s for it and redirects to that product's template in Kevin's store goodbyebg. Zazzle copies the image on the
  first fetch; `/cap/<key>.png` deletes ours 20 s later (never fetched: gone after an hour; a lifecycle rule clears
  `cap/` after a day). Upload fails or times out: the usual link, and computers still get the cut-out saved. Clicks
  that sent one count as 'adcap'. Templates, findings and the open commission question in `docs/zazzle-cap.md`.
- Other partners, GIFs, or `?zazzlecap=0`: the partner opens in a new tab and this tab saves the cut-out on the card
  (`artIt`) as the plain see-through PNG (`plainBlob`): a download on computers; on phones the share sheet first
  (Safari won't save from a tab that went to the background), then the partner (tested in the iOS Simulator).
- Ad blockers hide the card and block `/go/` beacons; that is the visitor's choice, so we don't work around it. A
  failing card is reported as 'ad-failed' or 'mug-failed'. EthicalAds: see `docs/ads.md`.

## Analytics and test traffic

Anonymous counts the page sends (never photo data), to Workers Analytics Engine dataset `goodbye_bg_ratings`:
- 👍/👎 to `/api/rate`: blob1 vote, blob2 engine, blob3 first/retry, double1 ms, double2 megapixels.
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

Ad tests: clicks / shows per variant (blob5) or label (blob6); expect a few hundred clicks per variant before trusting
a difference.

## Testing

- `npm run test` (`scripts/test/smoke.mjs`; `--no-build`, `CHROME=`): headless Chrome over DevTools, a fresh profile per
  check, exit 1 on failure. Test photos are generated; each cut-out adds to the public count; ads are never clicked.
- `npm run test:x` (`scripts/test/xbrowser.mjs`; `--browser webkit|firefox`, `--device desktop|iphone`): WebKit desktop,
  WebKit iPhone (share sheet stubbed), Firefox. Persistent profiles (ephemeral WebKit acts like Private Browsing).
- What each covers and the 2026-11-22 results: `docs/history.md`. In short, WebKit runs BiRefNet on WebGPU on the Mac,
  2 CPU threads on the iPhone profile, HEIC natively, no WebP encoding (button hidden).
- Not covered anywhere: real iOS memory limits, the real share sheet, touch gestures, real Safari, a real weak GPU.

## Next steps

1. Real-device tests: Mac Safari (BiRefNet on WebGPU; the 2-minute check in `docs/platforms-and-phone-model.md`), a
   real iPhone (engine restart after idle, the 16 MP PNG, the share sheet after Download all), Android (share target,
   install), desktop "Open with", folder drops, live link fetching; BiRefNet on Windows and Linux GPUs and 8 GB Macs.
2. Offline claim: check offline in Safari, then add "Works offline after your first cut-out" to the site and launch kit.
3. Open draft PRs for Kevin to decide: #2 mask editing (tap pieces, erase/restore brush, undo), #3 phones on BiRefNet
   lite at 640 instead of ISNet (`docs/platforms-and-phone-model.md`), #4 guided filter for hair edges (`?pp=1`).
   Branch `bulk-cli` (a desktop bulk tool) has no PR. No i18n PR exists.
4. A smaller GPU footprint might make WebGPU safe on iPhones again (try once ORT or the model changes).

## Open items outside the code

- Zazzle: the commission question (Ambassador agreement §2.1.3, asked of api.help@zazzle.com 2026-11-21) is unanswered.
- Domain goodbye.bg ordered at Netim (trustee service) on 2026-11-19, waiting on the trustee ID check.
  Nameservers are set to Cloudflare (`lou.ns.cloudflare.com`, `mira.ns.cloudflare.com`). When it registers, follow
  `docs/domain-cutover.md` (check nameservers on the zone, add goodbye.bg as a custom domain on `goodbye-bg-git`).
- Git email: repo uses the GitHub noreply address. The first commit (aa3d4bd) still has the work email;
  fix with `git commit --amend --reset-author --no-edit && git push --force-with-lease` if wanted.
- License: repo is AGPL-3.0 because the ISNet model is AGPL. BiRefNet (MIT) only replaces it on computer GPUs;
  the CPU engine (iPhones, fallback) still needs ISNet, so the AGPL reason stays.
