# Ads plan

Two halves: paying to bring people to goodbye.bg, and earning from ads on it. Written 2026-11-20.
remove.bg shuts down on 1 December 2026, so its users will start searching for a replacement in the next
11 days and for a few weeks after. That window matters more than anything else here.

## Ads to goodbye.bg

**On hold (decided 2026-11-20): no paid ads until ads on the site earn money.** Then spend at most what
the EthicalAds slot earned the month before. Until then, grow through free channels: SEO
(`docs/seo.md`), Show HN, Product Hunt, and answering "what replaces remove.bg?" threads. The plan below
is ready for when that happens.

Ad-management tools such as Dextrum (dextrum.app) don't fit. It's a Google Ads optimizer for advertisers,
not an ad network, and costs $99/month for 1 to 3 accounts, far more than this budget.

**Wait for the domain.** An ad that lands on `goodbye-bg-git.pages.dev` looks like a scam. The goodbye.bg
domain is waiting on the Netim trustee check. Ask Netim to speed it up. If it isn't live by 28 November,
run the campaign on the pages.dev URL anyway rather than miss the shutdown.

**Google Ads, Search only.** Bid on what remove.bg users will type, not on broad terms where Adobe, Canva
and ChatGPT outbid us:
- `remove.bg alternative`, `remove.bg shutting down`, `remove.bg closed`, `sites like remove.bg`
- `remove.bg` itself. Bidding on a competitor's name is allowed, but the ad text can't use their trademark.
- Later, if the numbers work: `remove background free no signup`, `transparent background free`.

Draft ad (headlines max 30 characters, descriptions max 90):
- Headlines: "Free Background Remover", "Runs in Your Browser", "No Upload. No Account."
- Description: "Remove backgrounds on your device. Full size, no watermark, no signup."

Also run the same keywords on **Microsoft Ads (Bing)**: cheaper clicks, an older audience that skews
towards Windows, and a one-click import from Google Ads.

**Skip social ads for now.** Reddit and Meta ads cost more and convert worse for a utility. The free
versions work better: a Show HN post, a Product Hunt launch, and replies in threads where people ask
what to use after remove.bg. The SEO session's plan (`docs/seo.md`) covers those.

**Measuring without analytics.** The page can't load Google's conversion tag (our CSP and "no analytics"
rule). Instead:
- Put `?ref=gads` (and `?ref=bing`) on the ad's final URL.
- Count those landings on the server with a small Pages Function that writes to Workers Analytics Engine.
  It stores no cookies, IPs or user IDs: a counter per `ref` per day.
- Compare that with the click counts in Google Ads. "Removed a background" can be a second counter: a
  `fetch("/api/hit?e=done")` that sends no photo data. It still has to be same-origin to fit the CSP.
- Budget: start at about $20/day with a max cost per click, look after 3 days, and stop anything that
  doesn't bring repeat visits.

## Ads on goodbye.bg

**What's already built:** a sandboxed iframe (`src/ad.html`) below the results, turned off (`ADS = false`).
The ad code can't read the page or the photos. The page keeps its own CSP; only `ad.html` would allow
the ad network's hosts.

**Rules, so ads don't ruin the "zero friction" promise:**
- Never before the first result, never in the drop zone, no popups, no interstitials, no autoplay.
- At most one slot, below the results, shown only after the first cut-out finishes.
- No cookie banner. That rules out Google AdSense (it needs consent prompts in the EU and UK, and it
  sets cookies, which contradicts "no cookies" in the footer).

**Options, best fit first:**
1. **Direct sponsor.** One sponsor per month, a static image and link hosted on our own origin. No third
   parties at all, so the privacy line stays true. Good fits: print-on-demand, e-commerce photo tools,
   anything for online sellers who cut out product shots. It takes outreach, so start once traffic is real.
2. **EthicalAds.** No cookies, no tracking, contextual. Built for developer sites, so it may pay little
   on a general audience. Chosen; see the decision below.
3. **Carbon Ads.** Similar privacy and design-focused, but invite-only, with a minimum traffic level.

**Footer:** if any network ad runs, the footer has to change from "no cookies, no analytics" to whatever
is still true. Direct sponsors keep it true as written.

**Decision (2026-11-20): EthicalAds.** It's wired up and switched off:
- `src/ad.html` holds the EthicalAds tag (client pinned to v2.6.0, publisher ID `goodbye-bg`, keywords
  design, photography, images, ecommerce; horizontal image ad, flat theme that follows dark mode).
- `_headers` lets only `ad.html` reach `media.ethicalads.io` and `server.ethicalads.io`.
- The iframe has no `src` until `ADS = true`, so nothing loads from EthicalAds while ads are off.
- EthicalAds sets no cookies and uses no storage (checked in their client code), so the footer stays true.

What their rules require (from their publisher FAQ and policy):
- At least 50,000 pageviews a month to be approved; they make exceptions for fast-growing sites. The
  remove.bg shutdown spike may count.
- One ad per page, above the fold on the first visit, not inside the main content. Our slot sits between
  the app and the footer, which is above the fold on a first visit on desktop and on most phones.
- 70% revenue share, paid monthly, minimum payout $50.

To turn it on:
1. Kevin applies at ethicalads.io (his account) and confirms the publisher ID.
2. Serve `ad.html` from its own origin, such as `ads.goodbye.bg`, as a small second Pages project. In the
   sandbox on our own origin, `location.origin` is `"null"`, and the client sends that to EthicalAds as
   the page URL, so their domain check would fail. A separate origin also keeps the ad isolated from the
   photos without the sandbox having to hide its origin.
3. Set `AD_SRC` in `app.js` to that URL, add it to `frame-src` in the page's CSP, and set `ADS = true`.

## Budget once ads earn: start at $1/day

At $1/day, spend it only where nobody else bids: the shutdown searches. About 2 to 4 clicks a day, so
this is a test, not a growth channel.
- One Google Ads Search campaign, $1/day, manual CPC with a $0.35 max bid, United States plus the
  UK/EU countries remove.bg served.
- Exact and phrase match only: `[remove.bg alternative]`, `"remove.bg shutting down"`,
  `"remove.bg closing"`, `"sites like remove.bg"`, `"remove.bg replacement"`. No broad match, no
  Display or Performance Max (they burn a small budget on junk placements).
- Negative keywords: `api`, `photoshop`, `download app`, `jobs`.
- Final URL: `https://goodbye.bg/remove-bg-alternative/?ref=gads` (until the domain is live: `https://goodbye-bg-git.pages.dev/remove-bg-alternative/?ref=gads`).
- Skip Microsoft Ads at this budget; add it if Google clicks turn into repeat visits.
- Start on 28 November, or the day goodbye.bg is live if that comes sooner. Run through December.

## Decisions for Kevin

1. ~~Budget~~: no paid ads until the site earns from ads; then start at $1/day on Google Search.
2. OK to add the cookie-free `ref` counter, the only server-side counting on the site.
3. Ads on the site: off until January, then a direct sponsor or EthicalAds.
