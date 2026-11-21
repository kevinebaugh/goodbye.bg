# Sending the cut-out to Zazzle (Create-a-Product) — findings, design, prototype

Status 2026-11-21: prototype behind `?zazzlecap=1` on branch `kevin-claude/zazzle-context-bf01ce`.
Not on main: it changes the privacy story, so Kevin decides. Off by default; with the flag off, nothing changes.

## 1. Findings

Sources: Zazzle's "Create-A-Product API User Guide v3.0" (2019, linked from zazzle.com/api):
https://asset.zcache.com/assets/graphics/z4/uniquePages/zAPI/ZazzleApiGuide.v3.pdf, the Ambassador agreement
https://www.zazzle.com/terms/ambassadors_agreement and help-center articles. "Unconfirmed" means no doc says it.

**The link.** CAP is a plain link; there is no API key, no POST and no upload endpoint.

    https://www.zazzle.com/api/create/at-<member account ID>?rf=<associate ID>&ax=Linkover&pd=<template product ID>
      &ed=true&tc=<tracking code>&t_<slot>_iid=<URL-encoded image URL>

- `at-<id>`: the 18-digit member account ID (required). Not necessarily the same number as the Ambassador ID.
- `ax=Linkover` (required). `pd`: the template product's 18-digit ID (required).
- `ed=true`: the visitor can keep editing. `tc`: tracking code (letters, digits, `_`; up to 100) shown in referral history.
- `t_<slot>_iid`: image URL for the template object whose "URL Parameter Name" is `<slot>` (default `image1`).
  `t_<slot>_txt` / `_txtclr` do the same for text.
- `fwd`, `color`, `size`, `view` and similar are not in the guide: unconfirmed, so the prototype doesn't use them.
- A multi-product page (`ax=DesignBlast` with store `sr` and category `cg`) exists ("Templates Buffet"). It could
  show the cut-out on many products at once later.
- Preview images (`rlv.zazzle.com/svc/view?pid=...&t_image1_url=...`) need the same public URL. We don't need them:
  our 3D cards already show the product on the device.

**A template product in Kevin's store is required.** Nothing documents using stock products without one. The
template steps: in Zazzle's design tool, add an image, then "Make this a template object" and set its URL Parameter
Name (we use `image1`) and fit or fill. Then Done → Sell It, and set "Make product a template" to Yes. Its product ID
(the 18 digits at the end of its URL) is `pd`. Templates can't be edited once posted: post a new one instead.

