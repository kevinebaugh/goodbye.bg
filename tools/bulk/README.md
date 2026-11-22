# goodbye-bg (bulk, prototype)

Removes the background from every photo in a folder, on your own computer. Photos are never uploaded. The only
network use is a one-time download of the model from the goodbye.bg site, checked against a pinned sha256 and
kept in your cache folder. ONNX Runtime's own usage telemetry (Microsoft's, built into onnxruntime-node 1.31) is
switched off before it loads (`ORT_DISABLE_TELEMETRY=1`); without that it kept a device ID and queued events in
`~/Library/Application Support/Microsoft/DeveloperTools/.onnxruntime`.

It uses the same model files and the same steps as the site, so a cut-out matches what the site gives for the
same photo: the 1024 px model input, despeckle, ISNet's haze fix, the edge curve, edge colours, and the mask
scaled up to the photo's full size.

## Use

    cd tools/bulk && npm ci          # Node 20 or newer; install on the machine that runs it (native packages)
    node bin/goodbye-bg.cjs ./photos --out ./cutouts
    npm link && goodbye-bg ./photos  # or put it on your PATH

The name `goodbye-bg` is not published on npm yet, so `npx goodbye-bg` only works after `npm link`, or as
`npx ./tools/bulk ./photos`.

    goodbye-bg <photos or folders...> [options]

    --out <dir>      where cut-outs go (default ./cutouts). Subfolders are kept.
    --bg <color>     white, black or #rrggbb (default transparent)
    --format <f>     png, jpg or webp (default png, or jpg with --bg)
    --crop           crop to the subject with a little room, like the site
    --size <WxH>     the subject centred on a WxH canvas, e.g. 2000x2000 (one number: square)
    --pad <n%>       room around the subject with --size, per side (default 5%)
    --model <m>      birefnet (default, MIT) or isnet (AGPL, faster on the CPU)
    --engine <e>     auto (default), gpu or cpu
    --jobs <n>       photos in flight at once (default 3)
    --force          redo photos that already have a cut-out

Examples:

    goodbye-bg ./shop --out ./shop-white --bg white --size 2000x2000 --pad 8%
    goodbye-bg ~/Pictures/2026 --out ./cutouts --crop --format webp

- Reads JPG, PNG, WebP, AVIF, TIFF, GIF (first frame) and HEIC, in folders and subfolders. Skips dot-files,
  `__MACOSX` and the output folder.
- EXIF orientation is applied. Output is full size (or `--size`), sRGB, without metadata.
- See-through inputs (PNG cut-outs, logos) go to the model on white, or on black when the subject is light, as on the site.
- Stops cleanly on Ctrl-C. Run the same command again to carry on: a cut-out newer than its photo is skipped. Files
  are written whole and then renamed, so a crash never leaves a half file behind that would be skipped.
- The settings are kept in `<out>/.goodbye-bg.json`. Running into a folder that holds cut-outs made with other
  settings stops and asks for `--force` (or another `--out`), so one folder doesn't mix two looks by accident.
- `a.jpg` and `a.png` in one folder become `a.png` and `a-png.png`.
- If the GPU fails to start, fails a run or returns NaN, the rest runs on the CPU. `GOODBYE_BG_GPUFAIL=init|run`
  simulates that.
