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
- One file for macOS: built and run (169 MB, BiRefNet only), see "Shipping it".
- A window for people who don't use a terminal: `goodbye-bg` with no arguments opens a local page in the browser
  (section below). Same speed as the command line.
- Windows x64 and Linux x64 one-file builds, made on the Mac (141 MB and 180 MB). Linux ran in Docker (CPU); Windows is
  built but has never run. See "Windows and Linux".
- Not done: a Windows run, a GPU on Linux, signing, a licence check, a native app (Dock icon, no Terminal window).

## A window: `goodbye-bg` with no arguments (prototype 2026-11-22)

Question 2 below ("CLI only, or wait for a window?"), answered cheaply: **a window now, in the browser, with no new
dependencies; a native app only if people buy.** Details, tests and numbers in `tools/bulk/README.md`.

What it is: `goodbye-bg` (or `goodbye-bg app`) starts a local server on 127.0.0.1 and opens the user's browser on a
small page in the site's look (same tokens and palette, no ads, no counts, no analytics, nothing fetched from
anywhere). Drop photos or a folder, or Choose folder; pick background, format, size and margin; Start. Thumbnails land
as photos finish, with the pace, time left and Stop; at the end, the folder's path and Show in Finder. About 840
lines: `lib/app.cjs` (server), `lib/app/` (page), and the folder mode's batch code moved to `lib/batch.cjs` so the CLI
and the window share it (CLI output byte for byte unchanged, checked).

What it gives:
- **The folder mode for people who don't type commands.** Double-clicking the binary should run it (macOS opens a
  Terminal window for a bare binary; not tried), and the browser shows the rest.
- **The same speed**: 175 to 185 photos a minute against the CLI's 174 to 184 in alternating runs on a busy machine
  (BiRefNet on the GPU). The model stays warm between batches.
- **Next to the input** for Choose folder (a native dialog run by goodbye-bg, so it knows the path): `Shop` gives
  `Shop cut-outs`, resumable. Drops can't be: browsers hide file paths, so dropped photos are sent to goodbye-bg over
  loopback and their cut-outs go to `~/Downloads/<folder> cut-outs` (or a folder picked with Change).
- **It stays in the one file**: the binary serves the page from its unpacked runtime; the window's 32-check Playwright
  test passes against the binary with no Node on the PATH.
- **Safe enough for a local server**: 127.0.0.1 only, a random token in the opened address on every API call, other
  origins and host names refused, Finder only ever opened on folders it made.

What a native app (Tauri or Electron around this page, or Swift) would add, and what this lacks:
- **No Terminal window.** A double-clicked bare binary opens Terminal, which looks broken to a shop owner. A `.app`
  bundle with a Dock icon, a menu and Quit is the real fix. Halfway step: a tiny `.app` wrapper (an `Info.plist` and a
  launcher script) around the same binary, with `LSUIElement` so no Terminal shows; not tried.
- **A clear lifecycle.** Here the process stops a minute after the last tab closes; closing the tab doesn't feel like
  quitting, and a second launch starts a second server on another port.
- **Real drops from Finder with paths**, so dropped folders can also be saved next to themselves and resumed.
- **Stapled notarization.** A `.app` in a `.dmg` can be stapled and opened offline; a bare binary can't (see
  "macOS: Gatekeeper").
- **Dock progress, notifications when a batch ends, "Open with" from Finder**, and a window that isn't one browser tab
  among forty.
- Cost: Tauri needs Rust and a WebView build per platform and still has to run this Node engine as a sidecar
  (onnxruntime-node and sharp are native Node modules), so it is mostly packaging work on top of this page, not a
  rewrite: perhaps 2 to 4 days rather than the 6 to 10 in `removebg-parity.md` for a fresh app, plus the $99 Apple
  membership to make it open without warnings.

Suggestion: ship the browser window with the CLI (it is already the default when there are no arguments), put a
screenshot of it on the sales page, and only build the native wrapper once a few copies sell or buyers ask.

## Drop-in for the remove.bg API (`goodbye-bg serve`, prototype 2026-11-22)

