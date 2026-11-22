# Launch kit

Everything to post goodbye.bg on Product Hunt, Hacker News, Reddit and forums. Nothing here has been posted.
Pictures and demo re-taken 2026-11-22 (about 05:15) on `main` at 4bea605: blur and own-photo backgrounds, size presets,
margin, shadow and WebP, 100 per drop on computers, the reworked card bar and picker. Re-shoot if the page looks
different on launch day. Older drafts: `docs/launch-drafts.md` (this file replaces them).

**Link to use:** `https://goodbye.bg` if it resolves on the day, else `https://goodbye-bg-git.pages.dev`. Never both
in one post. The links below use pages.dev; swap the host if the domain is live. Keep `?ref=` on the app page (`/`)
only: the text pages run no script, so `/remove-bg-alternative/?ref=reddit` is never counted.

## Files

All pictures come from the local build, with the real model, on CC0 photos (sources in `CREDITS.md`). None of
Kevin's photos. Light and dark versions of each.

| File | Size | Use |
|---|---|---|
| `ph-1-before-after-*.png` | 1270x760 | PH gallery 1: one photo before and after (transparent PNG) |
| `ph-2-seller-*.png` | 1270x760 | PH gallery 2: a teapot on white, Square, 10% margin, shadow, with the options row open |
| `ph-3-blur-*.png` | 1270x760 | PH gallery 3: the corgi and the car with the background blurred (strong), blur picked in the open row |
| `ph-4-batch-*.png` | 1270x760 | PH gallery 4: four photos, four looks (blur, see-through, aqua, white + Square + shadow), Download all |
| `ph-5-empty-*.png` | 1270x760 | PH gallery 5: the page before any photo |
| `demo.mp4` / `demo.gif` | 1270x760 / 800 px, 25 s | PH gallery, X, Reddit: drop 4 photos, cut out, teapot to white + Square + shadow, corgi to blur, Download all |
| `social-square-*.png` | 1080x1080 | Instagram, Mastodon, LinkedIn, PH thumbnail source: before/after plus white + shadow, blur, a colour |
| `before-after-strip-*.png` | 1600x900 | Reddit, blog posts, directory listings (also in the repo README) |
| `../../src/og.png` | 1200x630 | Link previews: corgi half photo, half cut-out. Unchanged; still true |

Honest notes about the captures:
- The demo runs in real time on an M-series Mac with WebGPU and **the model already cached** (the four cut-outs are done
  in under 5 s there). A first visit downloads about 120 MB first (model about 90 MB plus a 29 MB
  runtime). Don't say "instant".
- Ad cards were switched off for the captures. On the live site, 1 to 3 photos are laid out as four cells and product
  cards fill the empty ones once the batch is done, so `ph-2` (1 photo) and `ph-3` (2 photos) would show ads there.
  With 4 photos there is no empty cell.
- The footer count is the live number at capture time (the captures added about 40 cut-outs to it).
- The composed images (`ph-1`, the square, the strip) use the PNGs and JPGs the site itself downloaded. The blurred car
  in the square is the site's strong blur, the teapot its Square + 10% + shadow JPG (3096x3096).
- No human portrait: none of the CC0 photos in `CREDITS.md` has a person. The blur shots use the corgi and the car. A
  CC0 portrait would make a stronger blur shot; add it to `CREDITS.md` if you use one.
- PH thumbnail (240x240): use `src/icon-512.png`, or crop the card out of `social-square-light.png`.

## Facts to stay inside (checked against the code on 2026-11-22)

- Free, no account, no watermark. Photos from the device are cut out in the browser: WebGPU on computers that have it
  (BiRefNet lite, about 300 ms a photo on an M5 Pro), ISNet everywhere else: on the GPU on phones that allow it, on
  WebAssembly otherwise, which includes every iPhone (about 5 s a photo there). A computer whose GPU can't manage
  BiRefNet (fails, runs out of memory, starts in over 10 s or takes over 2 s for the first photo) steps down to ISNet on
  the GPU (and to the CPU if that fails too), and remembers it. The page's CSP allows network only to its own origin.
- What leaves the device: the cut-out on a Zazzle product card, only when that card is clicked (deleted once Zazzle
  has it, an hour at most). A pasted link is fetched by our server. Anonymous counts (views, votes, crashes, cut-outs),
  no cookies, no IP addresses, no third-party scripts. So say "cut out on your device", never "nothing is ever
  uploaded" or "no analytics".