- Other switches: `GOODBYE_BG_CACHE` (model folder), `GOODBYE_BG_SITE` (where models come from),
  `GOODBYE_BG_STATS=<file>` (writes the run's numbers as JSON).

How it runs: one ONNX Runtime session (onnxruntime-node 1.31.1) on the main thread, one run at a time. `--jobs`
worker threads decode, prepare the input, post-process and encode around it, so the GPU never waits for a PNG.
Each worker holds one photo (a 24 MP photo is about 100 MB of pixels plus its mask).

## Numbers (2026-11-22, this Mac)

Apple M5 Pro, 18 cores, 48 GB, Node 26.13.1. 100 photos from the quality set (50 AIM-500, 15 P3M, 10 AM-2k,
10 Oxford pets, 8 DIS, 7 COCO), 1.8 MP on average. A fresh output folder each time, model already cached.

| Model, engine | Photos a minute | Model per photo | Start | Peak memory footprint |
|---|---|---|---|---|
| BiRefNet, GPU (WebGPU) | **213** | 275 ms | 0.9 s | 4.1 GB |
| ISNet, GPU | 480 (597 with `--jobs 6`) | 84 ms | 0.2 s | 1.9 GB (2.2 GB) |
| ISNet, CPU | 74 | 808 ms | 0.2 s | 4.2 GB |
| BiRefNet, CPU (20 of the photos) | 17.5 | 3.4 s | 0.7 s | 4.8 GB |
| BiRefNet, GPU, 24 MP photos (20 photos at 6000x4000) | 116 | 271 ms | 0.8 s | 4.7 GB |

- "Photos a minute" is from the first photo to the last, start-up not included. Start-up is session creation plus
  the GPU warm-up. The first run also downloads the model: 93 MB for BiRefNet took about 8 s here.
- Peak memory footprint is macOS's figure from `/usr/bin/time -l`. On Apple silicon it seems to include the GPU's
  share of memory: resident memory was 1.2 GB for BiRefNet on the GPU and 3.7 GB for ISNet on the CPU.
- BiRefNet on the GPU is limited by the model (100 x 275 ms is 27.5 s of the 28 s). ISNet on the GPU is limited by the
  post-processing, which is why more jobs help it.
- BiRefNet on the CPU: 3.4 s a photo and 4.8 GB peak here over 20 photos, against 9.9 s and 6.7 GB for one photo
  noted before in `docs/birefnet.md` (also onnxruntime-node). Not looked into; start-up and thread count may differ.
- At 24 MP, encoding the full-size PNG is the main extra cost.
- The 24 MP photos are the same photos scaled up, so they measure size, not quality.

Same results as the site: masks compared with the quality harness's (`scripts/quality`, checked against the page
on 20 photos: median IoU 0.995, see `docs/quality-1000.md`) on the same 100 photos. BiRefNet: mean IoU 0.991, median 0.997,
mean pixel difference 0.002. ISNet (haze fix on): mean IoU 0.991, median 0.996. The lowest was a sheet of raindrops
(0.82), where tiny drops sit right at the despeckle cut-off.

Tested: recursion into subfolders, symlinked photos, a PNG cut-out as input, a HEIC from `sips` (prebuilt sharp
can't decode HEVC, so libheif-js does it), an EXIF-rotated JPEG, `--bg` with `--size` and `--pad`, `--crop` with
WebP, Ctrl-C and resume (28 done, 72 left, then 100 with nothing redone), the settings guard, forced GPU failures.
Not tested: Windows (built, never run), Linux on real hardware (the one-file build ran in Docker on the CPU, see
below), Intel Macs, a real iPhone HEIC with a rotation flag, tens of thousands of files.

## A window: `goodbye-bg` with no arguments

    goodbye-bg                 # or: goodbye-bg app, or node bin/goodbye-bg.cjs from a checkout

It starts a small local server on 127.0.0.1 (any free port) and opens the browser on its page (`lib/app/`). On the page:
drop photos or a folder, or use **Choose folder** / **Choose photos**; pick a background (see-through, white or a
colour), a format (PNG, JPG, WebP), a size (original, crop to subject, square 2000 or 1000) and, for the squares, a
margin; **Start**. The cut-outs appear as thumbnails as they land, with a count, the pace and the time left, and
**Stop**. At the end: the output folder's path, **Show in Finder** (Explorer on Windows) and **New batch**. The
options are remembered in that browser.

Where the cut-outs go:
- **Choose folder** opens the system's folder dialog from goodbye-bg itself (osascript on macOS, PowerShell on Windows,
  zenity on Linux), so it knows the real path. Photos are read straight from disk, as in the folder mode, and the
  cut-outs go **next to the folder**: `Shop` gives `Shop cut-outs`. Running the same folder with the same options
  again carries on where it stopped (finished photos are skipped); other options go to `Shop cut-outs 2`, never into
  a mix.