Question 3 below, answered with a working prototype: **yes, for most scripts, with one URL changed.** `goodbye-bg
serve` runs on `http://localhost:5000/v1.0` and answers `POST /v1.0/removebg` and `GET /v1.0/account` as remove.bg's
API reference documents them (https://www.remove.bg/api; the OpenAPI file https://www.remove.bg/api/swagger.yaml,
read 2026-11-22). Details and the full list in `tools/bulk/README.md`.

- Checked: remove.bg's own two curl samples, run unchanged but for the URL (the `image_url` one needs `--allow-urls`);
  66 checks in `tools/bulk/test/serve-test.mjs` (parameters, headers, JSON replies, HEIC, shadows, 23 of remove.bg's error codes); the Python `removebg` 0.4 and Node `remove.bg` 1.3.0 wrappers, file, URL and base64 calls each,
  with a dummy key and no account.
- Covered: the three image sources, `size` (with remove.bg's default `preview` = 0.25 MP and its caps), `format`
  auto/png/jpg/webp/zip, `channels=alpha`, `bg_color`, `bg_image_file`/`bg_image_url`, `crop` + `crop_margin`,
  `scale`, `position`, `roi`, `X-Width`/`X-Height`/`X-Foreground-*`/`X-Credits-Charged: 0`, their error shape and codes.
- Shadows: `shadow_type`, `shadow_opacity` (plain or per type) and `add_shadow` draw the site's soft ground shadow
  (the seller option, ported). One look for every type: remove.bg's "3D" and car shadows are their own, ours isn't.
  The type is the request's `type`, or "other"; nothing is detected.
- Not covered: foreground classification (`type` only picks per-type shadow settings, no `X-Type`),
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
  Remove Background quick action in Finder for several files at once. Both measured under "Against the free options".
  What we sell is convenience: one download, no Python, a GPU used out of the box, shop sizes and backgrounds, the
  same results as the site.
- With 69 views so far, expect next to no sales until the site has traffic. It is a small side income at best.

## Shipping it (tried 2026-11-22)

What selling it would really involve, tried on this Mac (M5 Pro, macOS 27.2) where possible. Nothing was bought,
enrolled in or signed up for. The machine was busy with other work during these runs (load average 20 to 77), so
treat the speeds as rough. The quiet-machine numbers are in the README.

### One file for macOS (built and run)

`tools/bulk/scripts/build-sea.mjs` builds one executable with Node's single executable applications
(`node --build-sea`, Node 26.13.1). Bun isn't installed here and wasn't needed.

- **Size: 169 MB, 67 MB zipped.** Node itself is 147 MB of that, and our part is 22 MB gzipped. Shrinking Node means
  building it from source with less ICU (not tried).
- **First run:** it unpacks 71 MB (onnxruntime 45 MB, libvips 17 MB, libheif 5.5 MB, our code) to
  `~/Library/Caches/goodbye-bg/runtime-<hash>/` in 0.2 s, then downloads the 93 MB model (about 11 s here). The 20
  photos took 22 s in all. Later runs start in about 2 s. The cache holds 96 MB of model and 68 MB of runtime.
- **Checked:**
  - It runs from an empty folder with no Node on the PATH (`env -i PATH=/usr/bin:/bin`) and uses WebGPU ("on the GPU").
  - Its cut-outs are byte for byte the same as the checkout's on 20 photos. Speed matched the checkout's in
    alternating runs.
  - The native libraries load from the unpacked folder, not the repo (`vmmap`).
  - `serve` answers a curl request.
  - `--licenses` prints the bundled licences.
- **Why it unpacks:** a SEA can only `require` Node's built-in modules. Native addons with their dylibs, and worker
  threads, need real files. Unpacking also keeps the LGPL libraries (libvips, libheif) as separate files a user could
  replace, as the LGPL asks.
- **Not secret:** the JavaScript sits in the binary as plain text and is unpacked to disk. A "closed" build is closed
  by licence, not by obscurity: anyone can read it or patch out a check.
- **Found on the way, now fixed:** onnxruntime-node 1.31 has Microsoft's usage telemetry (1DS) built in.
  - It wrote a device ID and queued session events (Mac model, macOS version, the app name "goodbye-bg", timings) to
    `~/Library/Application Support/Microsoft/DeveloperTools/.onnxruntime/`.
  - In two short test runs with a fresh home folder, `lsof` (polled every 0.1 s) saw no socket and the queue only grew
    (31, then 48 events); polling can miss a short upload. Kevin's own profile has the folder (written by earlier runs,
    including this session's before the fix), and its queue was empty right after: **likely sent to Microsoft, not
    confirmed.**
  - `lib/engine.cjs` now sets `ORT_DISABLE_TELEMETRY=1` before ORT loads. Checked: nothing is written there now. The
    Linux and Windows builds carry the same code and the same switch.
  - The quality harness (`scripts/quality`) still runs ORT without the switch.

### BiRefNet-only by default

The build leaves out every line marked `// AGPL-only`: ISNet's download address and checksum, its model settings, its
`--model` choice, and the hint pointing to it. It stops if anything naming ISNet's model is left. `--open` makes the
AGPL build with ISNet.

Checked on the binary:
- `--model isnet` gives "--model takes birefnet". Both help texts say "birefnet (the only model in this build)".
- After a run, the empty cache holds only `birefnet-f71d1be4.onnx`.
- `strings` finds no ISNet address or checksum. The only "ISNet" left in the unpacked code is two comments in
  `pipeline.cjs`, about the haze fix the BiRefNet path never calls.
- The README's licence notes (LGPL parts, HEVC in libheif) still apply.

### macOS: Gatekeeper and notarization

**Without signing (what a buyer would get today):**
- The binary carries only an ad hoc signature. Apple silicon needs at least that to run it, and the build adds it.
- A browser download gets the `com.apple.quarantine` flag. I set that flag on a copy by hand:
  - `spctl -a -t execute` said "rejected".
  - Run from Terminal, the process hung before its first instruction (stuck in `_dyld_start`) until it was killed.
    It was presumably waiting on Gatekeeper's dialog, which I couldn't see.
  - `xattr -d com.apple.quarantine` afterwards did not unblock that same file. A fresh copy without the flag ran at once.
- So the workaround has to come **before** the first run: `xattr -d com.apple.quarantine goodbye-bg` (or
  `xattr -cr` on the unzipped folder). The other route is System Settings > Privacy & Security > "Open Anyway" after a
  blocked try; since macOS 15 a right-click > Open no longer gets past it (from Apple's notes, not tried here).
- **curl doesn't set the flag.** Tested: the zip and the bare binary fetched with curl from a local server had only
  `com.apple.provenance`, and ran at once. So for terminal users, an install line
  (`curl -fsSL https://goodbye.bg/install.sh | sh`) or a Homebrew tap works without signing. That fits a CLI's buyers.
  Anyone who clicks a download link in a browser hits the block.

**Notarized (what $99 a year buys):**
- **Apple Developer Program, $99 a year.** Enrolment needs an Apple Account with two-factor authentication. As an
  individual it is quick; a company needs a D-U-N-S number. Not enrolled.
- **Sign** with a "Developer ID Application" certificate and the hardened runtime (`codesign --options runtime
  --timestamp`).
- **Node under the hardened runtime needs entitlements:**
  - `com.apple.security.cs.allow-jit` (V8 compiles code), and probably `allow-unsigned-executable-memory`.
  - Because the unpacked `.node` and `.dylib` files are signed by others (or ad hoc), either
    `com.apple.security.cs.disable-library-validation`, or re-signing each of them with Kevin's ID before packing.
  - Unpacked files are written by our own process: checked, they carry no quarantine flag (only
    `com.apple.provenance`). Library validation is the only hurdle for them.
- **Notarize:** `xcrun notarytool submit goodbye-bg.zip --wait` (an app-specific password or API key). It takes
  minutes.
- **Staple:** a bare Mach-O can't be stapled; only an app bundle, a disk image or an installer package can. A
  notarized bare binary in a zip is checked online by Gatekeeper on first launch: fine with a network, blocked
  offline. A `.pkg` that installs to `/usr/local/bin`, stapled, avoids that, and it can be signed with a "Developer
  ID Installer" certificate from the same membership.
- **Not tried:** any of the signed path (needs the membership).

### Windows and Linux (built on the Mac, 2026-11-22)

- **Both build on the Mac, no CI.** `build-sea.mjs --target win32-x64` or `linux-x64`: Node 26's `--build-sea` injects
  into another platform's official Node (PE or ELF). The script downloads that Node from nodejs.org (sha256 checked)
  and sharp's binaries with `npm pack` (checked against `package-lock.json`); onnxruntime-node already carries Windows
  x64 (WebGPU, DirectML, 68 MB) and Linux x64 (WebGPU, 47 MB) binaries.
- **Windows x64: 141 MB, 79 MB zipped.** Checked: a valid PE32+ x86-64 file, the SEA fuse set, and the bundle lists
  `onnxruntime.dll`, `DirectML.dll`, `dxcompiler.dll`, sharp and libvips. **Never run**: there is no Windows machine
  here. Unknowns: whether it starts at all, WebGPU (there's no dxil.dll next to dxcompiler.dll), DirectML, the
  PowerShell folder dialog, Explorer, and whether `ORT_DISABLE_TELEMETRY` also silences ONNX Runtime's Windows-only
  event-tracing telemetry (the switch is in the DLL; the Linux run wrote no telemetry files). DirectML.dll and
  dxcompiler.dll are under Microsoft's licences (not MIT); their texts must be added before a release.
- **Linux x64: 180 MB, 76 MB zipped** (nodejs.org's Linux Node keeps debug symbols). Ran in Docker on this Mac
  (Debian 12, x86-64 emulated): `--licenses`, a folder run and `serve` with curl all worked; no GPU in the container,
  so it said so and used the CPU (4.7 s a photo, emulated). The cut-out matches the Mac's CPU engine within 3/255.
  Needs `libatomic.so.1` (desktop distributions have it; slim containers need `apt-get install libatomic1`). Not run:
  a real Linux GPU (Vulkan), the window, other distributions.
- Exact commands and the per-platform table: `tools/bulk/README.md`, "Windows x64 and Linux x64, built on the Mac".
- A run on a real Windows PC with a GPU is the missing step before selling there.
- **Windows:** without a signature, SmartScreen shows "Windows protected your PC" (More info > Run anyway) until a file
  builds up reputation. Signing:
  - Microsoft's Trusted Signing, about $10 a month, with identity checks, open to individuals in some
    countries.
  - Or a code-signing certificate, a few hundred dollars a year, on a hardware key.
  - The GPU path (WebGPU, then DirectML) is untested: it needs a Windows PC with a GPU.
- **Linux x64:** no signing culture; a tarball or the install line. WebGPU through Vulkan might work (untested);
  otherwise BiRefNet on the CPU, at 3.4 s to 7 s a photo.
- **Intel Macs:** onnxruntime-node 1.31 ships no darwin x64 binary. Not supported.

### Licence keys

1. **None (honour system):** a download link after paying. Nothing to break, no network, and no worse in practice
   than option 2.
2. **Offline signed keys:** the key is the order email plus an Ed25519 signature, checked against a public key in
   the binary. No server or network at run time.
   - Something signs keys after a sale: the store's licence keys (Lemon Squeezy, Gumroad), a webhook to a Pages
     Function with a secret, or Kevin by hand at first.
   - Since the JavaScript is readable (above), the check is a speed bump: one line to remove. It mainly reminds honest
     people.
3. **Online activation** (the store's licence API): the tool would call out at first run, which breaks "the only
   network use is the model download". Avoid.

**Recommendation: 1 at launch.** Add 2 only if copies clearly circulate. A key isn't worth the support load it
creates (lost keys, new machines).

### Where the checkout link would go

- **No payment code on the app page.** The CSP (own origin only) and the no-third-party rule stay. A plain link out
  to the store's hosted checkout, on a separate page such as `/bulk` (or on the remove.bg page), next to
  "Download for Mac". The link opens Lemon Squeezy, Gumroad or Paddle; after paying, the store's receipt page and
  email carry the download link and install line.
- A merchant of record handles VAT and US sales tax: Lemon Squeezy, Gumroad or Paddle. Roughly 5 to 10% a sale; check
  current terms.
- Needs Kevin: an account, payout details, tax forms. None created.
- Model hosting for a sold copy needs a fixed address (open question 7). `m/birefnet-f71d1be4/` disappears with the
  next model export.

### Against the free options (measured 2026-11-22)

**What was run:**
- 40 photos with real masks from the quality set: 12 AIM-500, 8 P3M, 8 AM-2k, 6 DIS, 6 Oxford pets; 1.9 MP on
  average. Scored like the quality harness (`score()` in `scripts/quality/pipeline.cjs`).
- **rembg 2.0.87** (MIT, onnxruntime 1.32 for Python), CPU provider. Its default `u2net`, and `birefnet-general-lite`
  (the same BiRefNet lite model we use).
- Installing rembg: `pip install rembg` failed on this Mac's Python 3.15 (no onnxruntime wheel yet; scikit-image
  wouldn't build). It needed uv and a separate Python 3.12. That is the friction we would sell against.
- **Apple Vision** (`VNGenerateForegroundInstanceMaskRequest`, a 40-line Swift script). This is the subject-lifting
  API that Finder's Remove Background most likely uses; Finder itself can't be scripted for a measurement.
- "Time a photo" isn't quite like for like. Ours is the model run only (the photo is decoded and encoded around it, in
  parallel). rembg's is its whole `remove()` call. Vision's is the request plus scaling the mask.

| | Mean IoU | Median | 0.95 or better | Under 0.8 | Edge (boundary IoU) | Time a photo |
|---|---|---|---|---|---|---|
| **goodbye-bg, BiRefNet, GPU** | 0.977 | 0.989 | 36 of 40 | 0 | 0.916 | 0.32 s (164 a minute) |
| goodbye-bg, BiRefNet, CPU | 0.977 | 0.989 | 36 | 0 | 0.915 | 7.1 s |
| rembg `birefnet-general-lite`, CPU | **0.981** | 0.990 | 37 | 0 | 0.921 | 4.7 s |
| rembg `u2net` (its default), CPU | 0.815 | 0.968 | 22 | 11 | 0.673 | 0.54 s |
| Apple Vision (Finder's engine, likely) | 0.932 | 0.979 | 33 | 4 (1 found nothing) | 0.810 | **0.025 s** |

**Quality:**
- **Same model, same quality.** On people, animals and pets, rembg's BiRefNet lite and ours score the same: AIM-500
  0.985 against 0.986, P3M 0.991 against 0.992, AM-2k and pets equal.
- It differs only on thin DIS objects: a kite 0.81 against 0.86, a sculpture 0.88 against 0.95. Our despeckle or
  fp16 copy likely drops fine parts there. **Our quality is not something rembg users lack.**
- rembg's **default** model (u2net) is clearly worse: 20 of the 40 photos at least 0.02 worse than ours, 11 under 0.8.
  Most people who try rembg without picking a model get that.
- **Apple Vision** is free, already on every Mac that has it, and very fast (25 ms a photo). It is as good as
  ours on people and pets (0.974 to 0.995 by set). It fails on objects: the ladder, kite and clothes 0.6 to 0.7, a
  tripod not found at all. Its edges are coarser (boundary IoU 0.81 against 0.92).

**Speed:**
- On the GPU ours is about 15x rembg's CPU speed. rembg can use CoreML on a Mac, or CUDA with NVIDIA (`rembg[gpu]`);
  that wasn't tested.
- On the CPU ours was slower than rembg here (7.1 s against 4.7 s). The machine was busy, so take it loosely; our fp16
  model with the GridSample rewrite is built for WebGPU, not the CPU. Not looked into.

**Finder's Remove Background (Quick Action; from memory, not run here):**
- Select files > right-click > Quick Actions > Remove Background. It saves a cut-out next to each one.
- Free, no install, fine for a few people or pet photos.
- No folders of thousands, resume, sizes, backgrounds or JPG output, and nothing scriptable. Weak on products and thin
  objects, by the Vision numbers above.

**What's left to sell, honestly:**
- One download with no Python.
- The GPU used out of the box (164 to 213 a minute).
- Shop options (`--bg`, `--size`, `--pad`, `--crop`).
- Resume after a stop.
- The **remove.bg API drop-in**, which neither rembg nor Finder offers. rembg's own server has its own API, not
  remove.bg's.
- The same results as the website.

It is convenience and a migration path, not better cut-outs.

### Price recommendation

**$29 once, one tier, every feature including `serve`. No subscription, no keys at launch. Sell only once it is signed,
or only to terminal users through the install line.**

- **Ceiling:** the buyer's alternative is free, with the same model (rembg, a Python setup away) or nearly as good on
  people (Finder). Above about $49 a technical buyer spends an hour on rembg instead.
- **Floor:** what it replaces. A remove.bg API user paid per image (roughly $0.10 to $0.20 at volume; check before
  quoting). At $29, 150 to 300 images pay for it, and such users often run thousands a month. A shop moving off
  remove.bg's desktop app gets the folder mode.
- **One price** because there are too few buyers to test tiers on (69 site views so far). A "team / server" price
  ($79 to $99) can come later if companies ask for invoices or several machines.
- **Costs:** Apple's $99 a year needs about 4 sales a year after store fees (about $26 net a sale). Windows signing
  adds about $120 a year. So **macOS first** (all current Macs are Apple silicon, measured here). Windows only once
  Macs sell, and after a test on a real Windows GPU.
- **Expect little:** with almost no traffic, a handful of sales a month at best, mostly from the remove.bg shutdown
  page. The free website stays the trial. The open AGPL source stays public: buyers pay for the built, signed binary
  and the convenience, which is how many open-source tools sell.
- **The cheapest real test:** a "Download for Mac, $29" link on the remove.bg page through a merchant of record. Ship
  it to terminal users via the install line first (no signing yet), and count clicks against sales before paying
  Apple.

## Licences (details in the README)

- BiRefNet (MIT) build: can be closed source. ISNet (AGPL) must be left out of it entirely.
- Kevin wrote all of the code, so he can sell a closed build of his own AGPL code; the public repo stays AGPL.
- LGPL parts (sharp's libvips, libheif) ship as separate replaceable files with their licences.
- HEIC: libheif-js includes an HEVC decoder (libde265). Selling a product with an HEVC decoder can carry patent
  royalties. On Macs use Apple's decoder instead (ImageIO or `sips`, already licensed); on Windows rely on the
  system's HEVC extension, or leave HEIC out of the paid build.

## Open questions for Kevin

1. Sell it at all, given free `rembg` and the Finder quick action? Or keep it free and open as a reason to visit,
   with a "support" link? Measured: rembg's BiRefNet lite gives the same quality as ours; what we'd sell is
   convenience, GPU speed and the remove.bg API drop-in ("Against the free options").
2. CLI only, or wait for a window? **Answered with a prototype: the browser window above** (no arguments opens it; same
   speed; in the one file). A native wrapper (Dock icon, no Terminal, stapled .dmg) only once copies sell?
3. A local remove.bg-compatible server: built as a prototype (`goodbye-bg serve`, section above). It works with one
   URL changed (one line for the common Python and Node wrappers). Keep it, and say so on the remove.bg page?
4. Licence keys: none, or offline signed keys? (Suggested: none at launch; a readable binary makes a key a speed bump.)
5. Pay $99 a year for Apple signing, and a Windows certificate? Needed before selling to people who download in a
   browser; terminal users can install with curl, which Gatekeeper doesn't block (tested).
6. Default model on the CPU: BiRefNet everywhere (MIT, better, 17.5 a minute here) or ISNet on machines without a
   GPU (4x faster, but AGPL)?
7. Where models come from once goodbye.bg is live: the site (as now, `goodbye-bg-git.pages.dev`) or a release asset.
   The CLI pins `m/birefnet-f71d1be4/`; the build names that folder after the model's hash, so the next BiRefNet
   export removes it from the site and breaks the first download of any copy already handed out. A paid build needs
   a fixed home for its model (a release asset, or the site keeping old model folders).
8. HEIC in a paid build: Apple's decoder on Macs and none on Windows, or pay attention to HEVC licensing?
