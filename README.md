# goodbye.bg

Remove image backgrounds in the browser. Photos never leave the device.

- No uploads. The model runs locally in WebAssembly.
- Full size output. No account. No watermark.
- Batch: drop many photos, download all as a zip.

## Run

    npm install
    npm run dev        # builds dist/ and serves it at http://localhost:8788

## Deploy

No CI. Build and deploy from your own machine:

    npx wrangler login      # first time only
    npm run deploy          # builds dist/ and uploads it to Cloudflare Pages (project: goodbye-bg)

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