- **Dropped or browser-picked photos:** a browser never tells a page where a file lives. So the page sends each photo
  to goodbye-bg over loopback, three at a time, and it is kept in a temporary folder only until it is cut out. The
  cut-outs go to `~/Downloads/<dropped folder> cut-outs` (or `Cut-outs <date time>` for loose photos), always a new
  folder. **Change** picks another folder (native dialog).
- Without a folder dialog (Linux without zenity), Choose folder falls back to the browser's own folder picker, which
  sends the photos like a drop.

It uses the same engine, workers and settings file (`.goodbye-bg.json`) as the folder mode: same speed, and the same
cut-outs byte for byte (checked by `test/app-bench.mjs` on 20 photos, see-through PNG and white JPG 2000 square, for
both Choose folder and drops).
It is the folder mode with a page in front, not the website: no ads, no counts, no analytics, no fonts or scripts from
anywhere. The page's CSP allows only its own origin.

Safety: it listens on 127.0.0.1 only. The address it opens carries a random token (`/#<token>`), and every `/api/`
request must send it; requests with another `Origin` or `Host` (DNS rebinding) get a 403. The only folders it ever
opens in Finder are output folders it made; thumbnails are looked up by number, never by a path from the page.

Lifecycle: it stops by itself a minute after its last window closes, or with Ctrl-C. A Choose-folder batch finishes
first, and a reload reconnects to it. A dropped batch needs its window to send the photos: closing or reloading the
window that started it stops it after the photos in progress, and a minute later the process exits (tested over the
API: 10 of 20 sent, the window gone, a few cut-outs, no half files, exit 0; without the window's id, the idle timer
does the same).

Options: `--port`, `--no-open` (print the address only), `--model`, `--engine`, `--jobs`. Test switches:
`GOODBYE_BG_PICK` / `GOODBYE_BG_PICK_OUT` (answer the folder dialog), `GOODBYE_BG_DOWNLOADS` (instead of
~/Downloads), `GOODBYE_BG_DRYOPEN` (print instead of opening the browser or Finder), `GOODBYE_BG_IDLE_MS`.

Tested (2026-11-22, headless Chrome 158 driven by Playwright, `test/app-test.mjs`, 32 checks, all pass, against the
checkout and against the one-file binary with no Node on the PATH):
- 20 photos dropped: 20 thumbnails, 20 see-through PNGs at each photo's full size in a new folder.
- Options changed: JPG turns see-through off and picks white; square 2000 with an 8% margin gives 20 white-cornered
  2000x2000 JPGs and the settings file says so.
- Choose folder (dialog answered by `GOODBYE_BG_PICK`): 20 cropped WebPs on a colour in `<folder> cut-outs`; the same
  again says "Nothing new to do"; other options go to `... cut-outs 2`; Stop part way stops with no half files.
- Show in Finder opens that folder; no request leaves 127.0.0.1; no page errors; the token, origin and host checks
  answer 403; closing the window stops the process.
- Not tested: a real drag from Finder (Playwright's synthetic drop carries files, not folder entries, so the folder
  walk in the page is untested), the native dialog by hand (it starts; not checked that it comes to the front),
  Safari and Firefox, Windows and Linux, thousands of photos in one drop.

    PW=<folder with node_modules/playwright-core> node test/app-test.mjs <photos> [--bin <binary>] [--shots <dir>]
    node test/app-bench.mjs <photos> [--rounds 3] [--bin <binary>]

Speed, against the folder mode (same Mac, BiRefNet on the GPU, see-through PNG at full size, photos a minute from the
first photo to the last; the machine was busy with other work, load average 9 to 12, so read them as relative):

