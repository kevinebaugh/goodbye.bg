# Overnight run, 2026-11-21 → 22

Kevin's goals: use the night's Claude usage and leave 10% of the **weekly** limit. goodbye.bg should replace
remove.bg completely and make real money. Plan: `~/.claude/plans/calm-finding-milner.md`.

Budget at 23:03 EST: weekly 24% (resets 13:00 EST Sunday), 5-hour window 23% (resets 23:30, 04:30, 09:30).
Extra usage capped at $0. Stop starting new work at 85% weekly; never pass 90%.

## Log

| Time (EST) | Item | Session | Weekly before → after | Result |
|---|---|---|---|---|
| 23:10 | 1 SEO + remove.bg users | seo-removebg | 24% → 26% | b484394, 58e9044: keyword title/description, real 404 (/share falls back to app), honest remove.bg comparison (credits, API → Leonardo.Ai), launch drafts in docs/launch-drafts.md (not posted). SW share path untested. |
| 23:10 | 3 QA of today's features | qa-new-features | 24% → 26% | b9a2e0d, 46a489e, 73d062d, f11af54, 9c11ee2, 4bbd2aa: ProRAW portrait DNGs no longer sideways; ZIPs over 50 keep the first 50 by name; local server runs the cut-out delete; portrait HEIC tested. No production ad clicks sent. |
| 23:10 | 4 Funnel readout (Sonnet) | funnel-readout | 24% → 24% | 81e4a6a docs/funnel-2026-11-22.md. 69 views, nearly all Kevin's tests (no real users yet); no A/B winner. Top: Zazzle commission answer (Kevin), traffic before 1 Dec, referrer is empty, iPhone 16 MP PNG crash. |
| 23:15 | 2 Background colour + JPG + referrer fix | bg-color | 24% → 26% | f9201c1, b403be4: background picker (see-through, white, black, aqua, sage, any colour), JPG when solid, kept on reload; not for GIFs. Referrer was not a bug (no referrers yet); added ?ref=<tag>. iPhone: engine stops before a full-size PNG (untested on device). 6902df8: remove stays in the bar on cards without a picker. |
| 23:22 | (already running) 1000-photo quality test | test-1000-images | – | 320e65d docs/quality-1000.md: BiRefNet 85/14/5 good/usable/bad vs ISNet (iPhones) 57/32/15. Next: better phone model, tap to drop/restore mask pieces. |
| 23:40 | 5 Reload jitter (Kevin: "Still jitter"), then design leftovers | jitter-design | 26% → 29% | d8b46e9, 1a96d24, 3578a68, d87df90. Causes: the partner list arrived late (1 cell reserved instead of 4), kept ads waited 1.1 s, an empty frame between placeholder and product, footer width. Reload CLS before→after: phone 2 photos 0.24→0, desktop 1 photo 0.083→0 (production rechecked). Design: working photo stands out, votes look tappable on phones, failed cards name the file. Open: landing→grid jump (0.37), ad products differ per reload by design. |
| 23:25 | 7 Research: Safari GPU, 8 GB Macs, phone model | research-platforms | 26% → 29% | c89b22e, 8c5ea2c docs/platforms-and-phone-model.md. Phones: BiRefNet lite at 640 (IoU 0.948 vs ISNet 0.894, bad 78 vs 177, same memory, +10% time). Mac Safari still untested (2-minute check for Kevin in the doc). Weak GPUs: fall back to ISNet on the GPU at runtime; deviceMemory under 8 → ISNet. Zoomed second pass: not worth it. |
| 23:47 | 6 Mask editing (tap pieces, brush) on branch mask-edit | background agent (check-in turns can't start sessions) | 28% → 29% | Branch mask-edit (1fdd204, 862eeda), preview https://mask-edit.goodbye-bg-git.pages.dev. Tap a cut-out → edit view: tap pieces, erase/restore brush, undo. Edits flow into downloads, reload, ads. Untested on real phones/Safari/Firefox; no keyboard entry yet. NOT on main: Kevin decides. |
| 00:13 | Smoke-test suite + regression sweep | background agent | 29% → 30% | 9e6ed67, 2846b4a, c5a13a0, e9dea04: `npm run test` (16 checks, ~40 s, both engines), local server returns real 404s, SEO/404 pages now preload Nunito. Two app.js bugs handed to the first-visit agent (Paste message on phones says ⌘/Ctrl+V; duplicate ad cards with ?adtest=1). Each test run adds ~10 to the public count. |
| 00:13 | First-visit speed, model download timing, landing→grid transition | background agent | 29% → 31% | c5aa4fe, 85bb78d, 499ae23: phones download the 116 MB model only on a first sign of a photo coming (computers, returning visitors, kept photos, shares: at once); runtime and model in parallel; fflate lazy; first photos animate in (View Transition), CLS 0.37 → 0; the two bugs fixed; `?adpartner=`. Phone visitor who leaves: 116 MB → 0.1 MB. Cost: a first-time phone visitor who waits 16 s before tapping gets the first cut-out 19 s later (53 → 72 s at 20 Mbps). Kevin's call; going back to eager is one line. |
| 00:20 | BiRefNet 640 for phones on branch phone-birefnet640 | background agent | 29% → | started |
| 00:35 | Launch kit: PH/HN images, demo GIF, og.png, tightened copy | background agent | 30% → | started |

Check-in 23:46: weekly 28%, 5-hour window 6% (reset 04:30 UTC). About 4 weekly points in the first 45 min.

## Findings

## Morning summary
