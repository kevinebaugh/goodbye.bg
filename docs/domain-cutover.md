# Moving goodbye.bg from pages.dev to goodbye.bg

**Done 2026-11-23** (custom domain, zone settings including Browser Cache TTL, code, Bulk Redirect). Written 2026-11-22 against `origin/main` (9278576). Do it when Netim says the domain is registered
(the trustee ID check is the only thing it waits on). Budget 15 minutes of your time, plus waiting for DNS and the certificate.

Order matters: serve the domain first, switch the site's own URLs second, redirect pages.dev last. Each step can be undone
(see Rollback).

## Checklist

**A. Cloudflare dashboard (about 5 minutes, then wait)**

1. Confirm the domain is registered at Netim and still points at `lou.ns.cloudflare.com` / `mira.ns.cloudflare.com`.
   In Cloudflare open the goodbye.bg zone, Overview, click **Check nameservers now**. Wait until the zone says **Active**
   (minutes to a few hours). [Full setup](https://developers.cloudflare.com/dns/zone-setups/full-setup/setup/)
2. Workers & Pages, project `goodbye-bg-git`, **Custom domains**, **Set up a custom domain**, enter `goodbye.bg`,
   **Continue**, **Activate domain**. Cloudflare adds a proxied `CNAME goodbye.bg -> goodbye-bg-git.pages.dev` itself.
   [Custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/)
3. Wait for the status to go from **Verifying** to **Active** (the SSL certificate is issued by the same step, usually
   under 15 minutes). Stuck longer: look for a zone hold, or a WAF/Access rule blocking `/.well-known/acme-challenge/*`.
   [Debugging Pages](https://developers.cloudflare.com/pages/configuration/debugging-pages/),
   [Known issues](https://developers.cloudflare.com/pages/platform/known-issues/)
4. Zone settings, before telling anyone (a proxied zone puts its own settings in front of Pages:
   [Zone settings](https://developers.cloudflare.com/pages/configuration/custom-domains/#zone-settings)):
   - SSL/TLS mode: **Full** or **Full (strict)**, never Flexible (redirect loop).
   - Speed, Optimization: **Rocket Loader off**, no Auto Minify, no automatic Web Analytics / beacon injection, no Zaraz.
     Anything injected breaks `script-src 'self'` and the "no third-party scripts" rule.
   - Leave HSTS off until step 12 passes (it can't be taken back quickly).
   - Optional: add `www` (proxied CNAME to `goodbye.bg`) and redirect it to the apex
     ([www redirect](https://developers.cloudflare.com/pages/how-to/www-redirect/)).
5. Check it serves with the right headers: run the curl block "Step 5" below. Do not go on if COOP/COEP are missing.

**B. Code (one commit, about 5 minutes; every hit is in the table)**

6. `scripts/build.mjs`: `SITE` default becomes `https://goodbye.bg`. This fills `%SITE%` in `index.html` (canonical, JSON-LD),
   the two text pages' canonicals, `sitemap.xml` and `robots.txt`; those need no edit.
7. `src/index.html`: `og:url` and `og:image` use `%SITE%` too since 2026-11-22, so step 6 covers them. Bump the `v` on
   `og.png?v=` so link-preview caches refetch, and update the comment above them.
8. `scripts/serve.mjs:30`: `LIVE` default -> `https://goodbye.bg`. Local dev proxies `/api/count` to it, and the
   POST would hit the redirect from step 10 otherwise.
9. Docs and launch copy: swap the host in the files in the table. Keep `?ref=` on `/` only (launch README says why).
   Then commit and push to `main`; Pages deploys. Run the "Step 9" curl block.

**C. Redirect pages.dev to goodbye.bg**

10. Create the Bulk Redirect (see next section). Start with status **302**, test, then change to **301** after an hour.

**D. Search**

11. Search Console and Bing (see the section below).
12. Run the "Step 12" curl block; then, optionally, turn on HSTS (SSL/TLS, Edge Certificates) without preload.

## The 301 from pages.dev

**Safe option: an account-level Bulk Redirect on the pages.dev host.** Cloudflare documents exactly this case, so yes,
Bulk Redirects can take a `pages.dev` hostname as a source even though you do not own that zone:
[Redirecting *.pages.dev to a Custom Domain](https://developers.cloudflare.com/pages/how-to/redirect-to-custom-domain/),
[Bulk Redirects](https://developers.cloudflare.com/rules/url-forwarding/bulk-redirects/),
[create them in the dashboard](https://developers.cloudflare.com/rules/url-forwarding/bulk-redirects/create-dashboard/).

1. Account home (not a zone), **Bulk Redirects**, create a list `goodbye-pages-dev`:

   | Source URL | Target URL | Status | Parameters |
   |---|---|---|---|
   | `goodbye-bg-git.pages.dev` | `https://goodbye.bg` | 302 first, then 301 | Preserve query string, Subpath matching, Preserve path suffix |

   **Leave "Include subdomains" off** (the Cloudflare example ticks it). Off keeps
   `<branch>.goodbye-bg-git.pages.dev` previews working, including the Zazzle context alias in `docs/zazzle-cap.md:133`,
   and they keep Cloudflare's `X-Robots-Tag: noindex`.
2. Create a Bulk Redirect rule that uses the list, and enable it.
3. Preserve query string is required: `?ref=hn` is how launch traffic is counted (`src/app.js:266`), and `?url=` links
   (`src/app.js:2633`) must keep working.

Why this is safe for COEP/COOP: the redirect is answered at Cloudflare's edge before the request reaches Pages, so
`pages.dev` serves no app page that needs headers. Requests to `goodbye.bg` never touch the redirect and go through
Pages' normal static path, where `src/_headers` applies unchanged.

**Why a Pages Function middleware is risky.** CLAUDE.md (the paragraph on page views, "A Pages Function on `/` was avoided") records that a Pages Function on `/`
was avoided because `_headers` (COEP `require-corp` and COOP, which give iPhones their wasm threads) did not apply to
function responses. [Cloudflare's headers page](https://developers.cloudflare.com/pages/configuration/headers/) says the
same: `_headers` is for static assets, not Functions output. A `functions/_middleware.js`
([middleware](https://developers.cloudflare.com/pages/functions/middleware/)) runs on every request, so every page, model
part and wasm file would pass through function code, and any response it builds itself loses the headers. One mistake
leaves the app without cross-origin isolation (CPU engine drops to one thread, SharedArrayBuffer gone) and nothing fails
loudly. It also turns free static requests into function invocations, and the same code would ship to goodbye.bg. Do not
use it. (The host check `docs/seo.md:53` mentions as an alternative is this middleware; this document replaces that line.)

**If the Bulk Redirect is not available** (the account refuses a pages.dev source, or the plan limit is hit): the
fallbacks, best first:
1. Delete and recreate the Pages project under a new name and keep `goodbye-bg-git` as a project that holds only a
   `_redirects` file (`/* https://goodbye.bg/:splat 301`). Heavy (new bindings, new project); last resort, because a
   `*.pages.dev` name cannot be renamed ([known issues](https://developers.cloudflare.com/pages/platform/known-issues/)).
2. Leave pages.dev serving the app and rely on the canonical link (`<link rel="canonical">` already points at
   `%SITE%`). Search engines consolidate on goodbye.bg; people on old links keep a working site. This is the zero-risk
   fallback, and the cost is some split of ranking and of the `from` counts.

`src/_redirects` only holds `/share / 303`; do not add a host redirect there. Pages `_redirects` cannot match on host.

## Every hard-coded pages.dev (and related) hit

Found with `git grep -n "pages.dev"` on origin/main 9278576.

| File:line | What | Action |
|---|---|---|
| `scripts/build.mjs:16-17` | `SITE` default and its comment | Change to `https://goodbye.bg`, drop "once the domain resolves" |
| `src/index.html:31` | `og:url` | `https://goodbye.bg/` |
| `src/index.html:34` | `og:image` | `https://goodbye.bg/og.png?v=3` |
| `src/index.html:28` | comment "switch to goodbye.bg once live" | Reword |
| `scripts/serve.mjs:30` | `LIVE` for the dev `/api/count` proxy | `https://goodbye.bg` |
| `docs/seo.md:50,53` | cutover instructions (still the todo) | Mark done, remove the middleware option |
| `docs/launch/README.md:8-9` | "Link to use" rule | Say goodbye.bg, old host only as fallback |
| `docs/launch/README.md:77,107,165,172,178,185,192` | `?ref=` links in PH, HN, Reddit and forum drafts | Replace host with `goodbye.bg` |
| `docs/launch/README.md:233,237` | "If goodbye.bg isn't live yet" section | Delete once live |
| `docs/launch-drafts.md:8` | link rule (the file says README replaces it) | Delete the file or update |
| `docs/ads.md:17,19,103` | ad landing URLs, "wait for the domain" | Use goodbye.bg, drop the fallback |
| `docs/zazzle-cap.md:133` | declared Zazzle image domains | No change: `goodbye.bg` is already declared |
| `docs/zazzle-cap.md:154` | test link with `https://goodbye-bg-git.pages.dev/icon-512.png` | Test again on goodbye.bg (step 12) |
| `docs/platforms-and-phone-model.md:132,137` | `?debug=1` phone test URL | `https://goodbye.bg/?debug=1` |
| `docs/overnight-2026-11-21.md:20` | history log | Leave |
| `CLAUDE.md:55` | preview URL pattern | Keep (still true) |
| `CLAUDE.md:529-531` | "Open items" domain entry | Replace with "live since <date>" and a link to this file |

Not hits, no change: `package.json:14`, `wrangler.toml`, `CLAUDE.md:13,54,91`, `README.md:41,45` (project name
`goodbye-bg-git` stays). `sitemap.xml` and `robots.txt` use `%SITE%`. `src/manifest.webmanifest` uses only relative paths
(`id`, `start_url`, `scope`, icons, `share_target`), so no edit. `src/sw.js` uses `location.origin` and relative paths.
Functions use `new URL(request.url).origin` (`functions/go/[id].js:29`, `functions/api/cap/[key].js:18`), so the Zazzle
cut-out link becomes `https://goodbye.bg/cap/<key>.png`; the domain is already declared in Zazzle. The functions' "Only for
goodbye.bg." messages are already the right name. No `og:` tags or canonicals sit in `how-to-remove-background` or
`remove-bg-alternative`; they use `%SITE%`.

## What changes for people

- **Kept photos do not move.** IndexedDB (`goodbye-bg`), the Cache API, localStorage and the service worker are per origin.
  Photos kept on `goodbye-bg-git.pages.dev` stay there; goodbye.bg starts empty. Since pages.dev will now redirect, people
  cannot reach them again without a trick (`<project>.pages.dev` is still reachable via an alias such as a preview URL, but
  do not advertise that). This hits only people who used the site before the cutover, and the launch has not happened.
  Cheapest honest fix: nothing. Say so in the launch notes if someone asks. Do not build a migration; the page would have
  to talk between origins, which the CSP forbids.
- **Old service worker.** A returning visitor's browser still has `/sw.js` on pages.dev. Navigations go through it
  network-first; the 301 comes back as a redirect for a navigation request, which the browser follows to goodbye.bg, so
  they land on the new site. The SW's own update check will fail on a redirect and the old worker (and its roughly
  116 MB model cache) stays on that origin until the browser evicts it. Harmless; it cannot be cleaned remotely once the
  redirect is on. Offline use on goodbye.bg needs one fresh online visit, same as any first visit (model download again).
- **Open tabs on pages.dev** keep running their old code until closed; their `/api/*` calls get redirected and fail
  silently (CSP `connect-src 'self'` blocks following it). A few lost counts at most.
- **Share target / installed PWA.** An app installed from pages.dev keeps its old origin and `/share` target; it will start
  redirecting too. Anyone wanting the Android share sheet and Open-with must reinstall from goodbye.bg. Say so in the
  launch notes if you care; it is a small group.
- **Analytics `from` host.** `src/app.js:265-276` sends `document.referrer`'s hostname, and skips it when it equals the
  page's own host. A browser keeps the original referrer through a 301, and the page itself sends `Referrer-Policy:
  no-referrer`, so pages.dev will not show up as a source. Traffic from hosts that linked to the old URL will still be
  attributed to them, and `ref.hn`-style tags survive because the query string is preserved. Expect `from_site` to be
  empty (direct) for people who bookmark. The view query in CLAUDE.md is unchanged; note the cutover date next to your
  first week's numbers. The counter (D1), ratings dataset and R2 bucket are bound to the project, not the host, so
  totals keep growing.
- Ad cards and the Zazzle click: no change except the host in the cut-out URL (above); declared in Zazzle already.

## Search Console and Bing

1. [Search Console](https://search.google.com/search-console): **Add property**, **Domain**, `goodbye.bg`. It gives a TXT
   record; add it in the goodbye.bg zone DNS (Cloudflare, DNS, Records, type TXT, name `@`), then Verify. No tag or file on
   the page. [How verification works](https://support.google.com/webmasters/answer/9008080)
2. Submit `https://goodbye.bg/sitemap.xml` (Sitemaps). Request indexing for `/`, `/remove-bg-alternative/` and
   `/how-to-remove-background/` (URL Inspection).
3. **Change of Address** ([Google](https://support.google.com/webmasters/answer/9370220)) needs the old site verified in
   Search Console. A DNS TXT record cannot be added to `pages.dev` (you do not control its DNS; it is a shared public
   suffix), and a file or meta-tag verification would have to be served with a 200 while the redirect is on. So: if
   pages.dev was never added, skip Change of Address; the 301s, the canonical links and the new sitemap do the same job
   for a site this size. If it was already verified (URL-prefix property with a tag), run the tool after step 10 as 301.
4. Bing Webmaster Tools: **Add a site** `https://goodbye.bg`; verify by importing from Search Console (easiest once step 1
   is done) or by the DNS CNAME it shows. Submit the same sitemap. Bing's Site Move tool is the equivalent of Change of
   Address and has the same prerequisite: the old host verified in Bing. [Bing Webmaster help](https://www.bing.com/webmasters/help/)
5. Leave the old pages.dev URLs out of the sitemap (they are not in it).

## Rollback

| Problem | Undo | Time |
|---|---|---|
| Redirect looks wrong | Bulk Redirects, **disable** the rule (or delete the list). Browsers cache a 301 for a long time, which is why step 10 starts as 302. | seconds to minutes |
| Site or og tags wrong after the code push | `git revert <commit>` and push; Pages redeploys. Or Pages, Deployments, pick the previous production deployment, **Rollback** ([rollbacks](https://developers.cloudflare.com/pages/configuration/rollbacks/)). | 1 to 2 minutes |
| goodbye.bg broken or cert stuck | Leave the redirect off and keep sharing the pages.dev link (the app still works there). Fix, retry. Last resort: remove the custom domain (delete the CNAME in DNS, then Custom domains, Remove domain: [steps](https://developers.cloudflare.com/pages/configuration/custom-domains/#delete-a-custom-domain)). | minutes |
| COOP/COEP missing on goodbye.bg | Zone setting injecting something, or a Transform Rule/Page Rule overriding headers. Disable it; do not turn the redirect on until step 5 passes. | minutes |
| HSTS turned on, then a problem | Cannot be undone quickly, which is why it is last and optional. | days |
| Launch posts already point at goodbye.bg | They cannot be edited on HN. Keep goodbye.bg healthy rather than rolling back; pages.dev stays as the safety copy only while the redirect is off. | n/a |

Nothing about the data needs rollback: the counter, ratings and R2 bucket are unaffected by the host.

## What to verify with curl

Replace nothing; copy and paste. `-sI` shows headers only.

**Step 5, after the certificate is Active (before any code change):**

    curl -sI https://goodbye.bg/ | grep -iE '^(HTTP|cross-origin|content-security|x-content|referrer-policy|server|cf-ray)'
    curl -sI https://goodbye.bg/sw.js | grep -iE '^(HTTP|cache-control)'
    curl -sI https://goodbye.bg/version.txt | grep -iE '^(HTTP|cache-control)'
    curl -s  https://goodbye.bg/api/count | head -c 200; echo
    curl -sI http://goodbye.bg/ | grep -iE '^(HTTP|location)'

Want: `HTTP/2 200`; `cross-origin-opener-policy: same-origin`; `cross-origin-embedder-policy: require-corp`; a
`content-security-policy` that starts with `default-src 'self'`; `sw.js` `no-cache`; `version.txt` `no-store`; a number from
`/api/count`; and the http request answers 301 or 308 to https.

**Step 9, after the code push (give Pages a minute):**

    curl -s https://goodbye.bg/ | grep -oE '(rel="canonical" href|og:url" content|og:image" content)="[^"]+"'
    curl -s https://goodbye.bg/remove-bg-alternative/ | grep -o 'rel="canonical" href="[^"]*"'
    curl -s https://goodbye.bg/sitemap.xml | grep -o '<loc>[^<]*</loc>'
    curl -s https://goodbye.bg/robots.txt | grep -i sitemap
    curl -s https://goodbye.bg/ | grep -c 'pages.dev'        # want 0
    curl -sI https://goodbye.bg/og.png | grep -iE '^(HTTP|content-type)'

Want only `https://goodbye.bg/...` everywhere and a count of `0`.

**Step 12, after the redirect:**

    curl -sI "https://goodbye-bg-git.pages.dev/?ref=hn" | grep -iE '^(HTTP|location)'
    curl -sI "https://goodbye-bg-git.pages.dev/remove-bg-alternative/" | grep -iE '^(HTTP|location)'
    curl -sI "https://goodbye-bg-git.pages.dev/does-not-exist" | grep -iE '^(HTTP|location)'
    curl -sIL "https://goodbye-bg-git.pages.dev/?ref=hn" | grep -iE '^(HTTP|location|cross-origin)'
    curl -sI "https://main.goodbye-bg-git.pages.dev/" | grep -iE '^(HTTP|x-robots-tag|location)'

Want: `HTTP/2 302` (then `301` once you flip it) with `location: https://goodbye.bg/?ref=hn` (query kept) and
`location: https://goodbye.bg/remove-bg-alternative/` (path kept); the final hop of the `-L` request is `200` with
`cross-origin-embedder-policy: require-corp`; the branch alias is NOT redirected and still has `x-robots-tag: noindex`
(if it redirects, "Include subdomains" is on; turn it off).

Then once in a browser: open `https://goodbye.bg/?debug=1`, drop a photo, and in the console check
`crossOriginIsolated === true`; click a Zazzle ad and confirm the product opens with the cut-out
(`/cap/<key>.png` is now fetched from goodbye.bg).

## Sources

- Custom domains: https://developers.cloudflare.com/pages/configuration/custom-domains/
- Redirect pages.dev to a custom domain: https://developers.cloudflare.com/pages/how-to/redirect-to-custom-domain/
- Bulk Redirects: https://developers.cloudflare.com/rules/url-forwarding/bulk-redirects/
- Pages headers (`_headers`): https://developers.cloudflare.com/pages/configuration/headers/
- Pages Functions middleware: https://developers.cloudflare.com/pages/functions/middleware/
- Rollbacks: https://developers.cloudflare.com/pages/configuration/rollbacks/
- Debugging Pages (stuck verification): https://developers.cloudflare.com/pages/configuration/debugging-pages/
- Full DNS setup (nameservers): https://developers.cloudflare.com/dns/zone-setups/full-setup/setup/
- Google verification and Change of Address: https://support.google.com/webmasters/answer/9008080,
  https://support.google.com/webmasters/answer/9370220