| Photos | CLI | Window, Choose folder | Window, dropped |
|---|---|---|---|
| 20, median of 3 alternating rounds | 174 | 177 | 175 |
| 100 (the quality set), 1 round | 184 | 185 | 183 |

The window adds nothing measurable: the model is the limit, and sending a photo over loopback costs a few
milliseconds. It saves the start-up on every batch after the first (the model stays warm; the CLI pays 1.1 s each run).

## Drop-in for the remove.bg API: `goodbye-bg serve`

    goodbye-bg serve                  # http://localhost:5000/v1.0, BiRefNet on the GPU
    goodbye-bg serve --port 8080 --allow-urls --model isnet

A local server that answers remove.bg's `POST /v1.0/removebg` and `GET /v1.0/account` the way their API reference
describes them (https://www.remove.bg/api, OpenAPI file https://www.remove.bg/api/swagger.yaml, read 2026-11-22).
A script that called `https://api.remove.bg/v1.0` keeps working with the base URL changed to
`http://localhost:5000/v1.0`. Any `X-Api-Key`, or none. Nothing is uploaded and nothing is counted.

    curl -H 'X-API-Key: anything' -F 'image_file=@/path/to/file.jpg' -F 'size=auto' \
         -f http://localhost:5000/v1.0/removebg -o no-bg.png

Options: `--port` (5000), `--host` (127.0.0.1, plus ::1 so `localhost` works), `--allow-urls`, `--model`, `--engine`,
`--jobs` (3), `--quiet`. One model session, so photos are cut out one at a time in arrival order; `--jobs` workers
decode and encode around it.

Covered, as documented:
- Image from `image_file` (multipart), `image_file_b64` (multipart, url-encoded or JSON body) or `image_url`.
  `image_url` and `bg_image_url` are fetched only with `--allow-urls` (http/https, 22 MB, 20 s); without it they get a
  400 `url_fetch_disabled` that says so; the only other network use is the one-time model download.
- `size`: `preview` is the default (0.25 MP, as at remove.bg), plus `small`/`regular`, `medium` (1.5 MP), `hd` (4 MP),
  `full`/`4k` (25 MP, PNG 10 MP), `50MP` (PNG 10 MP), `auto` (25 MP). Scripts that want full size must send
  `size=auto` or `full` here too.
- `format`: `auto` (PNG if anything is see-through, else JPG), `png`, `jpg`, `webp`, `zip` (`color.jpg` + `alpha.png`).
- `channels=alpha` (the matte), `bg_color` (hex with 3, 4, 6 or 8 digits, `#` optional, or a CSS colour name),
  `bg_image_file`, `bg_image_url` (cover, centred), `crop` (tight to the subject) with `crop_margin` (px or %, 1, 2
  or 4 values, at most 50% or 500 px a side), `scale` (10% to 100%) and `position` (`original`, `center`, one or two
  percentages), `roi` (px or %; the mask is cleared outside it).
- **Shadows**: `shadow_type` (`drop`, `3D`, `car`, `auto`, `none`, or per foreground type as `shadow_type[product]=drop`),
  `shadow_opacity` (0 to 100 or `auto`, also per type) and the old `add_shadow`. Every shadow type gets the same look:
  the site's soft ground shadow (its seller option "Shadow", ported in `lib/shadow.cjs`), an ellipse under the subject
  as wide as 90% of it, darkest in the middle. `shadow_opacity=50` (the default) is the site's look; 100 is twice as
  dark. It goes between the cut-out and any `bg_color` or background image. With `crop` the canvas grows at the bottom
  to hold it; without, it stops at the photo's edge. A subject cut off by the photo's bottom edge gets none, as on the
  site. `channels=alpha` and zip's `alpha.png` include the shadow. The foreground type is the request's `type`, or
  `other` without one: `shadow_type=auto` is then a drop shadow, `shadow_type[product]=drop` needs `type=product`, and
  `add_shadow=true` (remove.bg's car shadow) needs `type=car`. The default opacity is 90 for `type=car`, 50 otherwise.
  With `bg_color` and a shadow, the subject's box is measured on the full-size cut-out rather than the model's 1024
  px mask, so `X-Foreground-*` and the crop can differ by a pixel or two from the same request without a shadow.
- Response: the image (or `{"data": {"result_b64", "foreground_*"}}` with `Accept: application/json`), headers
  `X-Width`, `X-Height`, `X-Foreground-Top/Left/Width/Height`, `X-Credits-Charged: 0`.
- Errors: status 400 and `{"errors": [{"code", "title", "detail"}]}` with remove.bg's codes and titles:
  `missing_source`, `multiple_sources`, `invalid_image_url`, `failed_image_download`, `file_too_large` (22 MB),
  `invalid_file_type`, `resolution_too_high` (50 MP), `failed_to_read_image`, `unknown_foreground` (no subject found),
  `invalid_size`, `invalid_format`, `invalid_channels`, `invalid_roi`, `roi_exceeds_bounds`, `roi_region_empty`,
  `invalid_crop_margin`, `invalid_scale`, `invalid_position`, `invalid_bg_color`, `invalid_bg_image_url`,
  `multiple_bg_sources`, `failed_bg_download`, `invalid_semitransparency`, `multiple_shadow_params`,
  `invalid_shadow_opacity`.
- `GET /v1.0/account`: the documented shape, with 1,000,000 credits and free calls (nothing is counted; some scripts
  check the balance first).

Not covered, or different:
- **Shadows are one style**: remove.bg draws a different shadow per type (a cast "3D" shadow for people, a car
  shadow); here all of them are the site's ground shadow.
- **No classification**: `type` and `type_level` are accepted (the models find any subject; `type` only picks the
  per-type shadow settings), and there is no `X-Type` header.
- `semitransparency` is accepted and ignored (remove.bg uses it for car windows only); edges stay soft.
- No rate limits, no `X-RateLimit-*` headers, never 402 or 403 for keys. `POST /v1.0/improve` answers 404.
- Inputs: also AVIF, TIFF, GIF (first frame) and HEIC, which remove.bg refuses.
- Our own codes, same shape: `url_fetch_disabled`, `invalid_shadow_type`, `invalid_type`, `invalid_type_level`,
  `invalid_json`, `invalid_body`, and 500 `internal_error`.
- `zip` with `channels=alpha` gives the matte as a PNG. Quality settings (JPG 92, WebP 90) are ours.
- The cut-out is BiRefNet's (or ISNet's), not remove.bg's. With `size=auto` and nothing else it is byte for byte
  the folder mode's PNG for the same photo.
- Requests that carry an `Origin` header (from a web page) are refused with 403, and on loopback so are other `Host`
  names: a page in a browser can't use the server or make it fetch URLs.

Clients: the two most common wrappers hard-code `https://api.remove.bg`, so "change the base URL" means one line:
- Python `removebg` 0.4 (PyPI): `import removebg.removebg as rb; rb.API_ENDPOINT = "http://localhost:5000/v1.0/removebg"`
  before using it. File, URL and base64 calls all worked.
- Node `remove.bg` 1.3.0 (npm): the endpoint is a constant in `dist/index.js`; replace it (a `sed` or `patch-package`).
  File, base64 and URL calls worked, including its JSON responses and error objects.
- curl, `requests`, `fetch` and anything else with a URL setting: just the URL.

macOS: AirPlay Receiver listens on port 5000 on every address. With only 127.0.0.1, `localhost:5000` can reach
AirPlay instead (a 403 from `AirTunes`, which looks like a key error); listening on ::1 as well avoids that. If
5000 is taken on 127.0.0.1 itself, the server says so; pick `--port`.

Numbers (same Mac, 100 photos from the quality set at 1.6 MP, BiRefNet on the GPU, `size=auto` PNG):

| Clients at once | Photos a minute |
|---|---|
| 1 (a plain loop) | 129 |
| 4 | 216 |
| 8 | 215 |
| 4, `size=preview` | 217 |
| folder mode, same photos | 215 |
| 4, `--model isnet` | 449 |

One client at a time leaves the GPU idle while its photo is decoded, encoded and sent; two or more keep it busy and
reach the model's limit (about 275 ms a photo), the same as the folder mode. Peak memory footprint 4.1 GB, as in
folder mode. `node test/serve-test.mjs <photo>` checks 66 behaviours against a running server started with
`--allow-urls` (all pass on four photos, 2026-11-22, one a portrait cut by the photo's bottom edge; on one small
subject the cut-subject check skips itself because nothing is found once cut), including HEIC,
background images and shadows (the photo gets a white band below it for those, then is cut through its subject to
check that a cut subject gets none). `node test/shadow-test.mjs` checks the shadow and its
parameters without a server or the model (39). `node test/serve-bench.mjs <folder> --clients 4` measures.

## One file: `scripts/build-sea.mjs`

    node scripts/build-sea.mjs --node <nodejs.org node binary> --out ./goodbye-bg

Makes one executable for this platform with Node's single executable applications (`node --build-sea`). Homebrew's
`node` can't (built without SEA support); the binary from nodejs.org can. The default is the **BiRefNet-only build**:
lines marked `// AGPL-only` (ISNet's download, settings and `--model` choice) are left out, and the build stops if
anything naming ISNet's model remains. `--open` keeps ISNet (an AGPL build; checked that it offers `--model isnet`).

- macOS arm64, Node 26.13.1: **169 MB** (147 MB of it is Node), 67 MB zipped. The first run unpacks 71 MB to
  `<cache>/runtime-<hash>/` in 0.2 s and downloads the 93 MB model (about 11 s here); later runs start in about 2 s.
- Runs with no Node on the PATH (`env -i PATH=/usr/bin:/bin`), WebGPU included, cut-outs byte for byte the same as the
  checkout's; `serve` works too. `goodbye-bg --licenses` prints the bundled licences.
- The window is inside: run with no arguments (a double-click in Finder should do the same in a Terminal window; not
  tried), it
  serves its page from the unpacked runtime. The build checks the page files are there and name no ISNet. The window's
  end-to-end test passes against the binary with no Node on the PATH (rebuilt 2026-11-22: 168.9 MB, 178 files).
- Native addons, their libraries and worker threads must be real files, hence the unpacking. The LGPL libraries stay
  separate, replaceable files there.
- Not signed (ad hoc only): see "Shipping it" in `docs/bulk-cli.md` for Gatekeeper, and for Windows and Linux.

### Windows x64 and Linux x64, built on the Mac

    node scripts/build-sea.mjs --node <nodejs.org node> --target win32-x64 --out ./goodbye-bg.exe
    node scripts/build-sea.mjs --node <nodejs.org node> --target linux-x64 --out ./goodbye-bg

`node --build-sea` can inject into another platform's Node (the SEA config's `executable`), so no CI and no other
machine are needed. The build fetches that platform's official Node of the same version from nodejs.org (sha256
checked against SHASUMS256.txt) and sharp's binaries for it with `npm pack` (sha512 checked against
`package-lock.json`); onnxruntime-node's npm package already carries Windows and Linux binaries. Both are cached in
`dist-sea/.cache` (ignored by git). Built 2026-11-22 with Node 26.13.1:

