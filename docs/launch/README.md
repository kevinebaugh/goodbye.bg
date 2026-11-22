# Launch kit

Everything to post goodbye.bg on Product Hunt, Hacker News, Reddit and forums. Nothing here has been posted.
Captured 2026-11-22 on `main` at e9dea04. Rebased onto 9278576 (first-visit download timing, ISNet haze fix, ad test switch); re-shoot if the page looks different on launch day. Older drafts: `docs/launch-drafts.md` (this file replaces them).

**Link to use:** `https://goodbye.bg` if it resolves on the day, else `https://goodbye-bg-git.pages.dev`. Never both
in one post. The links below use pages.dev; swap the host if the domain is live. Keep `?ref=` on the app page (`/`)
only: the text pages run no script, so `/remove-bg-alternative/?ref=reddit` is never counted.

## Files

All pictures come from the local build, with the real model, on CC0 photos (sources in `CREDITS.md`). None of
Kevin's photos. Light and dark versions of each.

| File | Size | Use |
|---|---|---|
| `ph-1-before-after-*.png` | 1270x760 | PH gallery 1: one photo before and after |
| `ph-2-batch-*.png` | 1270x760 | PH gallery 2: four cut-outs on the grid, Download all |
| `ph-3-background-*.png` | 1270x760 | PH gallery 3: background picker open, three cards on aqua, white, sage |
| `ph-4-empty-*.png` | 1270x760 | PH gallery 4: the page before any photo |
| `demo.mp4` / `demo.gif` | 1270x760 / 800 px, 13 s | PH gallery 5, X, Reddit: drop 4 photos, cut out, Download, Download all |
| `social-square-*.png` | 1080x1080 | Instagram, Mastodon, LinkedIn, PH thumbnail source |
| `before-after-strip-*.png` | 1600x900 | Reddit, blog posts, directory listings |
| `../../src/og.png` | 1200x630 | Link previews (replaced: now a real before/after) |

Honest notes about the captures:
- The demo runs in real time on an M-series Mac with WebGPU and **the model already cached**. A first visit downloads
  about 120 MB first (model about 90 MB plus a 29 MB runtime). Don't say "instant".
- Ad cards were switched off for the captures. With 4 photos the grid has no empty cell, so no ad would show anyway;
  with 1 to 3 photos the live site fills the empty cells with product cards.
- The footer count is the live number at capture time (the captures added about 80 cut-outs to it).
- PH thumbnail (240x240): use `src/icon-512.png`, or crop the card out of `social-square-light.png`.

## Facts to stay inside (checked against the code on 2026-11-22)

- Free, no account, no watermark. Photos from the device are cut out in the browser: WebGPU on computers that have it
  (BiRefNet lite, about 300 ms a photo on an M5 Pro), ISNet everywhere else: on the GPU on
  phones that allow it, on WebAssembly otherwise, which includes every iPhone (about 5 s a photo there). The page's CSP allows network only to its own origin.
- What leaves the device: the cut-out on a Zazzle product card, only when that card is clicked (deleted once Zazzle
  has it, an hour at most). A pasted link is fetched by our server. Anonymous counts (views, votes, crashes, cut-outs),
  no cookies, no IP addresses, no third-party scripts. So say "cut out on your device", never "nothing is ever
  uploaded" or "no analytics".
- PNG at the photo's own resolution, up to 16 MP in Safari and on iPhone, 64 MP elsewhere, cropped to the subject by
  default (crop toggle for the whole frame). Or a JPG on white, black, two palette colours or any colour. **Solid
  colours only: no photo backgrounds.**
- In: JPG, PNG, WebP, AVIF, SVG, HEIC, TIFF, camera RAW (the embedded preview), ZIPs, animated GIFs (come back animated,
  hard edges). Up to 50 per drop, Download all as a zip. Photos are kept in the browser (IndexedDB) so a reload doesn't
  lose them.
- Not there: API, brush, photo backgrounds, offline promise. Hair is OK, not great. Close-ups over a blurred background
  can keep some blur on phones (ISNet).
- Open source, AGPL-3.0 (because ISNet is): https://github.com/kevinebaugh/goodbye.bg
- remove.bg says its background removal "moves to Leonardo.Ai" on 1 December 2026 (remove.bg/api, checked
  2026-11-22). Our pages say "shuts down"; in comments, "closes on 1 December, its background removal moves to
  Leonardo.Ai" is the precise version.

## Product Hunt

- **Name:** goodbye.bg
- **Link:** `https://goodbye-bg-git.pages.dev/?ref=ph` (PH may add its own `ref=producthunt`; the page reads the first `ref`)
- **Tagline** (49/60): `Free background remover that runs in your browser`
- **Topics:** Photography, Design Tools, Privacy, Open Source
- **Description** (235/260):

  > Remove the background from any photo, free. It's cut out in your browser, not on a server. Transparent PNG or a
  > solid colour, batches with a zip, HEIC and RAW in. No account, no watermark. Open source. Built as a remove.bg
  > replacement.

