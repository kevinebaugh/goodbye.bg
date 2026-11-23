# Sending the cut-out to Zazzle (Create-a-Product) — findings, design, prototype

Status 2026-11-21: on by default on branch `kevin-claude/zazzle-context-bf01ce` (`?zazzlecap=0` turns it off).
Kevin dropped the "Send to Zazzle / Don't send" question: clicking a Zazzle card implies it, and the button says "Put it on a mug".
The site copy is updated to match (section 3).

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
- **Zazzle copies the image once** (tested 2026-11-21): the link redirects to the product page with Zazzle's own
  image ID (`t_image1_iid=<uuid>`) in place of our URL, and the previews render from that copy. It also caches by
  URL: the same image URL on a second template came back with the same ID, without a new fetch. So our copy only
  has to live until that first fetch, and every send needs a new URL (our keys are used once).
- The domains page also says the image goes into an Image Album. With "content belongs to the users who link from my
  site" (the option chosen), it goes into the visitor's own album if they sign up for Zazzle.
- Unconfirmed: maximum size, and the fetcher's user agent or IP.
- No data URI, POST or upload API exists in any doc.

**Zazzle's answer (James Chapman, api.help@zazzle.com, 2026-11-23), to Kevin's four questions of 2026-11-21:**
1. §2.1.3 "is specifically for Content that might have been published in our marketplace that someone else is earning a
   royalty for. Your use case does include that exclusion." **Confirmed in writing the same day, after Kevin asked:
   "Your use case does not fall under that exclusion. The self-promotion rate applies."** (The self-promotion rate is
   35–50% of net referral sales, royalty plus referral.)
