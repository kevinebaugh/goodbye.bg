# History and measurements

Detail moved out of CLAUDE.md on 2026-11-22, word for word, so CLAUDE.md can stay short. CLAUDE.md describes the code as it
is; this file is the record of how it got there and what was measured when. Where a line here disagrees with CLAUDE.md,
CLAUDE.md (and the code) wins. Known superseded lines are marked **[superseded]**.

## Test suites and cross-browser results (2026-11-22)

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


## Real-world situations (2026-11-22)

Headless Chrome, generated photos, the page audited at every step (nothing outside the window, nothing over a card, bars
keep their controls, a row's cards the same height; `LAYOUT` in `scripts/test/smoke.mjs`). Each situation with 0, 1, 3, 6
and 12 photos, a batch running, ads on (`?adtest=1&adpartner=zazzle`) and off, the Undo pill up, touch and mouse.

Fixed:
- **👎 while a batch runs, on the GPU engine.** The retry and the batch's next photo went to the engine worker together;
  one never came back. After 15 s that read as a GPU failure: `birefnet-run-failed` twice, BiRefNet switched off for
  30 days (`gb-gpu`), and the batch waited forever (two `segment` calls each restarted the engine and one waited on a
  start that had been terminated). Now one run at a time (`infer` queues), and a job whose engine was stopped under it
  runs on the next engine without a step-down of its own. 8 photos finish 3.7 s after the 👎.
- **Undo pill.** Placed once, from where the footer was before the remaining cards grew: on a phone with 3 photos it
  landed on a card's Download and 👍 👎. With no footer on screen (a phone on its side, a packed grid) the footer's
  empty box put it half off the top of the screen. `placeUndo` now follows the footer's final place on every layout.
- **A connection lost before the model is in** (first visit, photos picked). Every photo failed with "Could not process
  this image", was deleted from the kept photos (so the bubble's "reload" lost them) and sent a `run-failed` crash
  report. Now they wait, still kept; the batch starts again on `online`, when the page comes back into view, and every
  20 s. A failed download is not reported as a crash, and the GPU is never stepped down while the browser is offline.
- **Quips.** After the bar lost its second row, 83 quips wrapped to three lines at a phone's 165 px cards and made the
  card being worked on 6 px taller than its row (also at 130 to 210 px). A third line now borrows the bar's padding,
  the bar can't grow, and remove steps out on working cards up to 165 px.
- **File names.** "#" and "?" cut a file's name like a link's: "Logo #2 (final?).jpg" was saved as ")-goodbye-bg.png".
  A long name was cut through an emoji. In the zip, characters Windows can't have in a name are now "_".
- **👎, Remove, Undo.** The card came back showing the retry's result with the old 👎 lit and both votes off.
- **100 to 109 px cards** (12 photos on a phone on its side): remove was cut off at the card's edge. 20 px controls there.
- **Ad button label** cut off at both ends on cards under about 140 px ("ut it on an ornamer"), Portuguese and Spanish
  from 160 px: two lines there.

Fine: rotation 390x844 to 844x390 and back (Kevin's example); a window dragged between 320 and 1600 px; split-view
widths 320, 507, 678; zoom 200%; 400% (the page scrolls, never sideways); a 10000x800 panorama, a 600x6000 strip, a
60 MP photo (3002x5082 cut-out, 4 s); 1x1 px, fully see-through and no-subject photos ("No clear subject in this
photo."); 200-character, emoji, right-to-left and HTML-looking names; three files with one name (the zip numbers
them); light to dark mid-session (ad products redraw); reduced motion; a reload mid-batch (finishes, CLS 0); back
from a text page (bfcache: photos there, new ones work); two tabs (remove in one, vote in the other: a reload agrees);
IndexedDB or all storage refused (works, nothing kept); offline mid-batch (finishes; votes and the count are dropped);
the last photo removed, turned, Undo.

Left as they are: with no footer on screen the Undo pill covers the bottom of the cards for its 5 s; text-only zoom at
150% in a short window (the wordmark meets the buttons); at 300 to 400% zoom the pill covers Download all; a photo
removed in the first moments of a reload and brought back with Undo stays waiting until the next reload.

## iPhone engine restart after the idle shutdown (2026-11-22)

Restart after the iPhone idle shutdown (2026-11-22, headless Chrome and Playwright WebKit with the iPhone profile;
**untested on a real iPhone**): a terminated engine's memory comes back about 2 s later in Chrome (session release,
`close()`, ending its thread workers first: no faster), and in WebKit mostly within 0.6 s (phys_footprint).
A 👎 or a new photo in that window held two engines: Chrome renderer RSS 3.3 GB for the 👎 and 4.6 GB for a new
18.75 MP photo after it (batch alone 2.0 GB). Now `startEngine` waits until 3 s after an idle shutdown (`engineFree`):
both 2.0 GB, the 👎 up to 3 s slower when tapped right away. The model and runtime parts are read into one buffer of
the final size (were chunks + Blob + copy): batch peak about 130 MB lower. Masks bit-for-bit unchanged.
If Safari turns out to free more slowly, keeping the engine a few seconds after a batch (a quick 👎 reuses it) is the next step.

## GPU gate (2026-11-22)

GPU gate (2026-11-22, for weak GPUs; the proposal in `docs/platforms-and-phone-model.md`, decision 3). Three tiers:
BiRefNet on the GPU, then ISNet on the GPU (a third of the GPU memory), then the CPU.
- BiRefNet steps down to ISNet on the GPU when its start fails, a run fails or its worker dies (out of GPU memory
  shows up as one of these), its start (session and warm-up, after the download) takes over 10 s, or its first
  photo over 2 s (M5 Pro: about 2 s and 0.3 s). The time limits count only while the page stays in view (computers
  start the model at load, often in a background tab); hidden, only the 30 s hang counts. A slow first photo keeps its BiRefNet result. ISNet on the GPU
  steps down to the CPU on a failure or a hang. A failure before the worker has the model (the download, offline, or
  the worker script) is not a GPU failure: no step down, nothing remembered, "Could not load" as before.
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

## ISNet and BiRefNet measurements

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
  worker took over (a first visit where the model starts at once) are fetched again (`whole()`): 5 s after the last
  part through the worker has finished streaming, only numbered parts below the first one it saw, plus manifests and
  the runtime's .mjs files; never parts the engine hasn't reached (the GPU gate can stop BiRefNet halfway). Measured at
  20 Mbps with a photo added at once: the first part of the runtime and of BiRefNet went past the worker, so 40 MB extra
  once; no part fetched twice by the worker (offline.mjs checks this). Time to first cut-out through a real 20 Mbps
  limit (a throttling proxy, photo added at once, desktop GPU): 51.3 s before, 51.9 s with the worker (twice each).
  CDP throttling showed 52 vs 61 s, an artifact: it throttles the worker-served responses as well.
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

## Formats tested (2026-11-22)

- Tested 2026-11-22 (headless Chrome, raw.pixls.us samples): CR2 1936x1288, NEF 6016x4000, iPhone 12 Pro DNG 3024x4032,
  Sony A7 III ARW 1616x1080 (the largest preview that camera stores), CR3 3408x2272; HEIC 6016x6016 in 1.9 s; LZW TIFF;
  a portrait HEIC (irot) comes out upright; broken HEIC/TIFF/fake DNG give an error card; mixed ZIP (nested folders, HEIC, CR2, TIFF, junk) in name order.

## Batches (2026-11-22)

`MAX_BATCH` per drop, paste, folder or ZIP: 100 on computers (fine pointer, not iOS, `deviceMemory` 8 or unknown), 50 on
phones, tablets and computers reporting under 8 GB; `?maxbatch=N` to test. A drop over the cap says "Added the first N".
Only the newest 50 are kept on the device (`KEEP_MAX`, photos past it aren't written at all); the rest are cut out and go
into Download all, but a reload loses them. Download all streams its zip (fflate `Zip` + `ZipPassThrough`, gathered as
Blob parts of 32 MB) instead of holding every file and then the whole zip. Measured in headless Chrome (M5 Pro, 1200x1600
photos, GPU): about 10 MB of page memory per finished photo (preview bitmap, mask, edge colours): 0.8 GB for 50, 2.2 GB
for 200 (98 s, zip 4 s), hence 100. At 50 photos on a 1440x900 window the cards are near their 84 px minimum (96 before 2026-11-22) and the
grid scrolls (the one-screen rule gives way for bulk). remove.bg bulk users mostly need "drop a folder, get a zip": that
works up to 100 at a time; more means another drop.

## Kept on the device (2026-11-21)

Kevin: leaving and coming back lost every photo. Cause: nothing was stored. The page is bfcache-eligible (headless Chrome
restores it on Back, IndexedDB open included), and desktop ad clicks already open a new tab, but bfcache drops big pages
and anything over 10 min, a reload or new visit starts empty, iPhones discard background tabs, and on phones
`window.open` after the share sheet can be blocked, which sends this tab to the partner.
Now every photo is kept in IndexedDB (`goodbye-bg` version 2, stores `files`, `state` and `backs`, keyed in grid order) until removed:
the original file, a preview (JPEG, PNG for see-through types), mask(s) as PNG, crop, vote, retry (and the first result),
the finished GIF. On load the cards come back in place without the model; unfinished photos run. FIFO (Kevin: "into
perpetuity, sane limit"): newest 50 photos within 1 GB on computers, 400 MB on phones; oldest out first; quota errors
drop the oldest and retry, then give up quietly. Removing a card deletes its copy. Background photos (`backs`, a JPEG of at most
2048 px on iPhones, 4096 elsewhere) are stored once however many photos use them; on load the unused ones are deleted.
Keys are `-time x 1024 + n` (x64 before 2026-11-22, which let a batch over 64 overwrite the one before it). `navigator.storage.persist()` is
asked except in Firefox (it prompts there). Safari still clears site storage after 7 days without a visit.
Tested: headless Chrome (reload in a restarted browser, Back still from bfcache); iOS Simulator (iPhone 17, iOS 27): force-quitting Safari and reopening brings back both photos in order with the 👍 lit, a removed card stays gone, and Download on a restored photo shares the full-size PNG; an animated GIF comes back playing. Headless Chrome: a 👎 retry comes back with its first result (2048 merged mask, 1024 first), a 👎 after the reload still puts the first back, and that sticks; a GIF's Download after a reload is the GIF. Cap (headless Chrome, `?keepmax=N` / `?keepmb=N` lower it to test): 52 photos in two batches keep 50 (the two at the end of the grid go), about 2 MB a photo (97 MB for 50); with 5 MB, older photos go first and a single photo bigger than the whole limit is not kept (it used to push out everything). Restoring 50: cards up in 60 ms, all drawn in 1.0 s warm, 9.5 s on a cold start next to the CPU engine starting. Not tested: a real QuotaExceededError.

## Reload without jitter (2026-11-22)

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

## Card bar, grid, picker and options: QA and visitor reviews (2026-11-21 and 22)

**[superseded]** where these say the partner-ad save follows the background or options: since 7397a95 it is always the plain see-through PNG (`plainBlob`).

- QA pass 2026-11-21 (details in git log):
  - 👎 zooms in only when the subject's padded box is under 80% of the photo; otherwise it is a vote only and its
    label says "Bad result" instead of "Bad result, try again" (most phone photos fill the frame).
  - The card bar drops controls so Download stays at least ~40 px wide (measured 39 to 43 px at the tightest widths).
    Every bar control is 32 px (`--h-sm`, 2026-11-22 visitor review: they were 28 px on narrow cards). The icons
    (background, crop, 👍 👎, remove) share one resting look on every device: full strength on a faint ink chip (grey
    thumbs at 70% read as disabled on computers); crop when on has a teal ring on an aqua tint. Bar order:
    crop, background, Download, 👍 👎, remove. What the bar has no room for rides along in the background picker
    (`wantcrop`/`wantx` classes, set from what the bar actually hides), so crop and remove are never lost (card widths):
    242+ px everything; 206 to 241 no crop; 162 to 205 no crop and no remove, 👍 👎 stay (Kevin, 2026-11-21: voting
    beats crop); 130 to 161 background, Download, remove; under 130 background and Download.
    **Roomy bars** (2026-11-22, visitor review: "no visible way to remove a photo on a phone"): on touch screens only
    (`pointer: coarse`), when the cards fill the width first and there is height to spare (a phone in portrait with 1 to
    4 photos, 165 px cards), layout() sets `.grid.roomy` and the bar takes a second row: background + Download, then
    crop, 👍 👎, remove. Photo bars get `min-height: var(--bar)` so a row's cards line up; ad cards keep a one-row bar
    (`--bar1`) and the second row's height goes to the product art. A working card's quip fills both rows (wave on top).
    With a mouse the bar is always one row and the picker carries crop and remove (second review: a laptop with 12
    photos had two-row bars, 35% of every card, and 165 px photos).
    **The grid uses the window's width** (`body.app.has-work main` up to 1800 px; it was capped at 1100 px, which made
    a laptop width-bound): cards are sized from both axes. 1440x900: 1 photo 339 px (was 277), 12 photos 6 x 2 at
    222 px with one-row bars (was 165 px with two rows; still slightly width-bound, 5 columns would be smaller).
    Download all's padding (only while the grid scrolls) is left out of the fit, so a grid that scrolled goes back to
    fitting when a card goes (it stayed scrolling at 12 on a phone after a 13th was removed).
    Cards without a picker (waiting, failed, animated GIFs) keep remove in the bar, in the background button's place, so
    Download doesn't move when a card finishes. A background or crop change on a phone builds the PNG ahead only when no
    batch or retry is running.
  - The grid fits the screen down to 84 px cards (was 96), and the bar's height is worked out per candidate width (it
    was measured from the current cards): a phone in portrait fits 12 photos (3 x 4, 85 px cards) with Download all in
    sight (visitor review: they scrolled). Past that the grid scrolls and Download all sticks to its bottom edge.
  - A last row with empty cells (one photo before its ads arrive, or no ads) sits in the middle, under the centred
    buttons (`centreLastRow`, a `translate`, so no layout shift); it glides aside when an ad fills a cell.
  - The tell() bubble is placed again on every layout and resize (it used to stay where the Paste button had been).
  - The Undo pill sits in the footer's place, and the footer fades out meanwhile (it covered the count on phones).
  - The footer count never shows less than this browser showed before (`gb-count` in localStorage): a reload could
    show a lower number than the local growth had reached.
  - Every icon-only control has a `title` (Download, crop and remove had none).
- Accessibility (audit 2026-11-22, all 14 findings but `#pick` as a label): a polite `#sr` status line announces each
  finished or failed photo and a retry's outcome (`announce()`); cards are `aria-busy` while waiting. After a keyboard
  👍 👎 focus goes to Download (or the card during a retry). A keyboard Remove focuses Undo. The page may scroll when it
  overflows (`overflow-y: auto`): only at 300-400% zoom in practice; every normal size measured 0 px overflow, so the
  one-screen rule holds. Focus rings stay visible on the ink Undo pill and the input-backed swatches; swatch focus (ink,
  offset) differs from the chosen ring (brand). Failed-card text sits on an opaque panel. Light-mode thumbs and swatch
  rings reach 3:1. Ad sway and cut-out swaps stop after about 24 s (WCAG 2.2.2), never under pointer or focus. Tabbing
  out of a picker row closes it. The h1 stays in the page, visually hidden, once photos are up.
  - Short screens (height 520 px or less, a phone on its side): the wordmark sits left of the buttons (buttons go
    right), the privacy note is hidden, spacing tightens; the empty page shrinks the headline so the footer fits.
  - Download and Download all shimmer while a big PNG or the zip is built; repeat taps don't start it again. A failed
    save says so. Failed cards hide Download.
  - See-through inputs (PNG cut-outs, SVG logos) reach the model on white, or on black when the subject is light.
    SVGs are drawn at least 2048 px on their longest side.
  - Drags that start on the page (a cut-out dragged out) are ignored if dropped back on it.
  - Background (2026-11-22, remove.bg parity): a round button in the bar shows the cut-out's background (see-through,
    the default, is half checkerboard and half aqua: "this swaps the background"; on a device's first cut-out it rings
    twice until the picker has been opened, `gb-bg-seen`). Tapping it swaps the bar for a row of swatches at the same height (never over the photo,
    cards never resize): see-through, white, black, light aqua, sage, any colour (`<input type=color>`, live on the card).
    A tap on a swatch, outside the bar or Escape closes it. The card, Download, long press, Download all and the
    partner-ad save follow it; a solid background downloads as a JPG (0.92), see-through stays PNG. Ad card art and the
    cut-out sent to Zazzle stay see-through. Not for animated GIFs (no button). Kept in IndexedDB (`bg` in the state record).
    Blur and your own photo (2026-11-22, parity item 4): more swatches. Blur: the photo's own background blurred,
    the subject sharp; two swatches, soft and strong, that close the row like every other one (until the visitor
    review it was one swatch that toggled in place). It is made per photo and strength from the preview bitmap at 480 px (never full size), with the subject
    taken out first (blur of colour x background weight / blur of the weight, so no halo of the subject's colours), box
    blur two passes, no canvas filter; scaled up wherever drawn. Picking blur switches the card to the whole frame (the
    portrait-mode look; the crop button puts the crop back; Kevin may want this off). Leaving blur for any other
    background puts back the crop blur took away (`cropBack`, kept in IndexedDB; cleared when crop is toggled). Your photo: the picture swatch opens
    a file picker, or drop a picture on the open row or the background button (the full-window drop target steps aside
    there); decoded once, scaled to 2048 px on iPhones (4096 elsewhere), on iPhones only while no photo is being worked on,
    cover-fit behind the subject, shared by every photo that uses it (All), never uploaded. Both download as JPG and follow
    Download all, long press, reload and the partner-ad save; Zazzle gets the see-through crop. `it.bg` holds
    `"blur:1"`, `"blur:2"` or `"img:<id>"`; everything that paints a background goes through `backdrop()`.
    **Pages and the dock** (2026-11-22, visitor review: 19 px swatches on phones, colours dropped, WebP cut off): the
    swatch row and the options row never scroll and never drop or cut a control. `pageRow` measures what fits; the rest
    goes on the next page, and › at the end turns the page (on the last page it points back). Swatches are 32 px on touch,
    28 px with a mouse. Pages break between groups (`data-g`; second review: Soft and Strong blur landed on different
    pages): the colours (see-through, white, black, aqua, sage, any colour), then blur soft + strong (`data-u`, never
    split) and your photo, then crop and remove when the bar has no room for them; a group is split only when it can't
    fit on a page of its own. Size, margin, shadow (sliders) is pinned next to › on every page, so it is two taps from
    the bar (it was background, ›, sliders). With a mouse the rows open in the card's bar, however many pages (the
    dock at the bottom of a big window was far from the card), unless a page can't hold one control next to the
    sliders and › (cards under ~130 px, 40+ photos on a laptop: `pagesFit`), which docks: 1440x900 with 1 photo shows every swatch on one page;
    12 photos (222 px) page the colours 4 + 2, then blur, photo and crop. On touch a row that fits on two pages opens in
    the bar's place (two rows of swatches on a roomy bar); a narrower card (12 on a phone) opens it in the **dock**
    (`seat()`): a pill in the footer's place (the footer fades out), the card ringed in teal, nothing over any photo,
    no card moves.
  - Output options (2026-11-22, sellers, parity items 5 and 7): the picker's sliders button (pinned next to ›) swaps the swatches
    for a second row at the bar's height: Size (native select: Original, Square, 4:5, 16:9, Custom W x H up to 5000 px,
    4096 on iPhones), Margin (0, 4%, 10%, 20% of the subject's longer side; 4% is the old crop; on the whole frame at Original it shows 0%
    and picking a margin turns the crop on: it used to grey out with no reason given), a ground shadow toggle,
    Apply to all, WebP, after a Done button (✓, first, so there is always a way back). Shadow and WebP are chips that
    fill and show a check when on; Apply to all is an action (dashed, a copy icon, "Applied" with a check for a moment;
    it was an outlined "All" that read as a toggle). Custom's width and height go together and come up on their own page
    when they don't fit. Phones build the PNG ahead when the row closes, not per change; controls are 16 px on touch (iOS focus zoom). All off by default, and then
    the output is byte-for-byte the old one. Original never goes past the photo's edges; a ratio grows the canvas around
    the subject at the photo's own resolution (no resampling); Custom scales into exactly W x H; centred, except that a
    side where the subject runs off the photo (mask within 1.5/1024 of the edge: a person cut at the waist, a bottle at
    its base) gets no margin and sits on the canvas edge, and no shadow goes under a cut bottom (visitor review: the cut
    floated in mid-air with a shadow under it; cut on two opposite sides: centred); the margin is
    see-through or the background colour (the cut-out is clipped to the subject's box). The shadow is a radial-gradient
    ellipse under the subject's bottom edge (no canvas filter: Safari). Output capped at 16 MP on iPhones, 64 elsewhere.
    WebP only where the browser encodes it (a 1x1 test at load; not tested in Safari), quality 0.9,
    keeps transparency. Card, Download, long press, Download all and the partner-ad save follow; the Zazzle upload and ad
    art stay the plain see-through crop (`fullBlob(it, true)`). All copies this photo's background and options to every
    other photo (not GIFs) and to photos added later in this visit (memory only, not across visits). Kept in IndexedDB
    (`out` in the state record). A see-through Square looks like Original on the card (the checkerboard fills the cell);
    with a colour the frame shows. No marketplace names in the UI: a see-through square doesn't meet Amazon's white rule.
  - Removing a photo frees its bitmap and moves any ad card showing it to another cut-out; focus goes to the next card.

## Ads: retired tests

Zazzle variant "mug" (the A): the visitor's first finished cut-out drawn on a mug in a canvas on the device
(drawMug in app.js: cylinder wrap column by column, shading, rim, shadow); drawing it uploads nothing; Zazzle gets
the image only when the card is clicked. Variant "b": "Put your cut-out on anything." Both go to zazzle.com/custom. `?adv=<v>` forces a
variant, `?adtest=1` shows partners without links.

**[superseded]** Variant "b" was retired 2026-11-21 (Kevin: next to drawn products it looked out of place; its counts stay under "b"). Zazzle now has 8 product variants.

Product test: Zazzle's variants are products drawn from the visitor's cut-out (mug, sticker, shirt, tote; drawProduct
functions in app.js, light and dark) plus "b" (text card); one per visit. Button-wording test: "Make it on Zazzle" vs
"Make it", blob7 = c (0 or 1), independent of the product and the label.

**[superseded]** The button-wording test ended 2026-11-21; the button names the product ("Put it on a mug"). `ctas` in lib/partners.mjs can still list wordings.

## iPhone engine choice (2026-11-20)

iPhones and iPads always use the CPU engine (2 threads: 4 threads peaked at 2.1 GB in the Simulator and crashed an
18.75 MP photo half the time on Kevin's iPhone; 2 threads peak about 300 MB lower). Tested 2026-11-20 on Kevin's iPhone with
`?debug=1`: the WebGPU engine crashed the tab ("A problem repeatedly occurred") on the first real photo,
even with no warm-up run (one try in two); the CPU engine never crashed: 7.3 s a photo on 1 thread,
5.0 s on 2, 3.5 s on 4. Safari needs `Cross-Origin-Embedder-Policy: require-corp` (it ignores
`credentialless`) to be cross-origin isolated, which threads need.

## Ads as written before the cleanup (2026-11-20 to 22)

**[superseded]** "after the batch is done": ads come in once the first cut-out is done (1.1 s after it).

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
next rises in), starting a full beat after ads come on screen; off when hidden or with reduced motion. Ads appear once the first cut-out is done; they wait 1.1 s after it (the cut-out gets the stage), come in one after another with a shimmering placeholder, and each product rises in once drawn (at least 0.45 s after its card), and the 3D code is fetched while the first photo is still being worked on. The label is centered. Products follow light/dark (black mug/shirt/tote in dark mode). Button names the product ("Put it on a mug", "Put it on a sticker", ...; it was "Make a mug" until the click took the cut-out along), outlined so Download stays the loud button. Ad cards are quieter than a photo card (2026-11-22, visitor review: same surface as the result): no card surface, no fill, a solid hairline (dashes read as empty slots or drop targets and vanished in dark mode, second review).
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

Clicking a non-Zazzle ad card (or any card with `?zazzlecap=0`) saves the cut-out shown on it (the card keeps that photo as `artIt`) as the see-through PNG whatever the card's background, size or format (`plainBlob`, also what Zazzle gets), ready to upload on the partner's site: a normal download on computers; on phones the share sheet comes first (Safari won't save from a tab that went to the background), then the partner opens (tested in the iOS Simulator 2026-11-21).