- **Gallery order:** ph-1, ph-2, ph-3, demo.mp4, ph-4 (light versions; dark if the page looks better in PH's dark mode).
- **Maker's first comment** (written for 1 December; on another day change "closes today" to "closes on 1 December"):

  > Hi PH, I'm Kevin. I used remove.bg all the time, and it closes today, so I built a replacement that runs on
  > your device instead of a server.
  >
  > Drop one photo or fifty. Each comes back as a transparent PNG at its own resolution, or on a solid colour, and
  > Download all gives you a zip. It reads HEIC from iPhones, camera RAW and animated GIFs too.
  >
  > In Chrome on a recent Mac a photo takes well under a second. iPhones run it on the CPU, a few seconds a photo.
  > The first visit downloads the model (about 120 MB), then the browser keeps it.
  >
  > It's free, with no account and no watermark. It pays for itself with product cards (put your cut-out on a mug)
  > that show up in empty grid spots after a batch. The source is on GitHub under AGPL.
  >
  > Not there yet: an API, an edge brush, photo backgrounds. Hair is decent, not perfect. Please tell me where it
  > fails on your photos.

## Show HN

- **Title** (68/80): `Show HN: goodbye.bg – a background remover that runs in your browser`
- **URL:** `https://goodbye-bg-git.pages.dev/?ref=hn`
- **First comment** (post it right after submitting):

  > remove.bg closes on 1 December (its background removal moves to Leonardo.Ai), and I used it all the time, so I
  > built a replacement where the model runs on your device.
  >
  > How it works: ONNX Runtime Web runs a segmentation model in a module Worker. Computers with WebGPU (shader-f16) get
  > BiRefNet lite (MIT, fp16), about 300 ms a photo on an M5 Pro. Everything else gets IMG.LY's ISNet: on WebGPU
  > where that is safe, else WebAssembly with threads, which is every iPhone (about 5 s a photo there). First visit downloads about 120 MB (model plus
  > ORT's wasm), cached after that. The CSP only allows the page's own origin.
  >
  > Harder than expected:
  > - BiRefNet's ONNX export has Concats with up to 1024 inputs (WebGPU allows 10 storage buffers per shader) and its
  >   deformable convs are spelled out as GatherND over every tap at once (392 MiB tensors, bad_alloc). A script turns
  >   the Concats into trees and each deformable conv into chunked GridSample plus a strided Conv. All 3820 nodes now
  >   run on WebGPU.
  > - iPhones: the WebGPU path crashed Safari tabs on real photos, so phones use the CPU with 2 threads (4 threads
  >   peaked at 2.1 GB). Safari only gives you threads with COEP: require-corp; it ignores credentialless.
  > - Safari caps canvases near 16.7 MP, so big photos stay as bitmaps and are scaled when drawn.
  > - A failed WebGPU run aborts ORT's wasm instance for the whole realm, so the GPU engine lives in its own Worker
  >   and a CPU Worker redoes the photo if it fails, hangs or returns NaN.
  >
  > It takes JPG/PNG/WebP/HEIC/TIFF/RAW/ZIP/animated GIF, up to 50 at once, and gives back PNGs at the original size
  > (or JPGs on a solid colour), zipped if you like. Photos are kept in IndexedDB so a reload doesn't lose them.
  >
  > Money: optional product cards fill empty grid cells after a batch. Clicking a Zazzle card sends that one cut-out
  > to Zazzle so it's on the product; nothing else is uploaded. Anonymous counters, no cookies.
  >
  > Missing: API, edge brush, photo backgrounds. Hair is OK, not great.
  >
  > Source (AGPL, because ISNet is): https://github.com/kevinebaugh/goodbye.bg
  >
  > I'd like to hear where it fails on your photos.

Likely questions, short true answers:
- *Why AGPL?* ISNet's weights are AGPL. BiRefNet is MIT, but phones and the CPU fallback still need ISNet.
- *Offline?* Not promised. Don't say yes.
- *Why not just rembg?* rembg is great on a server or CLI; this is for people who want a web page and no install.
- *Privacy with ads?* The page has no third-party code. A Zazzle card uploads its cut-out only when clicked.
- *Download size?* About 120 MB once. Pinned versions, cached for a year.

## Replies for "remove.bg alternative" threads

Answer the question first, say it's yours, one reply per thread, no follow-ups pushing it. Link the app root.

1. **Short, general (Reddit):**

   > I built goodbye.bg for this (disclosure: it's mine). Free, no account, no watermark, and the cut-out happens in
   > your browser instead of on a server. Batches up to 50 with a zip. No API.
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

   > For product shots, try goodbye.bg (I made it). Drop a whole folder, get transparent PNGs or JPGs on white at the
   > photo's resolution, and download them all as one zip. Free, no account. Check the edges on shiny or see-through
   > items before you list them. https://goodbye-bg-git.pages.dev/?ref=reddit

5. **iPhone users (r/iphone, r/photography, forums):**

   > iOS can lift a subject itself: press and hold it in Photos. If you need a batch or a file you can share, I built
   > goodbye.bg: it works in Safari, takes HEIC straight from the camera roll, about 5 seconds a photo, and press-and-hold
   > saves the result to Photos. Disclosure: it's mine. https://goodbye-bg-git.pages.dev/?ref=forum

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
- [ ] Re-read every claim above against the site that day (features land fast). If photo backgrounds, a brush or
      an API ship, update the "missing" lines.
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
