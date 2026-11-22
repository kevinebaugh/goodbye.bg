# goodbye-bg (bulk, prototype)

Removes the background from every photo in a folder, on your own computer. Photos are never uploaded. The only
network use is a one-time download of the model from the goodbye.bg site, checked against a pinned sha256 and
kept in your cache folder.

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
Not tested: Windows, Linux, Intel Macs, a real iPhone HEIC with a rotation flag, tens of thousands of files.

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
  400 `url_fetch_disabled` that says so, and the server never goes online.
- `size`: `preview` is the default (0.25 MP, as at remove.bg), plus `small`/`regular`, `medium` (1.5 MP), `hd` (4 MP),
  `full`/`4k` (25 MP, PNG 10 MP), `50MP` (PNG 10 MP), `auto` (25 MP). Scripts that want full size must send
  `size=auto` or `full` here too.
- `format`: `auto` (PNG if anything is see-through, else JPG), `png`, `jpg`, `webp`, `zip` (`color.jpg` + `alpha.png`).
- `channels=alpha` (the matte), `bg_color` (hex with 3, 4, 6 or 8 digits, `#` optional, or a CSS colour name),
  `bg_image_file`, `bg_image_url` (cover, centred), `crop` (tight to the subject) with `crop_margin` (px or %, 1, 2
  or 4 values, at most 50% or 500 px a side), `scale` (10% to 100%) and `position` (`original`, `center`, one or two
  percentages), `roi` (px or %; the mask is cleared outside it).
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
- **Shadows** (`shadow_type` other than `none`, `add_shadow=true` with `type=car`): 400 `unsupported_parameter`
  (our code; remove.bg has none for this). `add_shadow=true` without `type=car` is accepted, because remove.bg only
  ever drew a car shadow for a car.
- **No classification**: `type` and `type_level` are accepted and ignored (the models find any subject), and there is
  no `X-Type` header.
- `semitransparency` is accepted and ignored (remove.bg uses it for car windows only); edges stay soft.
- No rate limits, no `X-RateLimit-*` headers, never 402 or 403 for keys. `POST /v1.0/improve` answers 404.
- Inputs: also AVIF, TIFF, GIF (first frame) and HEIC, which remove.bg refuses.
- Our own codes, same shape: `url_fetch_disabled`, `unsupported_parameter`, `invalid_type`, `invalid_type_level`,
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

One client at a time leaves the GPU idle while its photo is decoded, encoded and sent; two or more keep it busy and
reach the model's limit (about 275 ms a photo), the same as the folder mode. Peak memory footprint 4.1 GB, as in
folder mode. `node test/serve-test.mjs <photo>` checks 47 behaviours against a running server (all pass);
`node test/serve-bench.mjs <folder> --clients 4` measures.

## Licences

- This tool's own code is AGPL-3.0, like the rest of the repo (`package.json` says so). Kevin wrote all of it, so he
  can also licence his own code differently for a paid build.
- **BiRefNet** (the default) is MIT. A build that only ever runs BiRefNet can be closed source.
- **ISNet** (IMG.LY, `--model isnet`) is AGPL-3.0. Shipping a program that runs it, or fetches it for the user,
  means offering that program's source under the AGPL. A closed paid build must leave ISNet out: no `--model isnet`,
  no download of it.
- onnxruntime-node: MIT. sharp: Apache-2.0, but its prebuilt libvips binaries (`@img/sharp-libvips-*`) are LGPL-3.0.
  libheif-js: LGPL-3.0 (it contains libde265, an HEVC decoder). A closed build can use LGPL libraries if they stay
  separate files a user could replace, with their licence texts and a note on where to get the source.
- HEVC is patented. Shipping an HEVC decoder in a product sold for money may need a patent licence; on Macs, Apple's
  own decoder (`sips`, ImageIO) avoids the question. See `docs/bulk-cli.md`.
