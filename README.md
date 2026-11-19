# goodbye.bg

Remove image backgrounds in the browser. Photos never leave the device.

- No uploads. The model runs locally in WebAssembly.
- Full size output. No account. No watermark.
- Batch: drop many photos, download all as a zip.

## Ways in

- Choose files (phones also offer camera and photo library)
- Paste anywhere: copied images, screenshots, copied files, image links, copied web page selections
- Paste button for touch devices
- Drag and drop: files, whole folders, images dragged from other tabs
- Link field: an image link, or a web page link (uses its preview image)
- `goodbye.bg/?url=<link>` for bookmarklets and other apps
- Android share sheet, after Add to Home screen (`src/sw.js`, `src/manifest.webmanifest`)
- "Open with" on desktop when installed as an app

Bookmarklet (sends the current page or image to goodbye.bg):

    javascript:location='https://goodbye.bg/?url='+encodeURIComponent(location.href)

## Links and privacy

Photos from the device never leave it. A pasted link is different: the image lives on another
site, and browsers block reading most of those directly. `functions/api/fetch.js` (a Cloudflare
Pages Function) fetches it and streams it back. It stores and logs nothing, only answers the
site itself, caps size at 30 MB, and marks responses so they can never run as a page.

## Run

    npm install
    npm run dev        # builds dist/ and serves it at http://localhost:8788

## Deploy

Pushes to `main` deploy automatically: Cloudflare Pages builds the repo (project `goodbye-bg-git`).
No GitHub Actions involved. Manual fallback from your own machine:

    npx wrangler login      # first time only
    npm run deploy          # builds dist/ and uploads it to Cloudflare Pages (project: goodbye-bg-git)

`src/_headers` sets the security headers. The app page may only connect to its own origin,
so the code has no path to send a photo anywhere.

## Ads

Ads load in `ad.html` inside a sandboxed iframe with no `allow-same-origin`. Ad code there
cannot read the page or the photos. To turn ads on, see the comment in `src/ad.html`.

Note: the site sends `Cross-Origin-Embedder-Policy: credentialless` so the model can use
several threads. Some ad networks may not render under it. Test before launch.

## Layout

    src/            app source (HTML, CSS, JS, headers)
    scripts/        build.mjs (assembles dist/), serve.mjs (local server)
    dist/           build output, not committed

## License

AGPL-3.0. The segmentation model comes from `@imgly/background-removal-data` (AGPL-3.0).
ONNX Runtime Web and fflate are MIT.
