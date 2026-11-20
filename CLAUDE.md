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
- `models/` (gitignored) local copy of BiRefNet. The build downloads it if missing and checks its SHA-256.

## Rules

- Content-Security-Policy on the app page allows network only to its own origin. Keep it that way.
- No analytics, no cookies, no third-party scripts or fonts on the app page.
- Dark/light follows the system. No toggle.
- Copy: plain, short, active voice.

## Engines (current work)

`app.js` uses the cpu engine unless the address has `?engine=gpu` (opt-in since 2026-11-20, because the gpu
engine fails on every photo; see findings below).

| Engine | Model | Runs on | Notes |
|---|---|---|---|
| gpu | BiRefNet lite fp16, MIT, 115 MB, pinned to HF commit de15b22 | WebGPU, needs `shader-f16` | ImageNet mean/std, outputs logits (sigmoid in JS) |
| cpu | IMG.LY ISNet medium fp16, AGPL, 88 MB | WebAssembly, 4 threads | input (x-128)/256, outputs 0..1 |

Findings on a real photo (oak tree, sky, grass):
- ISNet **small** (quint8, shipped first): garbage. Sky 0.47, 61% of pixels unsure. Do not use.
- ISNet **medium**: clean sky, but drops the tree crown, keeps only trunk. ~3.7 s on 2 sandbox CPU cores.
- BiRefNet lite: input is fixed at 1024x1024, so no low-res mode.

Measured 2026-11-19 in Chrome 157 on an M5 Pro (18 cores, Apple metal-3 GPU, crossOriginIsolated, 4 wasm threads
in a worker), photo `Solitary Tree in a Sunlit Meadow.png` (1024x1536):
- **gpu: does not run.** The session loads and says "Running on your GPU", then every photo fails with
  "Could not process this image". BiRefNet has Concat nodes with 17, 65 and 125 inputs. ORT 1.21.0 builds one
  shader per Concat: it exceeds the device's 8 storage buffers per stage (the adapter allows 10), and the
  125-input one breaks WGSL's nesting limit of 127. The CPU fallback only covers session creation, not `run`,
  so any browser with `shader-f16` (all Apple silicon Chrome) would fail on every photo. This is not on
  `main` yet (commit e960847 is local only). Do not push it as is.
- **gpu on ORT 1.31.1** (tried, reverted): the Concat errors are gone and the device gets 10 buffers, but one
  shader still needs 11: `Too many storage buffers in shader. Current: 11, Max is 10`. Fails cleanly, no freeze.
  1.31.1 also changes the runtime files (`ort-wasm-simd-threaded.asyncify.*` instead of `.jsep.*`), and its
  wasm is 27.4 MiB, over the 25 MiB Pages limit, so it would need splitting.
- **cpu (ISNet medium)**: 6.6 s per photo cold and warm on ORT 1.21.0 (end to end 6.8 s); 5.2 to 6.0 s on 1.31.1.
  Model ready ~4 s after page load (served from the local server). On this tree it keeps the whole crown
  (contradicts the note above), removes sky and grass; only the sunlit right edge of the crown turns half
  transparent.
- **cpu on four more photos** (Wikimedia Commons, 1920 px wide, 2026-11-20): 6.0 to 6.8 s each, four in a
  batch took 26.7 s. Woman with long dark hair in front of a crowd: crowd fully removed, hair outline solid but
  blocky, fine strands lost. Girl hugging a dog: clean, pigtails and fur kept. Bicycle against graffiti:
  frame and spokes kept, but a blue graffiti blob stays behind the rear wheel. Cat close-up on a soft blurred
  background: **fails**, keeps the blurred background on the left and bottom as part of the cat.
- `/ort/*` and `/m/*` are cached `immutable` for a year under fixed names. Changing the ORT version or a model
  serves the old file to returning visitors. Put the version in the path when upgrading.

Requirement from Kevin: 10 to 30 seconds per photo is unacceptable. Target a few seconds.

## Next steps

1. Fix or drop the gpu engine (now opt-in). Options: a BiRefNet export that avoids the wide Concats, or a
   different model. Before making it the default again, it needs a real fallback. Retrying on the CPU in the same
   page does not work (tried 2026-11-20): one ORT wasm instance backs both engines, the failed WebGPU run aborts
   it, and the CPU session then fails with "no available backend found". Run the gpu engine in its own Worker
   and terminate it on failure, or load a separate wasm-only ORT build for the CPU (one more runtime file).
   The 125-input Concat breaks WGSL's nesting limit, which every Chrome enforces, so ORT 1.21 most likely fails
   on all platforms, not only Macs (only tested on the M5 Pro).
2. ISNet medium is a usable fallback for people and pets in scenes, weak on close-ups with blurred
   backgrounds (cat) and busy backdrops (graffiti). It is not good enough to be the only engine.
3. If staying on CPU, 5 to 7 s on an M5 Pro means phones will be much slower. Consider more threads or a smaller input.
4. Merge, push, and check the preview, then production.
5. Not yet tested on real devices: Android share target, desktop "Open with", folder drops, live link fetching.

## Open items outside the code

- Domain goodbye.bg ordered at Netim (trustee service) on 2026-11-19, waiting on the trustee ID check.
  Nameservers are set to Cloudflare (`lou.ns.cloudflare.com`, `mira.ns.cloudflare.com`). When it registers:
  click "Check nameservers" on the zone, then add goodbye.bg as a custom domain on `goodbye-bg-git`.
- Git email: repo uses the GitHub noreply address. The first commit (aa3d4bd) still has the work email;
  fix with `git commit --amend --reset-author --no-edit && git push --force-with-lease` if wanted.
- License: repo is AGPL-3.0 because the ISNet model is AGPL. If the CPU engine moves off ISNet,
  the license can change.
