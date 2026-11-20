# Ads plan

Two halves: paying to bring people to goodbye.bg, and earning from ads on it. Written 2026-11-20.
remove.bg shuts down on 1 December 2026, so its users will start searching for a replacement in the next
11 days and for a few weeks after. That window matters more than anything else here.

## Ads to goodbye.bg

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
   on a general audience. Easy to try in `ad.html`.
3. **Carbon Ads.** Similar privacy and design-focused, but invite-only, with a minimum traffic level.

**Footer:** if any network ad runs, the footer has to change from "no cookies, no analytics" to whatever
is still true. Direct sponsors keep it true as written.

**Recommendation:** keep ads off through the remove.bg shutdown wave, because first impressions matter
most while people pick their replacement. Turn on one below-the-results slot in January, with a direct
sponsor if one bites, and EthicalAds otherwise.

## Decisions for Kevin

1. Budget and start date for Google and Microsoft Ads. Suggested: $20/day each, from the day the domain
   is live, or by 28 November at the latest.
2. OK to add the cookie-free `ref` counter, the only server-side counting on the site.
3. Ads on the site: off until January, then a direct sponsor or EthicalAds.