2. No `rf=` needed: the referral is tracked to the account automatically when the visitor lands on the page, unless
   they already had an attribution (for example, shopping on Zazzle a week earlier through someone else's link).
   The links as built are right.
3. Direct-only templates are fine (Public works too).
4. Zazzle downloads the image on first fetch and it is stored in the visitor's account. Unknown to him: what happens
   when someone returns through the same Zazzle link after our copy is deleted. **Tested 2026-11-23 on goodbye.bg
   (ornament, Kevin signed in): it works.** Zazzle redirects the create link to the product page with its own image ID
   (`t_image1_iid=<uuid>`). After our copy was gone (404), reloading that product page and reopening the original
   create link (with our dead image URL) both showed the photo: Zazzle maps the original URL to its copy and doesn't
   fetch again. Switching the ornament style keeps the photo; only Zazzle's style thumbnails show the template's
   placeholder figure. goodbye.bg is in the declared domains. One failure during the test was our 1-hour TTL: Zazzle
   first asked for the image over an hour after it was sent ("Image failed to upload"); real clicks open Zazzle at once.

**Commission (before 2026-11-23): this was the big open question.**
- The Associates program became the **Ambassador program on 2025-04-01**.
- Links to your own store's products, including "Create-a-Product API pages", are "self-promotion" links. The
  agreement says they must carry **no parameters, no `rf=`**, and pay 35–50% of net referral sales (royalty plus
  referral).
- §2.1.3: **no commission on content "uploaded … or created with Zazzle's design tools by anyone else."** A
  visitor's own cut-out on Kevin's template may be exactly that, which would make these sales pay nothing.
- The 2019 CAP guide still shows `rf=` in its examples, which conflicts with the agreement. Zazzle's current link
  builder (zazzle.com/my/ambassador/create) makes links without `rf=`, so the prototype leaves it out.
- The cookie lasts 45 days, with the first 14 protected.
- Ask api.help@zazzle.com (see section 4) before making eight templates.

**Terms.** The account must be enrolled in Ambassador, accept the CAP API terms
(https://www.zazzle.com/my/associate/create_a_product_api_signup), declare domains, and have a store. Rate limits
exist but aren't published. Content guidelines apply, and products can be rejected.

## 2. Design (what the prototype does)

1. Clicking a Zazzle ad card sends the cut-out it shows, and only that one. No question in between (Kevin: the
   click implies it). The footer and the remove.bg page's FAQ say what a click does; the card's accessible name ends
   "Takes this cut-out to Zazzle."
2. The click makes a random 128-bit key in the page and does two things at once:
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

**Deleting after the first fetch.** Zazzle keeps its own copy, so the GET deletes ours 20 s after the first full
fetch (a little slack in case Zazzle retries). `/go` only uses HEAD while it waits, so its checks don't count as a
fetch.

**Abuse risk.** `Sec-Fetch-Site`/`Origin` stop browsers, but curl can fake them. Anyone could use goodbye.bg to host
a PNG for an hour. Mitigations:
- the size cap, PNG only, the short TTL, noindex, and no listing
- a Cloudflare rate-limiting rule on `/api/cap/*` (for example 10 a minute per IP; Cloudflare applies it, and we
  store nothing)

**Analytics.** `adcap` rows sit beside `adclick`, so `count adcap / count adclick` is the opt-in rate.

**Unverified:**
- On iPhone, `window.open` puts goodbye.bg in the background while the upload runs. The upload may stall; then
  `/go` falls back after 10 s to the usual page. Not tested on a device.
- Tested on the preview with the R2 bucket (2026-11-21):
  - PUT returned 201, a repeat PUT 409, and a cross-site PUT 403. R2 honours `onlyIf: { etagDoesNotMatch: "*" }`.
  - `/go` redirected to the mug link with `/cap/<key>.png`.
  - Opening that link, Zazzle fetched the image, and our copy returned 404 thirty seconds later.
  - Zazzle reused the image ID of an identical image fetched earlier, so it also dedupes by content.
  - Not yet tested with a real photo through the page on a phone.
- The mug's slot is centred on the wrap, so the cut-out faces away from the handle: half visible in the "Left" view,
  whole in the Center view. Moving it to the front for right-handed drinkers is a Zazzle-side tweak.

## 3. Copy (changed 2026-11-21)

The promise is now "cut out on your device" (always true), in the hero and the remove.bg page. The footer has no
privacy line any more (Kevin: by then people are already using it). The button says what the click does ("Put it on a mug"). The remove.bg page's FAQ "Are my
photos uploaded?" gives the details: clicking a product ad takes that cut-out to Zazzle, and our server holds it
until Zazzle has it, an hour at most. Also changed: `src/index.html` meta, og, JSON-LD and hero;
`src/remove-bg-alternative/index.html` meta, lede and table; `README.md`, `package.json`, the `src/_headers` and
`src/app.js` comments, and `CLAUDE.md`. The how-to page is unchanged: "without uploading it" and "the photo stays on
your device" describe removing the background, which stays true. "Until Zazzle
has it" holds because the GET deletes our copy 20 s after the first fetch. 2026-11-22: "an hour at most" was
not true for a cut-out Zazzle never fetches (unreadable after `TTL_MS`, but only deleted on the next send or by the
one-day lifecycle rule); the FAQ now says "no one can open it after an hour and it is deleted within a day".

## 4. Zazzle setup (done 2026-11-21, in Kevin's account, with his OK)

- Store **goodbyebg** created (Kevin solved its CAPTCHA). The CAP terms were already accepted on the account.
- Declared image domains: `goodbye-bg-git.pages.dev`, `kevin-claude-zazzle-context.goodbye-bg-git.pages.dev`,
  `goodbye.bg`. Ownership set to "the content belongs to the users who link from my site".
- The member account ID for `at-` is 238003133086051540, the same as the Ambassador ID.
- Eight templates. All are Direct-only (not listed or searchable, reachable by link) with Zazzle's minimum royalty
  of 5% (Kevin asked for 1%; Zazzle refuses under 5%, and it can be changed within 24 hours of posting).
  - Each has one image slot, `image1`, set to Fit.
  - The placeholder is a plain teal figure drawn by Claude and uploaded to Kevin's Uploads. Zazzle won't let you
    sell a design that uses its own clip art.
  - The IDs are in `ZAZZLE_CAP.pd` in `lib/partners.mjs`:

  | Product | Zazzle type | Template ID |
  |---|---|---|
  | mug | Classic Mug 11 oz | 256109521733566200 |
  | sticker | 4x4 custom-cut vinyl sticker | 256879772313558885 |
  | shirt | white Hanes men's crew tee, front | 256111263575769583 |
  | tote | natural budget tote, front | 256390505328741347 |
  | ornament | round porcelain ornament, front | 256350244847406024 |
  | phonecase | iPhone 17 slim case | 256140659304551868 |
  | pillow | 16x16 throw pillow, front | 256722353463187898 |
  | keychain | square single-sided acrylic keychain | 256661193721206477 |

- Checked by opening the CAP links with `https://goodbye-bg-git.pages.dev/icon-512.png`. The mug and the keychain
  both opened with the image on them.

## 5. Still for Kevin

1. ~~Commission question~~: settled 2026-11-23. Sales through these links earn the self-promotion rate.
2. Done 2026-11-21 (Kevin): R2 bucket and its cleanup rule. The binding is in `wrangler.toml`.

        npx wrangler r2 bucket create goodbye-bg-cap
        npx wrangler r2 bucket lifecycle add goodbye-bg-cap cap-1-day cap/ --expire-days 1

   Then add to `wrangler.toml`. A binding to a missing bucket breaks the build, so the bucket comes first:

        [[r2_buckets]]
        binding = "CAP"
        bucket_name = "goodbye-bg-cap"

3. Optional: a rate-limiting rule on `/api/cap/*` (Cloudflare dashboard → Security → WAF → Rate limiting rules).
4. Test on the preview with `?zazzlecap=1&adv=mug`: add a photo, click the mug card, then Send to Zazzle. The mug
   should open with the cut-out on it.
5. If it works and the commission answer is good: update the copy in section 3, then decide whether "Send to Zazzle"
   becomes the default card behaviour or stays an opt-in button.

## Local testing

`.claude/launch.json` has `dev` (port 8790) and `dev-cap` (port 8791). `dev-cap` sets `CAP_TEST_PD`, so every
product gets a fake template ID and `/go` redirects to a CAP link. `scripts/serve.mjs` keeps an in-memory stand-in
for the R2 bucket. Tested locally on 2026-11-21:
- PUT: 201 on the first, 409 on a repeat, 415 for a non-PNG, 403 cross-site, 400 for a bad key.
- `/cap/<k>.png` returns the same bytes, with the headers above.
- `/go` waits for the upload and redirects to the CAP link. With a missing key it falls back after 10 s.
- In the browser: "Send to Zazzle" uploaded 134 KB in about 1 s, and the bar came back afterwards.
- Preview deploy (no bucket yet): page 200, PUT 503 "Not set up", /go redirects at once to the usual link.
- Without `?zazzlecap=1`: no bar and no upload, the same as main.