- Out: a PNG at the photo's own resolution (output capped at 16 MP on iPhone, 64 MP elsewhere), cropped to the subject
  by default (crop toggle for the whole frame). Or a JPG on white, black, two palette colours, any colour, the photo's
  own background blurred (soft or strong), or a picture of your own (never uploaded). Size: Original, Square, 4:5,
  16:9 or a custom size; margin 0, 4, 10 or 20%; a ground shadow; WebP where the browser can make it (not in WebKit; real Safari untested).
  "Apply to all" copies a photo's background and options to the rest of the visit's photos.
- In: JPG, PNG, WebP, AVIF, SVG, HEIC, TIFF, camera RAW (the embedded preview), ZIPs, folders, animated GIFs (come back
  animated, hard edges, no backgrounds). Up to 100 per drop on computers that report 8 GB or more (or don't say), 50 on
  phones and smaller machines. Download all gives a zip. The newest 50 photos are kept in the browser (IndexedDB), so a
  reload doesn't lose them.
- Not there: API, edge brush. Hair is OK, not great. Close-ups over a blurred background can keep some blur on phones
  (ISNet).
- **Offline: not claimed.** It works offline in Chrome after the first cut-out (service worker, tested headless), but
  Safari is untested. Don't say "works offline" until Kevin has checked Safari (steps in `offline-pwa` notes:
  cut out a photo, wait 10 s, Airplane Mode, reload). Then the line is "Works offline after your first cut-out."
- Install: there is a web app manifest, so Chrome shows its own install icon. No install prompt on the page.
- Open source, AGPL-3.0 (because ISNet is): https://github.com/kevinebaugh/goodbye.bg
- remove.bg says its background removal "moves to Leonardo.Ai" on 1 December 2026 (remove.bg/api, checked
  2026-11-22). Our pages say "shuts down"; in comments, "closes on 1 December, its background removal moves to
  Leonardo.Ai" is the precise version.

## Product Hunt

- **Name:** goodbye.bg
- **Link:** `https://goodbye-bg-git.pages.dev/?ref=ph` (PH may add its own `ref=producthunt`; the page reads the first `ref`)
- **Tagline** (49/60): `Free background remover that runs in your browser`
- **Topics:** Photography, Design Tools, Privacy, Open Source
- **Description** (251/260):

  > Remove the background from any photo, free. It's cut out in your browser, not on a server. Transparent PNG, or white, any colour, a blur or your own photo. Square and shadow for product shots. Batches with a zip. No account, no watermark. Open source.

- **Gallery order:** ph-1, ph-2, ph-3, ph-4, demo.mp4, ph-5 (light versions; dark if the page looks better in PH's
  dark mode).
- **Maker's first comment** (written for 1 December; on another day change "closes today" to "closes on 1 December"):

  > Hi PH, I'm Kevin. I used remove.bg all the time, and it closes today, so I built a replacement that runs on
  > your device instead of a server.
  >
  > Drop one photo or a whole folder (up to 100 at a time on a computer with 8 GB or more). Each comes back as a transparent PNG at its
  > own resolution, or on white, a colour, a blurred copy of its own background, or a picture of yours. For product
  > shots there's Square, 4:5, 16:9 or your own size, a margin and a soft shadow, and Apply to all does the whole batch.
  > Download all gives you a zip. It reads HEIC from iPhones, camera RAW and animated GIFs too.
  >
  > In Chrome on a recent Mac a photo takes well under a second. iPhones run it on the CPU, a few seconds a photo.
  > The first visit downloads the model (about 120 MB), then the browser keeps it.
  >
  > It's free, with no account and no watermark. It pays for itself with product cards (put your cut-out on a mug)
  > that show up in empty grid spots after a batch. The source is on GitHub under AGPL.
  >
  > Not there yet: an API, an edge brush. Hair is decent, not perfect. Please tell me where it fails on your photos.

## Show HN