**The image has to be at a public URL, on a domain Kevin has declared to Zazzle**
(https://www.zazzle.com/my/associate/domains). Otherwise Zazzle shows "Image failed to upload". So:
- The image is hosted briefly on our own origin. Zazzle fetches it from us, and our server never calls Zazzle.
  CSP stays as it is.
- Formats: PNG with alpha works (partial transparency is not supported on dark apparel). An extension isn't needed;
  the guide's own example is an extensionless URL. Print sizing: 150 ppi for apparel and bags, 200 ppi for mugs and
  stickers. The prototype sends at most 2400 px on the long side.
- Unconfirmed: maximum size, whether Zazzle copies the image once ("failed to upload" suggests a copy) or fetches it
  again later, how long it must stay up, and the fetcher's user agent or IP.
- No data URI, POST or upload API exists in any doc.

**Commission: this is the big open question. Ask Zazzle before building templates.**
- The Associates program became the **Ambassador program on 2025-04-01**.
- Links to your own store's products, including "Create-a-Product API pages", are "self-promotion" links. The
  agreement says they must carry **no parameters, no `rf=`**, and pay 35–50% of net referral sales (royalty plus
  referral).
- §2.1.3: **no commission on content "uploaded … or created with Zazzle's design tools by anyone else."** A
  visitor's own cut-out on Kevin's template may be exactly that, which would make these sales pay nothing.
- The 2019 CAP guide still shows `rf=` in its examples, which conflicts with the agreement.
- The cookie lasts 45 days, with the first 14 protected.
- Ask api.help@zazzle.com (see section 4) before making eight templates.

**Terms.** The account must be enrolled in Ambassador, accept the CAP API terms
(https://www.zazzle.com/my/associate/create_a_product_api_signup), declare domains, and have a store. Rate limits
exist but aren't published. Content guidelines apply, and products can be rejected.

## 2. Design (what the prototype does)

1. A Zazzle ad card, clicked, swaps its bar for two buttons: **Send to Zazzle** and **Don’t send**.
   - Nothing is sent until "Send to Zazzle" is pressed, and only that one cut-out is sent.
   - "Don’t send" is today's behaviour: save the cut-out here, open Zazzle.
   - This is the per-click opt-in. The button names where the photo goes, so no extra text or popup is needed.
2. "Send to Zazzle" makes a random 128-bit key in the page and does two things at once:
   - It opens `/go/zazzle?v=<product>&...&k=<key>` in a new tab straight from the tap, so pop-up blockers allow it.
   - It PUTs the cut-out (PNG, as Download gives it, at most 2400 px) to `/api/cap/<key>`.
3. `PUT /api/cap/<key>` (`functions/api/cap/[key].js`):
   - Same-origin only (`Sec-Fetch-Site`, or `Origin` on older browsers).
   - PNG only: checks the Content-Type and the PNG signature.
   - 20 MB cap. Refuses to overwrite a key.
   - Stores `cap/<key>.png` in R2 (binding `CAP`) with an expiry 1 hour out, then deletes anything already past its
     expiry.
   - No IP, cookie or identifier is stored. The key is random and used once.
4. `/go/zazzle` (`functions/go/[id].js`):
   - Counts the click as before (`adclick`) and adds an `adcap` count when the cut-out went along.
   - Waits up to 10 s for the object, then redirects to the CAP link built by `capLink()` in `lib/partners.mjs`.
   - If the product has no template ID yet, there is no bucket, or the upload never arrives, it redirects to the
     usual link. It doesn't wait when there's no template.
5. `GET /cap/<key>.png` (`functions/cap/[file].js`) is what Zazzle fetches. Response headers:
   - `image/png`, `Access-Control-Allow-Origin: *`, `Cross-Origin-Resource-Policy: cross-origin`
   - `no-store`, `noindex`, `nosniff`, sandbox CSP
   - 404 after the hour, deleting the object at that point.
   - An R2 lifecycle rule on `cap/` (1 day) deletes leftovers if nobody sends anything for a while.

Why R2 and not KV: KV can take up to 60 s to show a new key in other locations, and Zazzle's fetcher is somewhere
else. R2 is strongly consistent, and it holds large files. D1 caps rows at 2 MB.

**Deleting on first fetch** would be ideal, but it's not safe until we know whether Zazzle keeps a copy (see the
test in section 4). If it does, change the GET to delete after serving, and the copy can say "deleted once Zazzle
has it".

**Abuse risk.** `Sec-Fetch-Site`/`Origin` stop browsers, but curl can fake them. Anyone could use goodbye.bg to host
a PNG for an hour. Mitigations:
- the size cap, PNG only, the short TTL, noindex, and no listing
- a Cloudflare rate-limiting rule on `/api/cap/*` (for example 10 a minute per IP; Cloudflare applies it, and we
  store nothing)

**Analytics.** `adcap` rows sit beside `adclick`, so `count adcap / count adclick` is the opt-in rate.

**Unverified:**
- On iPhone, `window.open` puts goodbye.bg in the background while the upload runs. The upload may stall; then
  `/go` falls back after 10 s to the usual page. Not tested on a device.
- The buttons are `role=button` spans inside the card's `<a>`, with Enter/Space wired up: fine for a prototype,
  not great for accessibility. If this ships, the card should become a `<div>` with a real link and real buttons.
- None of the Zazzle side is tested: no template exists yet.

## 3. Copy that would change if this ships

Today the claim everywhere is "photos never leave your device". With this feature, a cut-out leaves when the visitor
presses "Send to Zazzle". Every line below must change in the same commit that turns it on. Kevin's suggested line
was "If you click on a link, we may send your image with you". "May" is vaguer than what happens: we send it only
when they press Send. The proposed wording:

| Where | Today | Proposed |
|---|---|---|
| `src/index.html` footer | "Photos from your device are processed in this tab and never uploaded. If you paste a link, our server fetches that public image for you and keeps nothing." | "Photos from your device are processed in this tab. A cut-out leaves it only if you press Send to Zazzle: we hold it for an hour so Zazzle can fetch it. If you paste a link, our server fetches that public image for you and keeps nothing." |
| `src/index.html` hero `.sub` | "Your photos stay on your device." | unchanged (still true by default); or "Your photos stay on your device unless you send one." |
| `src/index.html` meta description, JSON-LD description, og:description | "Your photos stay on your device." | "Your photos stay on your device unless you choose to send one." |
| `src/remove-bg-alternative/index.html` meta description | "Your photos stay on your device." | as above |
| same page, FAQ JSON-LD and the visible "Are my photos uploaded?" answer | "No. … Photos from your device never leave it. …" | "No. The background removal runs in your browser. Photos from your device stay there, unless you press Send to Zazzle on a product: then that one cut-out goes to our server for an hour so Zazzle can put it on the product. If you paste a link, …" |
| same page, lede | "your photos never leave your device." | "your photos stay on your device." |
| same page, table "Where photos go" | "Stay on your device" | "Stay on your device (unless you send one to Zazzle)" |
| `src/how-to-remove-background/index.html` meta description | "without uploading it" | unchanged (removing the background never uploads); the lede "the photo stays on your device" is still true |
| `README.md` lines 3, 5, 26 | "Photos never leave the device." / "No uploads." | "Photos stay on the device; one leaves only if you send it to Zazzle." / "No uploads for background removal." |
| `package.json` description | "Your photos never upload." | "Your photos stay in your browser." |
| `src/_headers` comment on `/` | "Photos have nowhere to go." | "Photos go nowhere but this site (and only on Send to Zazzle)." |
| `src/app.js` comments in `buildAd` | "nothing is uploaded", "nothing is sent to the partner" | describe both paths |
| `CLAUDE.md` | first paragraph "Photos from the device never leave it", the Rules section, the Zazzle "Not built" paragraph, the ad-click paragraph | update to the opt-in and point here |

Exact-duration claims ("for an hour") must match `TTL_MS`. Until objects are deleted on the first fetch, say
"hold it for an hour", not "delete it once Zazzle has it".

## 4. Steps for Kevin

1. **Ask Zazzle first** (api.help@zazzle.com). Two questions:
   - Do CAP links to my own templates earn self-promotion commission when the image is a visitor's photo (§2.1.3)?
   - Should they carry `rf=`?

   If the answer is "no commission", stop here.
2. Accept the CAP API terms: https://www.zazzle.com/my/associate/create_a_product_api_signup
3. Declare image domains at https://www.zazzle.com/my/associate/domains:
   - `goodbye-bg-git.pages.dev`
   - `kevin-claude-zazzle-context-bf01ce.goodbye-bg-git.pages.dev` (this branch's preview)
   - `goodbye.bg`, once it registers
4. Make one template per product: mug, sticker, shirt, tote, ornament, phonecase, pillow, keychain. Start with the mug.
   1. Zazzle → Create → pick the product.
   2. Upload any placeholder PNG.
   3. Turn on "Make this a template object", set URL Parameter Name `image1`, and choose fill or fit.
   4. Done → Sell It → put it in your store, and set "Make product a template" to Yes.
   5. Copy the 18-digit product ID from its URL into `ZAZZLE_CAP.pd.<product>` in `lib/partners.mjs`.
5. Copy your member account ID into `ZAZZLE_CAP.member`. It's the number after `at-` in a link from
   https://www.zazzle.com/my/associate/create (Template Link).
6. Create the R2 bucket and its cleanup rule (Claude wasn't allowed to change the Cloudflare account):

        npx wrangler r2 bucket create goodbye-bg-cap
        npx wrangler r2 bucket lifecycle add goodbye-bg-cap cap-1-day cap/ --expire-days 1

   Then add to `wrangler.toml`. A binding to a missing bucket breaks the build, so the bucket comes first:

        [[r2_buckets]]
        binding = "CAP"
        bucket_name = "goodbye-bg-cap"

7. Optional: a rate-limiting rule on `/api/cap/*` (Cloudflare dashboard → Security → WAF → Rate limiting rules).
8. Test on the preview with `?zazzlecap=1&adv=mug`:
   1. Add a photo, click the mug card, then Send to Zazzle. The mug should open with the cut-out on it.
   2. Then the copy test: wait an hour (or delete the object), reload the Zazzle tab, and check whether the image
      is still there. If it is, Zazzle copies it, and we can delete on first fetch.
9. If it works and the commission answer is good: update the copy in section 3, then decide whether "Send to Zazzle"
   becomes the default card behaviour or stays an opt-in button.

## Local testing

`.claude/launch.json` has `dev` (port 8790) and `dev-cap` (port 8791). `dev-cap` sets `CAP_TEST_PD`, so every
product gets a fake template ID and `/go` redirects to a CAP link. `scripts/serve.mjs` keeps an in-memory stand-in
for the R2 bucket. Tested locally on 2026-11-21:
- PUT: 201 on the first, 409 on a repeat, 415 for a non-PNG, 403 cross-site, 400 for a bad key.
- `/cap/<k>.png` returns the same bytes, with the headers above.
- `/go` waits for the upload and redirects to the CAP link. With a missing key it falls back after 10 s.
- In the browser: "Send to Zazzle" uploaded 134 KB in about 1 s, and the bar came back afterwards.
- Without `?zazzlecap=1`: no bar and no upload, the same as main.
