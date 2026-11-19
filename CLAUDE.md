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

`app.js` picks an engine at load. Force one with `?engine=gpu` or `?engine=cpu`.

| Engine | Model | Runs on | Notes |
|---|---|---|---|
| gpu | BiRefNet lite fp16, MIT, 115 MB, pinned to HF commit de15b22 | WebGPU, needs `shader-f16` | ImageNet mean/std, outputs logits (sigmoid in JS) |
| cpu | IMG.LY ISNet medium fp16, AGPL, 88 MB | WebAssembly, 4 threads | input (x-128)/256, outputs 0..1 |

Findings on a real photo (oak tree, sky, grass):
- ISNet **small** (quint8, shipped first): garbage. Sky 0.47, 61% of pixels unsure. Do not use.
- ISNet **medium**: clean sky, but drops the tree crown, keeps only trunk. ~3.7 s on 2 sandbox CPU cores.
- BiRefNet lite: quality and speed not yet measured. Input is fixed at 1024x1024, so no low-res mode.

Requirement from Kevin: 10 to 30 seconds per photo is unacceptable. Target a few seconds.

## Next steps

1. Measure BiRefNet on WebGPU in Chrome on the Mac: `npm run dev`, open `/?engine=gpu`, add a photo.
   Each card gets `data-ms` with inference time. Check quality on hard photos (trees, hair, products).
2. Measure the CPU engine (`/?engine=cpu`) on the Mac. Decide if ISNet medium is an acceptable fallback.
3. If WebGPU is slow, try a newer onnxruntime-web (pinned at 1.21.0) before changing models.
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
