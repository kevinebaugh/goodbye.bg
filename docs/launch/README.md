# Launch kit

Everything to post goodbye.bg on Product Hunt, Hacker News, Reddit and forums. Nothing here has been posted.
`ph-2`, `ph-3`, `social-square-*` and `demo.*` re-shot 2026-11-23 with `node scripts/shoot.mjs` (local build, real
model, product cards on); `ph-1`, `ph-5` and the strip are from 2026-11-22 and still match the page. Re-shoot
(`npm run dev`, then the script) if the page looks different on launch day. Older drafts: `docs/launch-drafts.md` (this file replaces them).

**Link to use:** `https://goodbye.bg` (live since 2026-11-23; pages.dev redirects to it). Keep `?ref=` on the app page (`/`)
only: the text pages run no script, so `/remove-bg-alternative/?ref=reddit` is never counted.

## 80/20 plan (2026-11-23)

Goal (Kevin, 2026-11-23): **$1,000+ a year.** Today the only money is Zazzle, and whether it pays at all is unknown
(`docs/zazzle-cap.md`, agreement §2.1.3: maybe no commission on a visitor's own image). So two things matter most:
getting that answer, and the traffic that the 1 December shutdown brings. Everything else waits.

1. ~~Zazzle's answer~~ **Settled 2026-11-23:** product-card sales earn the self-promotion rate (35–50% of net sales).
   So the money now depends on traffic and how many visitors click a product and buy: watch ad clicks per 100 photos
   and Zazzle's Ambassador earnings page. Also log in
   to the Ambassador dashboard after the first clicks and see whether any referral or royalty shows up. If the answer
   is no, the fallback is EthicalAds (needs about 50,000 page views a month; exceptions for fast growth) and a
   direct sponsor; both are in `docs/ads.md`.
2. **Friends this week (now to Sunday).** Kevin sends the link with `?ref=friends`; the hourly check watches crashes,
   failed photos, first-photo time and ad clicks. Fix what they hit.
3. **Before launch (by Friday 27th).** Redirect pages.dev with a 301 (Kevin's OK). ~~Re-shoot the outdated pictures~~ (done 2026-11-23:
   `npm run shoot`). Kevin checks the site on his iPhone.
4. **Launch.** Show HN **Monday 30 November, 8:00 to 9:30 am ET** (Thanksgiving week is quiet). Product Hunt
   **Tuesday 1 December, 12:01 am PT**, the day remove.bg closes (schedule it by the 27th). Reddit and forum replies
   from now on, one per "what replaces remove.bg?" thread.
5. **After (December).** Each week: views by source, photos done, ad clicks per 100 photos, Zazzle orders. That is
   the first real number for how many visitors $1,000 a year takes. Then decide: more SEO pages, EthicalAds, or a
   sponsor.

Not now: native-speaker reviews, the bulk-tool PR, paid ads (`docs/ads.md`: only once the site earns).

## Files

All pictures come from the local build, with the real model, on CC0 photos (sources in `CREDITS.md`). None of
Kevin's photos. Light and dark versions of each.

| File | Size | Use |
|---|---|---|
| `ph-1-before-after-*.png` | 1270x760 | PH gallery 1: one photo before and after (transparent PNG) |
| `ph-2-batch-*.png` | 1270x760 | PH gallery 2: four photos done (corgi, cat, car, teapot) and the product card after them |
| `ph-3-product-*.png` | 1270x760 | PH gallery 3: two photos and a product card with one of them on it (the business) |
| `ph-5-empty-*.png` | 1270x760 | PH gallery 4: the page before any photo |
| `demo.mp4` / `demo.gif` | 1270x760 / 800 px, 16 s | Empty page, four photos added, quips while they work, all four done, a product card that changes product, Download all |
| `social-square-*.png` | 1080x1080 | Four photos done and a product card |
| `before-after-strip-*.png` | 1600x900 | Reddit, blog posts, directory listings (also in the repo README) |
| `../../src/og.png` | 1200x630 | Link previews: the corgi twice, photo then cut-out, an arrow between (2026-11-22; the old split ran through its head) |

Honest notes about the captures:
- The demo runs in real time on an M-series Mac with WebGPU and **the model already cached** (the four cut-outs are done
  in under 5 s there). A first visit downloads about 120 MB first (model about 90 MB plus a 29 MB
  runtime). Don't say "instant".
- Product cards are on, as on the live site: one beside 1 to 3 photos, one after the 4th of 4. Which product shows is
  random, and the label is "Ad" or "Sponsored" at random, as live.
- The footer count is the live number at capture time (each capture adds to it).
- The composed images (`ph-1`, the strip) use the PNGs the site itself downloaded.
- No human portrait: none of the CC0 photos in `CREDITS.md` has a person. A CC0 portrait would make a stronger
  before/after; add it to `CREDITS.md` if you use one.
- PH thumbnail (240x240): use `src/icon-512.png`.

## Facts to stay inside (checked against the code on 2026-11-22)

- Free, no account, no watermark. Photos from the device are cut out in the browser: WebGPU on computers that have it
  (BiRefNet lite, about 300 ms a photo on an M5 Pro); ISNet on the GPU on phones that allow it; otherwise BiRefNet lite at
  640 px on WebAssembly, which includes every iPhone (5 to 8 s a photo on Kevin's iPhone; a 👎 there reruns the photo
  with ISNet). A computer whose GPU can't manage
  BiRefNet (fails, runs out of memory, starts in over 10 s or takes over 2 s for the first photo) steps down to ISNet on
  the GPU (and to the CPU if that fails too), and remembers it. The page's CSP allows network only to its own origin.
- What leaves the device: the cut-out on a Zazzle product card, only when that card is clicked (deleted once Zazzle
  has it; if Zazzle never fetches it, no one can open it after an hour and it is deleted within a day). A pasted link is fetched by our server. Anonymous counts (views, votes, crashes, cut-outs),
  no cookies, no IP addresses, no third-party scripts. So say "cut out on your device", never "nothing is ever
  uploaded" or "no analytics".
- Out: a transparent PNG at the photo's own resolution (output capped at 16 MP on iPhone, 64 MP elsewhere), always
  cropped to the subject. Each photo offers Download, 👍 👎 and remove, nothing more. Removed 2026-11-22 on purpose
  ("It's not a full image editor"), so never promise them: new backgrounds (colour, blur, your own photo), JPG or WebP
  out, size presets, margin, shadow, "Apply to all", the crop toggle, the mask editor.
- In: JPG, PNG, WebP, AVIF, SVG, HEIC, TIFF, camera RAW (the embedded preview), ZIPs, folders, animated GIFs (come back
  animated, hard edges). Up to 100 per drop on computers that report 8 GB or more (or don't say), 50 on
  phones and smaller machines. Download all gives a zip. The newest 50 photos are kept in the browser (IndexedDB), so a
  reload doesn't lose them.
- Not there: API, edge brush, new backgrounds, sizes. Hair is OK, not great. Close-ups over a blurred background can keep some blur on phones
  (ISNet).
- **Offline: after your first cut-out.** Checked in Chrome and by Kevin in Safari (2026-11-22). Say exactly that, not
  "after your first visit" (phones download the model only once used). Mention it when asked; don't lead with it.
- Install: there is a web app manifest, so Chrome shows its own install icon. No install prompt on the page.
- Open source, AGPL-3.0 (because ISNet is): https://github.com/kevinebaugh/goodbye.bg
- remove.bg says its background removal "moves to Leonardo.Ai" on 1 December 2026 (remove.bg/api, checked
  2026-11-22). Our pages say "shuts down"; in comments, "closes on 1 December, its background removal moves to
  Leonardo.Ai" is the precise version.

## Product Hunt

- **Name:** goodbye.bg
- **Link:** `https://goodbye.bg/?ref=ph` (PH may add its own `ref=producthunt`; the page reads the first `ref`)
- **Tagline** (49/60): `Free background remover that runs in your browser`
- **Topics:** Photography, Design Tools, Privacy, Open Source
- **Description** (228/260):

  > Remove the background from any photo, free. It's cut out in your browser, not on a server. Transparent PNG at full resolution, cropped to the subject. Animated GIFs too. Batches with a zip. No account, no watermark. Open source.

- **Gallery order:** ph-1, ph-2, ph-3, demo.mp4, ph-5 (light versions; dark if the page looks better in PH's dark mode).
- **Maker's first comment** (written for 1 December; on another day change "closes today" to "closes on 1 December"):

  > Hi PH, I'm Kevin. I used remove.bg all the time, and it closes today, so I built a replacement that runs on
  > your device instead of a server.
  >
  > Drop one photo or a whole folder (up to 100 at a time on a computer with 8 GB or more). Each comes back as a transparent PNG at its
  > own resolution, cropped to the subject. Download all gives you a zip. It reads HEIC from iPhones, camera RAW and animated GIFs too.
  >
  > In Chrome on a recent Mac a photo takes well under a second. iPhones run it on the CPU, 5 to 8 seconds a photo.
  > The first visit downloads the model (about 120 MB), then the browser keeps it.
  >
  > It's free, with no account and no watermark. It pays for itself with product cards (put your photo on a mug)
  > that sit among your photos once the first one is done. The source is on GitHub under AGPL.
  >
  > Please tell me where it fails on your photos.

## Show HN

- **Title** (68/80): `Show HN: goodbye.bg – a background remover that runs in your browser`
- **URL:** `https://goodbye.bg/?ref=hn`
- **First comment** (post it right after submitting):

  > remove.bg closes on 1 December (its background removal moves to Leonardo.Ai), and I used it all the time, so I
  > built a replacement where the model runs on your device.
  >
  > How it works: ONNX Runtime Web runs a segmentation model in a module Worker. Computers with WebGPU (shader-f16) get
  > BiRefNet lite (MIT, fp16), about 300 ms a photo on an M5 Pro. Phones with WebGPU get IMG.LY's ISNet on the GPU.
  > Everything else, including every iPhone, runs BiRefNet lite at 640 px on WebAssembly with threads, 5 to 8 s a
  > photo on an iPhone; a 👎 there reruns the photo with ISNet at full size. First visit
  > downloads about 120 MB (model plus ORT's wasm), cached after that. The CSP only allows the page's own origin.
  >
  > Harder than expected:
  > - BiRefNet's ONNX export has Concats with up to 1024 inputs (WebGPU allows 10 storage buffers per shader) and its
  >   deformable convs are spelled out as GatherND over every tap at once (392 MiB tensors, bad_alloc). A script turns
  >   the Concats into trees and each deformable conv into chunked GridSample plus a strided Conv. All 3820 nodes now
  >   run on WebGPU.
  > - BiRefNet needs about 3 GB of GPU memory. If it fails to start, runs out of memory or is slow (over 10 s to start,
  >   over 2 s for the first photo), the page steps down to ISNet on the GPU (and to the CPU if that fails too), and remembers it.
  > - iPhones: the WebGPU path crashed Safari tabs on real photos, so phones use the CPU with 2 threads (4 threads
  >   peaked at 2.1 GB). Safari only gives you threads with COEP: require-corp; it ignores credentialless.
  > - Safari caps canvases near 16.7 MP, so big photos stay as bitmaps and are scaled when drawn.
  > - A failed WebGPU run aborts ORT's wasm instance for the whole realm, so the GPU engine lives in its own Worker
  >   and a CPU Worker redoes the photo if it fails, hangs or returns NaN.
  >
  > It takes JPG/PNG/WebP/HEIC/TIFF/RAW/ZIP/animated GIF, up to 100 at once on computers with 8 GB or more (50 on phones), and gives
  > back transparent PNGs at the original size, cropped to the subject. Download all streams a zip. Photos are kept in IndexedDB so a reload doesn't lose them.
  >
  > Money: optional product cards sit among the photos (one beside 1 to 3 photos, then one per 6, at most 3). Clicking a Zazzle card sends that one result
  > to Zazzle so it's on the product; nothing else is uploaded. Anonymous counters, no cookies.
  >
  > Source (AGPL, because ISNet is): https://github.com/kevinebaugh/goodbye.bg
  >
  > I'd like to hear where it fails on your photos.

Likely questions, short true answers:
- *Why AGPL?* ISNet's weights are AGPL. BiRefNet is MIT, but the GPU step-down, phones with WebGPU and the 👎 retry on
  the CPU still use ISNet.
- *Offline?* Yes, after your first cut-out: the page and the model stay on the device.
- *Is there an app?* No native app. Chrome shows its install icon in the address bar (there's a manifest); it's the
  same page in its own window.
- *Why not just rembg?* rembg is great on a server or CLI; this is for people who want a web page and no install.
- *Privacy with ads?* The page has no third-party code. A Zazzle card uploads its cut-out only when clicked.
- *Download size?* About 120 MB once. Pinned versions, cached for a year.
- *My GPU is old.* It steps down to a smaller model, then to the CPU, on its own. The CPU takes 5 to 7 s a photo on a
  desktop.

## Replies for "remove.bg alternative" threads

Answer the question first, say it's yours, one reply per thread, no follow-ups pushing it. Link the app root.

1. **Short, general (Reddit):**

   > I built goodbye.bg for this (disclosure: it's mine). Free, no account, no watermark, and the cut-out happens in
   > your browser instead of on a server. Transparent PNG at full resolution. Up to
   > 100 at a time on a computer with 8 GB or more, with a zip. No API.
   > https://goodbye.bg/?ref=reddit

2. **Someone who used the API (HN or Reddit):**

   > remove.bg's API page says background removal moves to Leonardo.Ai on 1 Dec, so that's the drop-in path. If you'd
   > rather self-host, rembg (Python, open source) is the usual pick. I made a web version that runs the model in the
   > browser, goodbye.bg; it has no API, but the source shows how to run BiRefNet/ISNet with ONNX Runtime Web.
   > https://goodbye.bg/?ref=hn

3. **Privacy-minded thread (Reddit r/privacy, Privacy Guides forum):**

   > Mine, so take it with salt: goodbye.bg runs the model in your browser (WebGPU or WebAssembly), and the page's CSP
   > only lets it talk to its own server, so photos aren't sent anywhere to be cut out. It's AGPL, so you can read the
   > code or host it yourself. https://goodbye.bg/?ref=reddit

4. **Online sellers, product photos (r/Etsy, r/ecommerce, r/smallbusiness):**

   > For product shots, try goodbye.bg (I made it). Drop a folder (up to 100 on a computer with 8 GB or more) and
   > Download all gives you one zip of transparent PNGs at full resolution, cropped to each product. It doesn't add a
   > white background or a shadow. Free, no account. Check the edges on shiny or see-through items before you list them.
   > https://goodbye.bg/?ref=reddit

5. **iPhone users (r/iphone, r/photography, forums):**

   > iOS can lift a subject itself: press and hold it in Photos. If you need a batch or a file you can share, I built goodbye.bg: it works in Safari, takes HEIC straight from the camera roll, about
   > 5 seconds a photo, and press-and-hold saves the result to Photos. Disclosure: it's mine.
   > https://goodbye.bg/?ref=forum

## Posting checklist

Today is Sunday 22 November 2026. remove.bg's background removal ends on Tuesday 1 December.

**Recommended dates**
1. **Show HN: Tuesday 24 November, 8:00 to 9:30 am ET** (5:00 to 6:30 am PT). Weekday mornings US get the most eyes;
   Wednesday to Friday this week is Thanksgiving, which is quiet. Backup: Monday 30 November, same time.
2. **Product Hunt: Tuesday 1 December, 12:01 am PT.** The day remove.bg closes is the news hook. PH's day runs
   midnight to midnight PT, so launch at 12:01 to get the full 24 hours. Avoid Thanksgiving (26 Nov).
3. **Reddit and forums:** from now on, whenever a "what replaces remove.bg?" thread appears. Search daily for
   "remove.bg" sorted by new on Reddit, HN Algolia, and the Privacy Guides forum. One reply per thread.

**Day before each launch**
- [ ] Open the site on a computer and an iPhone; cut out 2 photos; Download and Download all work.
- [ ] Re-read every claim above against the site that day (features land fast). If a brush or an API
      ships, update the "missing" lines.
- [x] Offline checked in Safari (2026-11-22): "Works offline after your first cut-out" may go in the maker comment and
      the HN comment, as a small line, not a headline.
- [ ] Check that the share preview shows the new og.png: paste the link into the
      [Facebook Sharing Debugger](https://developers.facebook.com/tools/debug/) and press "Scrape Again"; LinkedIn's
      Post Inspector does the same.
- [ ] Decide the host (below) and swap it into every link here.
- [ ] Clear the day: answer every comment in the first 3 hours.

**Show HN**
- [ ] Submit at news.ycombinator.com/submit with the title and URL above, text field empty.
- [ ] Post the first comment at once.
- [ ] Don't ask anyone to upvote (HN penalises it). Reply plainly; thank bug reports; fix fast and say so.

**Product Hunt**
- [ ] Schedule the launch a few days ahead (PH lets you pick the date) with the gallery, tagline, description, topics.
- [ ] At 12:01 am PT post the maker comment.
- [ ] Share the PH link with people who know you; ask them to try it and comment, not to "upvote".

**After each**
- [ ] Read views by source: the `views` query in CLAUDE.md, grouped by `blob3` (`ref.hn`, `ref.ph`, `ref.reddit`,
      `ref.forum`).
- [ ] Note crashes (the `crashes` query) and fix the top one the same day.

