# Bulk CLI: what selling it would take (2026-11-22)

Prototype on branch `bulk-cli`, in `tools/bulk/` (usage, numbers and licences in its README). It is item 8 and
money idea 2 in `docs/removebg-parity.md`: a tool for people with thousands of photos, running on their own
computer, sold once. Nothing here has been bought, signed up for or published.

## Where it stands

- Works on this Mac: a folder of photos in, full-size cut-outs out, same models and steps as the site.
- BiRefNet on the GPU: **213 photos a minute** (1.8 MP photos), 116 a minute at 24 MP, about 4 GB peak.
  ISNet on the CPU: 74 a minute. BiRefNet on the CPU: 17.5 a minute (about 1,000 an hour, fine overnight).
- Masks match the site's (quality harness): mean IoU 0.991 on 100 photos.
- Product-photo options are there: `--bg white`, `--size 2000x2000 --pad 8%`, `--crop`, JPG/WebP/PNG.
- Not done: Windows and Linux runs, a single-file build, signing, a licence check, a window for people who
  don't use a terminal.

## Drop-in for the remove.bg API (`goodbye-bg serve`, prototype 2026-11-22)

Question 3 below, answered with a working prototype: **yes, for most scripts, with one URL changed.** `goodbye-bg
serve` runs on `http://localhost:5000/v1.0` and answers `POST /v1.0/removebg` and `GET /v1.0/account` as remove.bg's
API reference documents them (https://www.remove.bg/api; the OpenAPI file https://www.remove.bg/api/swagger.yaml,
read 2026-11-22). Details and the full list in `tools/bulk/README.md`.