| | Linux x64 | Windows x64 |
|---|---|---|
| File | ELF 64-bit x86-64, **180 MB** (76 MB zipped) | PE32+ x86-64 console, **141 MB** (79 MB zipped) |
| Native parts inside | `libonnxruntime.so.1` 47.6 MB, binding, sharp + `libvips-cpp.so` 18.7 MB | `onnxruntime.dll` 31.7 MB, `DirectML.dll` 18.5 MB, `dxcompiler.dll` 18.0 MB, binding, sharp + `libvips-42.dll` 19.0 MB |
| Checked | Static checks, and **ran it** in Docker (`debian:bookworm-slim`, linux/amd64 under emulation): `--licenses`, a folder run, `serve` + curl, a shadow | Static checks only |
| Not checked | WebGPU on a real Linux GPU (Vulkan), the window, other distributions | **Running at all**, WebGPU/DirectML, the window, the folder dialog (PowerShell), SmartScreen |

- Static checks on both: `file` type, the SEA fuse flipped (`NODE_SEA_FUSE_...:1`), and the embedded `build.json`
  listing the platform's native files with their sizes.
- Linux in Docker: no GPU there, so the GPU start failed ("Couldn't load Vulkan") and it carried on on the CPU, as
  designed; 4.7 s a photo for BiRefNet under x86 emulation. The cut-out's alpha matches the Mac's CPU engine within
  3/255 (mean difference 0.000) on a 1920x1080 photo. `serve` answered `/account` and `/removebg` (200, PNG), and
  `shadow_type=drop` with `crop` gave the taller canvas (544x348 without, 544x371 with). Afterwards nothing named
  `onnxruntime` or `DeveloperTools` was anywhere on the container's disk (ONNX Runtime's telemetry stays off).
