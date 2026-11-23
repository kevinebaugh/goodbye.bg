# SEO plan

Goal: rank above remove.bg for "remove image background" and close variants. remove.bg shuts down on
1 December 2026, so its traffic is up for grabs and searchers will look for a replacement. The window is
now through early 2027.

Status: items marked **done** are on `main` (see `src/robots.txt`, `src/sitemap.xml`, the JSON-LD in
`src/index.html`, and the pages under `src/remove-bg-alternative/` and `src/how-to-remove-background/`).

## 1. Keywords, in priority order

| Keyword | Target page | Why |
|---|---|---|
| remove.bg alternative, remove.bg shutting down, remove.bg replacement | `/remove-bg-alternative/` | Low competition, high intent, rising fast until and after 1 Dec 2026. Easiest win. |
| remove image background, remove background from image, background remover | `/` | The big head terms. Ranks only with links and time; the app page itself must carry them. |
| transparent background, make background transparent, transparent PNG | `/how-to-remove-background/` and `/` | Same job, different words. |
| remove background free, no upload, private, offline, no watermark | `/` | Our real differences. Low volume, high conversion. |
| remove background from photo on iPhone / Android | `/how-to-remove-background/` | Long tail, later its own pages if it shows up in Search Console. |

## 2. App page title and description (**done** 2026-11-21)

The `<title>` and `<meta name="description">` in `src/index.html` sit next to the share tags, so they were
left for whoever owns that file. Recommended:

- Title (under 60 chars): `Remove Image Background Free, Private – goodbye.bg`
- Description (under 155 chars): `Remove image backgrounds for free. Photos are cut out in your browser, not on a server. High resolution, transparent PNG, no account, no watermark.`
  (Changed from the first draft: "photos never upload" isn't true once a visitor clicks a Zazzle card, and "full size" isn't true past 16 MP in Safari.)
- Keep the visible H1 "Say goodbye to the background." It already contains "background"; the title does the keyword work.

## 3. Content that can win

1. **done** `/remove-bg-alternative/`: "remove.bg shuts down 1 December 2026, here is a free private alternative",
   a short comparison table, and a visible FAQ. Linked from the app footer.
2. **done** `/how-to-remove-background/`: three steps, transparent vs white, what works well and what doesn't.
3. **done** 2026-11-22, English only: three pages on things most background removers don't do or charge for, each
   with its own steps and limits (no shared paragraphs): `/bulk-background-remover/` ("bulk background remover",
   "remove background from multiple images"), `/remove-background-from-gif/` ("remove background from gif",
   "transparent gif"). (A `/white-background-product-photo/` page was cut the same day: the white background, sizes and
   shadow it described were removed from the app.) Linked from the how-to page and from each other, in the sitemap.
   Translate them once Search Console shows which languages bring visits.
   Later, only if Search Console shows the queries: `/transparent-background/`, `/remove-background-iphone/`,
   `/remove-background-android/`. Each needs real, distinct content. Thin near-duplicates hurt.