- **Title** (68/80): `Show HN: goodbye.bg – a background remover that runs in your browser`
- **URL:** `https://goodbye-bg-git.pages.dev/?ref=hn`
- **First comment** (post it right after submitting):

  > remove.bg closes on 1 December (its background removal moves to Leonardo.Ai), and I used it all the time, so I
  > built a replacement where the model runs on your device.
  >
  > How it works: ONNX Runtime Web runs a segmentation model in a module Worker. Computers with WebGPU (shader-f16) get
  > BiRefNet lite (MIT, fp16), about 300 ms a photo on an M5 Pro. Everything else gets IMG.LY's ISNet: on WebGPU
  > where that is safe, else WebAssembly with threads, which is every iPhone (about 5 s a photo there). First visit
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
  > back PNGs at the original size, or JPGs on a colour, a blurred copy of the photo's background or a picture of
  > yours. Square/4:5/16:9/custom sizes, a margin and a ground shadow are there for product photos. Download all
  > streams a zip. Photos are kept in IndexedDB so a reload doesn't lose them.
  >
  > Money: optional product cards fill empty grid cells after a batch. Clicking a Zazzle card sends that one cut-out
  > to Zazzle so it's on the product; nothing else is uploaded. Anonymous counters, no cookies.
  >
  > Missing: API, edge brush. Hair is OK, not great.
  >
  > Source (AGPL, because ISNet is): https://github.com/kevinebaugh/goodbye.bg
  >
  > I'd like to hear where it fails on your photos.

Likely questions, short true answers:
- *Why AGPL?* ISNet's weights are AGPL. BiRefNet is MIT, but phones and the CPU fallback still need ISNet.
- *Offline?* Not promised yet. Don't say yes until Safari is checked (see the facts above).
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
   > your browser instead of on a server. Transparent PNG or a new background (colour, blur, your own photo). Up to
   > 100 at a time on a computer with 8 GB or more, with a zip. No API.
   > https://goodbye-bg-git.pages.dev/?ref=reddit

2. **Someone who used the API (HN or Reddit):**

   > remove.bg's API page says background removal moves to Leonardo.Ai on 1 Dec, so that's the drop-in path. If you'd
   > rather self-host, rembg (Python, open source) is the usual pick. I made a web version that runs the model in the
   > browser, goodbye.bg; it has no API, but the source shows how to run BiRefNet/ISNet with ONNX Runtime Web.
   > https://goodbye-bg-git.pages.dev/?ref=hn

3. **Privacy-minded thread (Reddit r/privacy, Privacy Guides forum):**

   > Mine, so take it with salt: goodbye.bg runs the model in your browser (WebGPU or WebAssembly), and the page's CSP
   > only lets it talk to its own server, so photos aren't sent anywhere to be cut out. It's AGPL, so you can read the
   > code or host it yourself. https://goodbye-bg-git.pages.dev/?ref=reddit

4. **Online sellers, product photos (r/Etsy, r/ecommerce, r/smallbusiness):**

   > For product shots, try goodbye.bg (I made it). Drop a folder (up to 100 on a computer with 8 GB or more), put one photo on white
   > with Square, a margin and a soft shadow, press Apply to all, and Download all gives you one zip at full
   > resolution. Free, no account. Check the edges on shiny or see-through items before you list them.
   > https://goodbye-bg-git.pages.dev/?ref=reddit

5. **iPhone users (r/iphone, r/photography, forums):**

   > iOS can lift a subject itself: press and hold it in Photos. If you need a batch, a white or blurred background,
   > or a file you can share, I built goodbye.bg: it works in Safari, takes HEIC straight from the camera roll, about
   > 5 seconds a photo, and press-and-hold saves the result to Photos. Disclosure: it's mine.
   > https://goodbye-bg-git.pages.dev/?ref=forum

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
- [ ] Offline: if Kevin has checked Safari (iPhone and Mac) by then, add "Works offline after your first cut-out" to
      the maker comment and the HN comment, and change the *Offline?* answer. If not, leave it out.
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

**If goodbye.bg isn't live yet**
- Post on `https://goodbye-bg-git.pages.dev` rather than miss 1 December. It looks less polished but it works.
- HN links can't be changed after posting, so if the domain is likely within a day, wait for it for HN. PH lets makers
  edit the product's links later (check in the PH dashboard before relying on it); Reddit replies can be edited too.
- When the domain goes live, do the steps in `docs/seo.md` §4: change `SITE` in `scripts/build.mjs` and the `og:url`
  and `og:image` lines in `src/index.html`, then 301 every pages.dev path to goodbye.bg so old links keep working.
- Say "goodbye.bg (domain still propagating, here's the working link)" only if someone asks; don't lead with it.
