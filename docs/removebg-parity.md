# remove.bg parity gaps, ranked (2026-11-22)

**Removed 2026-11-22, a deliberate simplification** (Kevin: "It's not a full image editor"). Every finished photo now
offers only Download, 👍 👎 and remove: a transparent PNG at the photo's own resolution, always cropped to the subject
(animated GIFs stay animated). Built from this list and then taken out: new backgrounds (colour, blur, your own
photo) and JPG out, WebP out, size presets, margin, ground shadow, "Apply to all", the crop toggle, and the mask
editor. The tables and sketches below are the plan as it stood before; the rows marked *Removed* are no longer true.

## What we know about the shutdown, and how sure we are

remove.bg's own pages (remove.bg/, /pricing, /help, /api) returned little to our fetch tool, so most of the shutdown
detail below comes from competitor blogs that quote remove.bg's FAQ. Treat it as probably right, not verified.
No Reddit or forum threads turned up in search, so "what users will miss" is inferred from what remove.bg sold
and what the vendors' posts say users depend on. Nothing here is user research.

- The standalone website and self-serve API close 1 Dec 2026, 9:00 CET. Credits expire, subscriptions end,
  invoices can't be downloaded afterwards. Annual plans get a pro-rata refund. Enterprise API contracts continue.
  Sources: [Photoroom](https://www.photoroom.com/blog/remove-bg-shutting-down),
  [Pixelcut](https://www.pixelcut.ai/learn/remove-bg-alternative) (says it summarises remove.bg's FAQ, checked 31 Oct).
- Where people are sent: website users to Canva's Background Remover (Canva bought remove.bg in 2021; needs a Canva
  account); developers to Leonardo.Ai (also Canva's) with a migration guide; desktop-app users to Canva's bulk
  removal. Source: Pixelcut, [AlternativeTo](https://alternativeto.net/news/2026/9/end-of-an-era-remove-bg-shuts-down-standalone-service-and-moves-to-the-canva-ecosystem/).
- Ending too: the Photoshop plugin, desktop apps (Win/Mac/Linux), Android app, Figma/Sketch/Adobe CC plugins,
  Zapier and Make, with Shopify and Lightspeed apps up to their vendors. Source: Photoroom.
- remove.bg's tools page lists: Photoshop extension, desktop apps, Android app, design templates, Zapier/Make
  ("2,000+ apps"), video background removal. Source: [remove.bg/tools-api](https://www.remove.bg/tools-api).
- Free tier per Pixelcut: preview up to 0.25 MP, full resolution costs a credit; JPG/PNG/WebP up to 22 MB; desktop
  batch at 1 credit per image; API 50 free calls a month. Source: Pixelcut.
- API options per [remove.bg/api](https://www.remove.bg/api): `type` (person, product, car, animal, graphic...),
  `bg_color`, `bg_image_url/file`, `shadow_type/opacity`, `crop`, `crop_margin`, `scale`, `position`, `roi`,
  formats PNG/JPG/WebP/ZIP, sizes `auto` (to 25 MP) and `50MP`.
- Not checked: remove.bg's in-browser editor (erase/restore brush, backgrounds, effects). I believe it has one, but no
  fetched page confirmed it. Verify before copying it.
- Who the users are, in the vendors' own words: developers with API calls in product code and batch jobs, Zapier/Make
  automations, storefront apps, Photoshop and design plugins. Also, from the free tier, one-off personal users.

## Comparison

| Feature | remove.bg | goodbye.bg today | Gap |
|---|---|---|---|
| One photo, free | Preview 0.25 MP free, HD costs a credit | Full resolution free, on device, no account | We win |
| Privacy | Uploads to server | Never uploaded (Zazzle click excepted) | We win |
| Cut quality, people and pets | Good, hair strong | Good; hair edges blocky on phones (ISNet), better on GPU computers (BiRefNet) | Phone and hair quality (branch exists) |
| Fix a bad cut by hand (erase/restore) | Editor (unverified) | Only 👎 retry | *Removed* 2026-11-22: the mask editor was built, then cut |
| Solid background colour | Yes | No (*Removed* 2026-11-22) | Deliberate |
| Background image / blur | Yes (API `bg_image`, editor) | No (*Removed* 2026-11-22) | Deliberate |
| Drop shadow | Yes (`shadow_type`) | No (*Removed* 2026-11-22) | Deliberate |
| Output size, padding, position, marketplace presets | Yes (`scale`, `position`, `crop_margin`) | Cropped to the subject, nothing else (*Removed* 2026-11-22: sizes, margin, crop toggle) | Deliberate |
| Batch | Desktop app, API | Up to 100 per drop on computers (50 on phones), ZIPs in, streamed zip out; 50 kept | Small: cap 100 per drop |
| Formats in | JPG, PNG, WebP, 22 MB | Plus HEIC, TIFF, RAW preview, GIF, SVG, ZIP, links | We win |
| Formats out | PNG, JPG, WebP, ZIP | PNG, GIF, ZIP (*Removed* 2026-11-22: JPG, WebP) | Deliberate |
| Animated GIF | No (video product instead) | Yes | We win |
| Video | Yes | No | Skip |
| Photoshop plugin | Yes, ends 1 Dec | No | Large, high pain, small crowd |
| Figma / Sketch / Adobe CC | Yes, ends | No | Medium (Figma only) |
| Zapier / Make / Shopify | Yes, ends | No | Needs a server API: against our rules |
| API | Paid, `type` options | None | Same: server only |
| Desktop app, bulk | Yes, ends | No | Large, and the one that could earn |
| Android app | Yes | Share target after Add to Home screen; no store app | Small |
| iPhone app | No | Web page | None |
| Object types (`type=product/car`) | Yes | One model per engine | Skip, model choice is a rabbit hole |
| Works offline | No | Not tested/claimed | Small, trust |
| Where people find it | Was #1 on search | No domain yet, no traffic (69 views) | The biggest gap, and not a feature |

## Ranking

Score = (people affected x how much they care) / effort. Effort in focused days. All fit on-device, no accounts.

| # | Gap | People | Care | Effort | Verdict |
|---|---|---|---|---|---|
| 1 | Mask editor (erase/restore) | High | High | 1-2 d to merge and test | Built, *removed* 2026-11-22 |
| 2 | Better phone model, hair edges | High | High | 1-2 d to merge and test | Do first |
| 3 | Output canvas: size, padding, position, presets | Medium (sellers) | High | 2-3 d | Built, *removed* 2026-11-22 |
| 4 | Backgrounds: image, blur; ground shadow | High | Medium | 2-3 d | Built, *removed* 2026-11-22 |
| 5 | Batch settings for all photos; cap beyond 50 | Medium | High | 2 d | Cap raised to 100; Apply to all *removed* 2026-11-22 |
| 6 | Installable, works offline once cached | Medium | Medium | 1-2 d | Do |
| 7 | WebP out, PNG/JPG quality, trim toggle | Low | Low | 0.5 d | Built, *removed* 2026-11-22 |
| 8 | Desktop/CLI bulk tool (also the money gap) | Low-medium | High | 10+ d | Later |
| 9 | Figma plugin | Low | Medium | 5-8 d | Maybe |
| -  | Photoshop plugin | Low | High | 10+ d | Skip for now |
| -  | API, Zapier, Make, Shopify, video, `type` | Medium | High | n/a | Not on device; skip |

Traffic and the domain sit above all of these. Features do nothing for 69 views. See `docs/seo.md` and
`docs/funnel-2026-11-22.md`.

## Build sketches for the top 8

**1. Mask editor.** Merge the `mask-edit` branch. Each card gets an "Edit" control in the bar; it opens the
cut-out large with tap-a-piece to drop or keep, and erase/restore brushes on the stored mask. Edits write back to the
kept-on-device mask in IndexedDB so a reload keeps them and Download, GIF-less photos and Download all use the edited
mask. Needs undo, pinch-zoom, a fixed brush size slider. Cost: mostly testing on iPhone memory limits and on
retry/crop interactions; half a day of copy and UI polish after the merge. Biggest "I can fix it myself" win and the
thing remove.bg's paid users lean on.

**2. Better phone model.** Merge the phone-model branch after the same checks as before: memory peak on the iPhone
Simulator and a real iPhone with `?debug=1`, 16 MP photo, 7-8 photos in one tab. Update the Engines section of
CLAUDE.md, the crash report engine names and the licence note (the AGPL reason stays unless ISNet goes away). Cost:
1-2 days of device testing, no new UI. Hair and fine edges are where free tools lose to remove.bg.

**3. Output canvas.** After the cut, an optional "Size" row beside the colour picker: Original, Square, 4:3, 3:4, 16:9,
and marketplace presets (white square, 1000 or 2000 px, subject fills about 85%). Build with the existing crop box:
pad the subject box to the ratio, scale to the target, centre or bottom-align, fill with the chosen colour or leave
transparent. Reuse the PNG/JPG builder; no model work. Cost: 2-3 days with phone memory checks (a 2000 px canvas is
small, so safe). This is what Etsy, eBay and Shopify sellers do next after removing a background.

**4. Background image, blur, shadow.** Extend the background picker with "Photo" (a file the visitor picks, drawn
cover-fit behind the cut-out, never uploaded), "Blur" (the original photo blurred, a canvas filter, so the subject sits
in a soft version of its own scene) and a "Shadow" toggle (soft ground ellipse under the subject's bottom edge, plus
a drop shadow option, both canvas). All draw at download time from the original and mask. The Download label and
claims stay true ("on your device"). Cost: 2-3 days; blur needs care on Safari's canvas filter support (use stack
blur on a downscaled copy if needed).

**5. Batch settings and no 50 cap.** One "Apply to all" action for colour, size preset, crop and format, with a
filename pattern (`name-cutout.png`) and a progress strip for the zip. Raise the cap in steps with the keep limits
as the guard (the zip builds in streaming chunks so memory stays flat), and let a dropped folder of 200 go through,
newest-first-kept as today. Cost: 2 days. Heavier users are the ones who might pay later, so this is also the
first rung of the money ladder.

**6. Installable and offline.** Add to the service worker a cache of the page, runtime and the chosen model (the model
parts are already served with hashes, so cache by URL). Show nothing new unless useful: one line in the footer
"Works offline after the first cut-out" only once it's true and tested (test with the network off in Chrome and
Safari). Offer an install prompt on Android (the share target already needs install). Cost: 1-2 days; the risk is
cache size on iPhones (88 MB model, Safari evicts after 7 days idle, as CLAUDE.md notes). Reduces "I'm on a train"
failures and makes the privacy claim visible.

**7. WebP out and small export choices.** A small format choice on Download (PNG, WebP, JPG when a colour is set) and
a "Trim empty edges" toggle that overrides the crop default. WebP with alpha is supported on all current browsers
that can run this page, and is about a third the size of PNG. Cost: half a day. Low demand, but remove.bg lists WebP
and sellers like small files.

**8. Desktop and CLI bulk tool.** The closest thing to remove.bg's desktop app. Cheapest route: a Node CLI built on
`onnxruntime-node` and the same ISNet and BiRefNet models (same wasm rewrites do not apply; the CPU/GPU builds do),
taking a folder and writing PNG/WebP/JPG with the same size and background options. A Tauri window around the web app
can follow once the CLI works. Runs locally, no accounts, nothing uploaded. Cost: CLI 3-4 days, signed Mac and Windows
installers and an update path 6-10 more. Needs thinking on the AGPL (the whole thing stays open source, so sell
convenience, not code). This is where batch-heavy shops, who relied on the old desktop app and API, could pay.

Honourable mention, **Figma plugin** (5-8 days): runs the model inside the plugin iframe, where Figma allows
WebAssembly but no outbound network, so ship the model in the plugin bundle (size limit unknown; test first). Figma
users lose a plugin on 1 Dec, and a plugin listing is free discovery.

## Money, inside Kevin's rules

Rules in play: no tracking, every claim stays true, no third-party scripts on the app page, cut-outs not uploaded.

What fits, in the order I would try:

1. **A support link.** A "Support goodbye.bg" link in the footer to a hosted page elsewhere (GitHub Sponsors, Ko-fi or
   Buy Me a Coffee). No script on our page, just a link that leaves the site, labelled plainly. Shown only after a
   third cut-out so it never gets in the way. Zero code risk; expect small money, mostly from people who just saved
   a paid credit.
2. **A paid bulk tool (item 8).** One-time price (for example $19 to $39) sold through a link-out checkout (Lemon
   Squeezy, Paddle, Gumroad). No accounts: a signed licence key, checked offline in the app. The free web app stays
   free and capped at the same limits it has now, so the claim "free" stays true. This is the one idea that matches how
   remove.bg actually earned (credits for volume), without a server. Needs the CLI or app first.
3. **Zazzle, once Zazzle answers.** The open commission question in `docs/zazzle-cap.md` decides whether the cut-out
   hand-off earns anything. Until then do not add more Zazzle products.
4. **More honest affiliate fits.** Pick programs where the product follows from a cut-out: print-on-demand (Printful,
   Printify when links arrive), sticker and sign shops, passport/ID-photo printing, and product-photo kits for
   sellers (lightboxes, backdrops) shown only after a batch of 3+ products. Keep the "Ad" label, keep them out of
   Download all, and keep the ad card in a cell that would otherwise be empty. Each needs its own partner approval and
   affiliate link; check each programme's terms for on-device/no-cookie fit.
5. **A hosted API: not as goodbye.bg.** It means uploads, which breaks the one claim the site stands on. If Kevin
   wants that business, run it as a separate brand and domain with its own plain copy, never mixed with this one.
   remove.bg's developers are being sent to Leonardo.Ai; the gap is real, but it needs servers, support and billing.
6. **Plain ads: no.** Third-party ad scripts break the CSP and the no-tracking rule. `ad.html` stays off.

What not to claim: do not say "free forever" or "no limits" next to a paid tool; say what is free today. Do not
promise offline until it has been tested on Safari.

Realistic picture: with 69 views and the shutdown 9 days away, none of this earns anything until traffic arrives. The
order that makes money is traffic (domain, SEO pages, launch posts), then trust features (1, 2, 6), then seller
features (3, 4, 5), then the paid bulk tool (8).

## Sources

- https://www.photoroom.com/blog/remove-bg-shutting-down
- https://www.pixelcut.ai/learn/remove-bg-alternative
- https://alternativeto.net/news/2026/9/end-of-an-era-remove-bg-shuts-down-standalone-service-and-moves-to-the-canva-ecosystem/
- https://www.remove.bg/api and https://www.remove.bg/tools-api
- Not read: remove.bg's own FAQ and pricing details (fetch returned only titles); Reddit, forums.