- Linux needs `libatomic.so.1` (Node 26's own requirement): present on desktop distributions, missing from slim
  containers (`apt-get install libatomic1`). glibc 2.36 tested; the newest glibc symbol version Node, ONNX Runtime and
  libvips ask for is 2.28 (and GLIBCXX 3.4.22), so distributions from 2018 on should do (read from the files, not run).
- Telemetry on Windows: `onnxruntime.dll` carries the same `ORT_DISABLE_TELEMETRY` switch (and keeps its device ID in
  the registry, `HKCU\SOFTWARE\Microsoft\DeveloperTools\.onnxruntime`), plus a Windows-only telemetry class
  (`WindowsTelemetry`, the system's event tracing). Whether the switch silences that one too is not checked.
- The Linux file is larger because nodejs.org's Linux `node` carries debug symbols; `strip` would shrink it (not tried).
- Windows ships DirectML.dll and dxcompiler.dll from onnxruntime-node. Their licences are Microsoft's, not MIT, and their
  texts are not in the npm package; `LICENSES/README.txt` names them and says to add the texts before shipping.
- No dxil.dll next to dxcompiler.dll: whether WebGPU (Dawn on D3D12) starts without it is unknown; the engine falls
  back to DirectML and then the CPU.

## Licences

- This tool's own code is AGPL-3.0, like the rest of the repo (`package.json` says so). Kevin wrote all of it, so he
  can also licence his own code differently for a paid build.
- **BiRefNet** (the default) is MIT. A build that only ever runs BiRefNet can be closed source.
- **ISNet** (IMG.LY, `--model isnet`) is AGPL-3.0. Shipping a program that runs it, or fetches it for the user,
  means offering that program's source under the AGPL. A closed paid build must leave ISNet out: no `--model isnet`,
  no download of it. `scripts/build-sea.mjs` does that by default.
- onnxruntime-node: MIT. sharp: Apache-2.0, but its prebuilt libvips binaries (`@img/sharp-libvips-*`) are LGPL-3.0.
  libheif-js: LGPL-3.0 (it contains libde265, an HEVC decoder). A closed build can use LGPL libraries if they stay
  separate files a user could replace, with their licence texts and a note on where to get the source.
- HEVC is patented. Shipping an HEVC decoder in a product sold for money may need a patent licence; on Macs, Apple's
  own decoder (`sips`, ImageIO) avoids the question. See `docs/bulk-cli.md`.