- Checked: remove.bg's own two curl samples, run unchanged but for the URL (the `image_url` one needs `--allow-urls`);
  53 checks in `tools/bulk/test/serve-test.mjs` (parameters, headers, JSON replies, HEIC, 23 of remove.bg's error codes); the Python `removebg` 0.4 and Node `remove.bg` 1.3.0 wrappers, file, URL and base64 calls each,
  with a dummy key and no account.
- Covered: the three image sources, `size` (with remove.bg's default `preview` = 0.25 MP and its caps), `format`
  auto/png/jpg/webp/zip, `channels=alpha`, `bg_color`, `bg_image_file`/`bg_image_url`, `crop` + `crop_margin`,
  `scale`, `position`, `roi`, `X-Width`/`X-Height`/`X-Foreground-*`/`X-Credits-Charged: 0`, their error shape and codes.
- Not covered: shadows (a 400 `unsupported_parameter`), foreground classification (`type` is ignored, no `X-Type`),
  car-window semitransparency, rate-limit headers, `/improve`. The cut-out is ours, not theirs.
- The catch: both wrappers hard-code `https://api.remove.bg`. Python is a one-line override at run time; Node needs
  the constant in `dist/index.js` replaced. Scripts that call the API directly (curl, `requests`, `fetch`, most
  in-house code) only change the URL.
- Speed: 216 photos a minute with 4 requests in flight (BiRefNet, GPU, 1.6 MP photos, full-size PNG), the same as
  the folder mode; 129 a minute for a script that sends one photo at a time. remove.bg's own limit is 500
  megapixel-images a minute.
- Safety: binds to 127.0.0.1 and ::1 only, no network use but the one-time model download unless `--allow-urls`, refuses requests from web pages
  (`Origin` header) and unknown `Host` names. No key check, so `--host 0.0.0.0` shares it with the whole network.
- macOS: AirPlay Receiver holds port 5000 on every address; `localhost:5000` would reach it (a 403 from AirTunes)
  without the extra ::1 listener.
- For selling: it makes the CLI the obvious buy for remove.bg API users (keep the scripts, stop paying per image),
  and the page could say "change one URL". A paid build would be BiRefNet-only (MIT).

## Who would pay, honestly

- People who ran remove.bg's API or desktop app over whole folders: shops, marketplaces, photographers. They lose it
  on 1 Dec. A CLI suits the ones who had scripts; most shop owners want a window, not a terminal.
- Free competition is real: `rembg` (MIT, Python, has BiRefNet too) does bulk locally for free, and macOS has a
  Remove Background quick action in Finder for several files at once (worth checking how it does on product shots).
  What we sell is convenience: one download, no Python, a GPU used out of the box, shop sizes and backgrounds, the
  same results as the site.
- With 69 views so far, expect next to no sales until the site has traffic. It is a small side income at best.

## Price

**$19 to $39 once**, with $29 as the default guess; a "team" price around $79 to $99 for a company using it on
several machines. No subscription: nothing runs on our side, and "pay once" is the point against remove.bg's
credits. Free trial: the free website already is one (same results, one photo at a time). Check current
remove.bg, Photoroom and Clipdrop prices before launch so the comparison on the page is true.

## Checkout

A link out of the site to a hosted checkout, nothing on the app page (keeps the CSP and the no-tracking rule).
- **Lemon Squeezy** or **Gumroad**: merchant of record (they handle VAT and sales tax), hosted page, file delivery,
  built-in licence keys. Gumroad is the quickest to set up; Lemon Squeezy has a cleaner licence API. Fees roughly
  5 to 10% a sale; check current terms.
- **Paddle**: also merchant of record, more set-up and review, better for a bigger product later.
- Needs Kevin: an account, payout details, tax forms. None created.

## Licence keys: three options

1. **None.** Buyers get the download link; the honour system. Simplest, nothing to break, nothing phoning home.
   Fits an open-source tool (the AGPL build can be copied anyway).
2. **Offline signed key** (recommended if any). On purchase, a key = the order email plus an Ed25519 signature.
   The binary carries the public key and checks it offline: no server, no network, no tracking. Needs something to
   sign keys after a sale: a webhook to a Pages Function (`functions/api/...`, a secret in Cloudflare) or Kevin
   signing by hand at first.
3. **Online activation** (Lemon Squeezy or Gumroad licence API). Easy, but the tool then calls out on first run,
   which weakens "nothing leaves your computer" (photos still don't). Avoid.

## Packaging

The tool is Node, two native packages (onnxruntime-node and sharp: ONNX Runtime 45 MB and libvips 17 MB on a
Mac), libheif-js (9 MB) and the 93 MB model.
- **Node SEA** (single executable application): bundles the JavaScript into a copy of `node`. Native `.node` addons
  and their `.dylib`/`.dll` files can't load from inside the blob: they ship next to the binary or are written to a
  temp folder at start. Not tried yet.
- **`bun build --compile`**: one file, and Bun can embed N-API addons (it unpacks them at run time). Not installed
  here, not tried; whether onnxruntime-node's WebGPU works under Bun is unknown.
- **A folder** (`node` + app + `node_modules` for that platform, plus a launcher) is the safe first step and easy to
  sign file by file. About 180 MB unpacked for one platform with a Node of about 110 MB (not measured as a zip); the model
  downloaded on first run, or bundled for about 275 MB.
- The model: download on first run (as now, from the site) or ship inside. A closed build must never fetch ISNet.

## Signing

- **macOS**: an Apple Developer account ($99 a year). Sign every `.node` and `.dylib` with the hardened runtime,
  submit with `notarytool`, staple to the zip's app or a `.pkg`. Without it Gatekeeper blocks the download.
  Apple silicon only is fine to start (all current Macs; WebGPU via Metal measured here).
- **Windows**: without signing, SmartScreen warns. A code-signing certificate (a few hundred dollars a year) or
  Microsoft's Trusted Signing (monthly). onnxruntime-node ships WebGPU and DirectML for Windows; the tool tries
  WebGPU, then DirectML, then the CPU. Untested: needs a Windows PC with a GPU.
- **Linux**: untested; probably CPU only in onnxruntime-node's default build (CUDA is an extra download). Lowest priority.

## Licences (details in the README)

- BiRefNet (MIT) build: can be closed source. ISNet (AGPL) must be left out of it entirely.
- Kevin wrote all of the code, so he can sell a closed build of his own AGPL code; the public repo stays AGPL.
- LGPL parts (sharp's libvips, libheif) ship as separate replaceable files with their licences.
- HEIC: libheif-js includes an HEVC decoder (libde265). Selling a product with an HEVC decoder can carry patent
  royalties. On Macs use Apple's decoder instead (ImageIO or `sips`, already licensed); on Windows rely on the
  system's HEVC extension, or leave HEIC out of the paid build.

## Open questions for Kevin

1. Sell it at all, given free `rembg` and the Finder quick action? Or keep it free and open as a reason to visit,
   with a "support" link?
2. CLI only, or wait for a window (Tauri around the web app, 6 to 10 days per `removebg-parity.md`)? Shops mostly
   want the window.
3. A local remove.bg-compatible server: built as a prototype (`goodbye-bg serve`, section above). It works with one
   URL changed (one line for the common Python and Node wrappers). Keep it, and say so on the remove.bg page?
4. Licence keys: none, or offline signed keys?
5. Pay $99 a year for Apple signing, and a Windows certificate? (Needed before selling to non-developers.)
6. Default model on the CPU: BiRefNet everywhere (MIT, better, 17.5 a minute here) or ISNet on machines without a
   GPU (4x faster, but AGPL)?
7. Where models come from once goodbye.bg is live: the site (as now, `goodbye-bg-git.pages.dev`) or a release asset.
   The CLI pins `m/birefnet-f71d1be4/`; the build names that folder after the model's hash, so the next BiRefNet
   export removes it from the site and breaks the first download of any copy already handed out. A paid build needs
   a fixed home for its model (a release asset, or the site keeping old model folders).
8. HEIC in a paid build: Apple's decoder on Macs and none on Windows, or pay attention to HEVC licensing?