4. **done** 2026-11-21: the alternative page has an honest comparison (what we don't do: on 2026-11-21 new background, brush and API; backgrounds and the brush shipped on 2026-11-22 and the page says so, which leaves the API), what to do with credits, past images and API keys, and an "Updated" date.
5. Update the alternative page on 1 December 2026 ("remove.bg has shut down") and set `dateModified`.

## 4. Technical

- **done** `robots.txt`: allow all, disallow `/api/` and `/m/` (model files), point to the sitemap.
- **done** `sitemap.xml` with the three pages.
- **done** Canonical link on every page, absolute, trailing slash.
- **done** JSON-LD: `WebApplication` on `/` (free offer, no ratings: never invent `aggregateRating`),
  `FAQPage` on the alternative page where the same questions are visible. Since 2023 Google shows FAQ rich
  results only for government and health sites, so this helps understanding, not snippets.
- **done** Strict CSP on the new pages (no scripts at all).
- **Site origin lives in one place**: `SITE` in `scripts/build.mjs` fills `%SITE%` in the files above. It
  is `https://goodbye.bg` since 2026-11-23 (done per `docs/domain-cutover.md`: custom domain, the site's URLs, and a
  Bulk Redirect from pages.dev; never a `functions/_middleware.js`, it would drop COOP/COEP). Search Console and Bing:
  see that file.
- Preview deployments (`<branch>.goodbye-bg-git.pages.dev`) must stay out of the index. Cloudflare adds
  `X-Robots-Tag: noindex` to them; check with `curl -I` after each new branch.
- **done** (2026-11-22) **Core Web Vitals.** Measured: LCP 1.2 s mobile / 0.3 s desktop, CLS 0, TBT 0, Lighthouse 100.
  The model download never delayed first paint. Phones now download it only on intent (tap, focus, drag, paste), computers
  at idle after load, returning visitors at once (details in CLAUDE.md, "First visit"). Adding the first photos used to shift
  the layout by 0.2 to 0.37 (the hero going away); it is now a View Transition with no layout shift.
- **done** `404.html` (2026-11-21): unknown paths return a real 404 (they used to return the app with 200, a soft 404). `_redirects` sends `GET`/`POST /share` to `/` when the service worker didn't catch it (it was 405 for POST before).
- **done** on branch `i18n` (2026-11-22): the two text pages in de, es, fr, pt-BR and id under `/<lang>/...`, each with its own canonical and `hreflang` alternates (en, the five, x-default = English), all in the sitemap. The app page `/` is one URL that follows the browser language, so it has no hreflang. See `docs/i18n.md`.

## 5. Off-site (where most of the ranking comes from)

Status 2026-11-23:
- **Done:** Google Search Console and Bing Webmaster Tools (verified by DNS records, sitemap in, Google indexing
  requested for the five English pages); IndexNow (`npm run indexnow` after a deploy that changes text pages: sends
  the pages whose sitemap `<lastmod>` is today; `-- --all` sends every page); sitemap `<lastmod>` dates from git;
  GitHub description, homepage and topics; `llms.txt` has a section for assistants (the `?url=` link); AI crawlers
  are all allowed (Cloudflare's AI-bot blocking is off).
- **List pull requests opened 2026-11-23** (Kevin's GitHub, disclosed as his): diegoleme/awesome-open-source-alternatives#103,
  atakanaltok/awesome-useful-websites#405, mikbry/awesome-webgpu#145, hemanth/awesome-pwa#655,
  mcuking/Awesome-WebAssembly-Applications#102.
- **After launch (they ask for user numbers):** ikaijua/Awesome-AITools (EN and CN READMEs, a row next to remove.bg).
- **Skipped:** awesome-selfhosted (needs a first release over 4 months old), lissy93/pluja awesome-privacy (their image
  sections are full editors; product ads are a stretch for their rules), Awesome-Design-Tools (unmaintained since 2024).
- **Need Kevin's accounts:** AlternativeTo (add goodbye.bg as an alternative to remove.bg: the page assistants and
  searchers land on), There's An AI For That, SaaSHub, Futurepedia, Toolify. Product Hunt is in the launch plan.

In order:

1. **Directories and lists of remove.bg alternatives.** Search "remove.bg alternative", "remove.bg shutting
   down", "free background remover" and ask the authors of the top 20 articles to add goodbye.bg. Lead with
   the angle: free, full size, no upload, open source.
2. **Hacker News** (draft in `docs/launch-drafts.md`) "Show HN: goodbye.bg, a background remover that runs in your browser". Post on a weekday
   morning US time, close to the shutdown news. Link the source.
3. **Product Hunt** (draft in `docs/launch-drafts.md`) launch the same week. Have screenshots and a 20 s clip ready.
4. **Reddit**: r/InternetIsBeautiful, r/webdev, r/photography, r/graphic_design, threads asking what to use
   after remove.bg. Answer the question; don't spam.
5. **Open source listings**: GitHub topics (`background-removal`, `onnx`, `webgpu`), awesome lists
   (awesome-privacy, awesome-selfhosted style lists, awesome-webgpu), AlternativeTo (as an alternative to
   remove.bg), Privacy Guides forum, "privacy-friendly tools" lists.
6. **Tool directories**: There's An AI For That, Futurepedia, SaaSHub, Toolify. Free, quick, nofollow mostly,
   but they bring traffic and get scraped into other lists.
7. A short technical write-up ("running a background remover entirely in the browser with ONNX Runtime
   Web") on a dev blog or dev.to. These earn real links from developers.

## 6. Measure

- Search Console: impressions and position for the keywords above, weekly. No analytics on the site; Search
  Console needs none.
- Re-check the SERP for "remove image background" and "remove.bg alternative" in a private window monthly.
