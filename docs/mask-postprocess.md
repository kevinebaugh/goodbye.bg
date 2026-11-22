# Cheap mask post-processing (2026-11-22)

Can a cheap step after the model, on the mask alone (plus the photo), make real cut-outs better? Measured on the 923
photos with real masks from `docs/quality-1000.md`, for BiRefNet 1024 (computers), ISNet 1024 on the CPU provider
(today's phones, haze fix included) and BiRefNet lite 640 (the phone candidate in `docs/platforms-and-phone-model.md`).
Contact sheets hold dataset photos, so they stay in `~/goodbye-bg-quality/sheets/pp/`, not in the repo.

## Verdict

- **Picking pieces (largest component, components above X% of it, drop small ones at the border, centre-weighted
  choice): don't ship.** On these photos they only hurt: 0 to 2 photos better, 4 to 9 worse on the held-out half, for
  both engines. By eye (worst 10 of each on BiRefNet) the photos they hurt lose real parts of the subject: a boxer's tail
  and a leopard's tail where they meet the frame, leaf tips and palm fronds cut by the frame, splashes and water drops,
  strands of a spider web, blades of grass. "Which thing it keeps" (BiRefNet's main flaw) is a choice
  between whole objects; size and position don't make that choice better than the model does. A tap to drop a piece
  (idea 3 in `docs/quality-1000.md`) still looks like the way to fix it.
- **Filling holes: don't ship.** Even holes under 0.2% of the subject are mostly real: by eye, sky between leaves and
  twigs, gaps between curls of hair, the spaces inside dandelion fluff. Boundary IoU worse on 54 photos and better on 5
  (BiRefNet, held-out half); ISNet 68 worse, 21 better.
- **Otsu threshold per photo: don't ship.** BiRefNet's masks are confident (Otsu lands at 0.5 on most), and where it
  moves the cut-off it is slightly worse (0 better, 6 worse), all on see-through photos (smoke, glass, a galaxy) where
  it thins the faint parts. ISNet: 1 better, 1 worse.
- **Guided filter on wide soft edges (`refineEdge`): on by default for BiRefNet (`?pp=0` turns it off).** On the held-out half,
  12 photos better and 0 worse on IoU, edge error 0.0615 to 0.0561 (9% lower) and lower on 176 photos and higher on 1, no
  catastrophic failures. The good/usable/bad counts don't move: it fixes edges, not subjects. What it looks like: fur,
  dandelion fluff, smoke and twigs against the sky get their gaps back instead of a soft blur of old background. On
  ISNet it does almost nothing (1 better, 1 worse; edge error 2% lower), so the page runs it on BiRefNet only.

Implemented on branch `mask-postprocess`: `refineEdge` in `src/app.js`, run in `segment()` after the edge curve whenever
the model is BiRefNet, unless the page has `?pp=0`; it reports its step as `edge` with ms and pixels changed. 👎 retries go
through `segment()` and get it too. GIF frames don't: GIF transparency is on or off, so a redrawn soft edge is thrown
away, and up to 100 frames at up to 0.1 s each would add seconds to a GIF; GIF output stays as before. The subject box (the
crop) is read again after the filter. Smoke check: "edge refinement (BiRefNet, on by default, off with ?pp=0)".

## The filter

He et al.'s guided filter with the photo's colour as the guide (radius 4 px at 1024, eps 0.001), applied to the mask
after the edge curve, only within 4 px of soft zones that are wider than 3 px (soft: alpha strictly between 0 and 1;
"wider than 3 px" is a morphological opening by 1 px). It sits before `edgeColors`, so the colour fix-up uses the new mask.

The opening is the part that matters. The plain filter (everywhere along the soft edge) scored a little higher on IoU
(16 better, 2 worse) but made crisp edges worse: edge error up on all 75 DIS photos (0.058 to 0.081) and on 30 of 45
furniture photos, and by eye a white tufted headboard against a pale sky got a ragged, feathered top edge. A crisp edge is a thin
soft line; hair is a wide soft band. Limited to wide bands, the filter leaves crisp edges exactly as they were (DIS and
furniture edge error unchanged) and keeps nearly all of the gain on fur, hair and plants.

## Results

Held-out half (484 photos; parameters chosen on the other 439). Better/worse: the photo's IoU moved more than 0.02
(boundary IoU: 0.02; edge error: 0.005). Good: IoU 0.95 or more, bad: under 0.85. Catastrophic: IoU down more than 0.2,
or the subject lost.

**BiRefNet 1024 (computers)**

| Step (best of its family on the tuning half) | IoU | Boundary IoU | Edge error | Good/usable/bad | Better/worse IoU | Boundary b/w | Edge b/w | Catastrophic |
|---|---|---|---|---|---|---|---|---|
| Today | 0.9575 | 0.9025 | 0.0615 | 417/40/27 | | | | |
| Keep components over 5% of the largest | 0.9570 | 0.9019 | 0.0618 | 414/43/27 | 0/5 | 0/5 | 0/6 | 0 |
| Drop border components under 10% | 0.9571 | 0.9021 | 0.0617 | 414/43/27 | 0/4 | 0/4 | 0/5 | 0 |
| Centre-weighted choice (sigma 0.5, keep over 10%) | 0.9567 | 0.9015 | 0.0619 | 414/43/27 | 0/9 | 0/9 | 0/9 | 0 |
| Fill holes under 0.2% | 0.9567 | 0.8943 | 0.0630 | 415/40/29 | 1/4 | 5/54 | 1/38 | 0 |
| Otsu cut-off (0.4 to 0.6) | 0.9568 | 0.9018 | 0.0617 | 417/40/27 | 0/6 | 0/6 | 0/6 | 0 |
| Guided filter, everywhere | 0.9596 | 0.9062 | 0.0567 | 420/39/25 | 16/2 | 17/4 | 236/85 | 0 |
| **Guided filter, wide soft zones only** | **0.9589** | **0.9044** | **0.0561** | **417/40/27** | **12/0** | **13/1** | **176/1** | **0** |

All 923 photos, the winner: IoU 0.9604 to 0.9618, boundary IoU 0.904 to 0.906, edge error 0.060 to 0.055, MAE 0.0109
to 0.0100; better/worse 23/1 (IoU), 329/1 (edge). The one worse photo is a star-trail sky BiRefNet already fails (IoU
0.07). Gains by set: AIM-500 see-through and plant photos move most (IoU +0.016 and +0.006 on average); portraits (P3M)
and animals (AIM-500) gain on the edge (edge error 0.049 to 0.044 and 0.063 to 0.055) with IoU about the same;
furniture and DIS thin objects are unchanged (0.038 and 0.058 before and after).

**ISNet 1024, CPU provider, haze fix on (phones)**

| Step | IoU | Boundary IoU | Edge error | Good/usable/bad | Better/worse IoU | Boundary b/w | Edge b/w | Catastrophic |
|---|---|---|---|---|---|---|---|---|
| Today | 0.9022 | 0.7802 | 0.1116 | 306/93/84 | | | | |
| Keep components over 5% of the largest | 0.9020 | 0.7803 | 0.1119 | 306/92/85 | 1/2 | 1/3 | 0/5 | 0 |
| Drop border components under 10% | 0.9022 | 0.7803 | 0.1118 | 307/91/85 | 2/3 | 2/3 | 0/4 | 0 |
| Centre-weighted choice | 0.9018 | 0.7800 | 0.1121 | 307/90/86 | 2/6 | 2/7 | 0/8 | 0 |
| Fill holes under 0.2% | 0.9012 | 0.7739 | 0.1143 | 304/94/85 | 1/7 | 21/68 | 2/68 | 0 |
| Otsu cut-off | 0.9020 | 0.7798 | 0.1120 | 305/94/84 | 1/1 | 2/2 | 1/5 | 0 |
| Guided filter, everywhere (r 3) | 0.9031 | 0.7822 | 0.1100 | 308/93/82 | 2/1 | 11/4 | 157/65 | 0 |
| Guided filter, wide soft zones only | 0.9027 | 0.7811 | 0.1097 | 306/94/83 | 1/1 | 11/8 | 101/19 | 0 |

ISNet's failures are missing or hazy parts, decided long before the edge; a 4 px filter can't bring back a tail.

**BiRefNet lite 640 (phone candidate; same parameters as for 1024, not re-tuned)**

| Step | IoU | Boundary IoU | Edge error | Good/usable/bad | Better/worse IoU | Boundary b/w | Edge b/w | Catastrophic |
|---|---|---|---|---|---|---|---|---|
| Today (mask scaled 640 to 1024) | 0.9466 | 0.8663 | 0.0759 | 391/54/39 | | | | |
| Keep components over 5% of the largest | 0.9461 | 0.8657 | 0.0762 | 390/54/40 | 0/5 | 0/7 | 0/7 | 0 |
| Drop border components under 10% | 0.9462 | 0.8658 | 0.0762 | 390/55/39 | 0/5 | 0/7 | 0/6 | 0 |
| Centre-weighted choice | 0.9458 | 0.8653 | 0.0763 | 390/54/40 | 0/9 | 0/11 | 0/10 | 0 |
| Fill holes under 0.2% | 0.9462 | 0.8601 | 0.0768 | 389/56/39 | 0/0 | 3/46 | 1/24 | 0 |
| Otsu cut-off | 0.9461 | 0.8656 | 0.0763 | 391/54/39 | 1/5 | 1/6 | 1/11 | 0 |
| Guided filter, everywhere | 0.9509 | 0.8753 | 0.0714 | 400/49/35 | 19/0 | 27/7 | 226/66 | 0 |
| **Guided filter, wide soft zones only** | **0.9483** | **0.8687** | **0.0708** | **394/52/38** | **8/0** | **9/7** | **169/2** | **0** |

All 923, the winner: IoU 0.9478 to 0.9495, edge error 0.075 to 0.070, better/worse 15/0 (IoU) and 327/3 (edge). The
plain filter gains more here (the 640 mask is blurrier once scaled up, so more of its edge counts as unsure) but it
again makes 66 edges worse. If BiRefNet 640 goes to phones, `refineEdge` goes with it (the page runs it on any
BiRefNet result; BiRefNet 640 is not on main yet, so today that means computers only). The worst 10 photos for the winner on 640 show no visible change. The plain
filter on 640 is worth a look by eye then.

## Cost

**Phone-like timing (2026-11-22).** Headless Chrome on the M5 Pro, V8 single-threaded (`--js-flags=--single-threaded`),
CDP CPU throttling at 1x, 4x and 6x (`scripts/quality/ppchrome.mjs`, data from `ppchrome-prep.cjs`). 24 runs per set: 20
photos, 10 of them the photos with the largest soft-zone boxes of all 923 and 10 spread (16 of the 20 are AIM-500, so the
set leans to the worst case), plus 18 MP (5184 x 3456) copies of 4 of the largest. Each photo is decoded and drawn to 1024
the way `segment()` does; the time is `refineEdge` alone, median of 3 runs per photo. The measured version and the new one
ran in the same Chrome, taking turns photo by photo (the load average was 2 to 7 from other sessions).

| ms per photo | 1x median / max | 4x median / max | 6x median / max | Typed arrays allocated (median / max) |
|---|---|---|---|---|
| Measured version, BiRefNet 1024 masks | 130 / 165 | 504 / 683 | 768 / 1070 | 213 / 217 MB |
| **Streaming version, BiRefNet 1024** | **45 / 111** | **183 / 451** | **271 / 682** | **11.8 / 12.1 MB** |
| Measured version, BiRefNet 640 masks | 138 / 158 | 579 / 682 | 917 / 1048 | 217 / 217 MB |
| **Streaming version, BiRefNet 640** | **46 / 106** | **185 / 431** | **291 / 667** | **12.0 / 12.1 MB** |

The measured version was 0.77 to 1.07 s at 6x and held up to 217 MB of whole-box planes (25 float planes of the box, which is
the whole frame on many photos: median box 0.27 MP, 90th percentile 0.76 MP, largest the full 1 MP). Too much for phones,
so it was rewritten first:
- **Streaming.** Every box blur runs a row at a time through a ring of 2r + 2 rows (boxBlur's own sums, in its order), and
  the steps hand rows to each other. Everything it allocates comes to 12 MB at most (an upper bound on its peak: nothing
  is freed before it returns), mostly the 1 MB 0/1 maps for the opening, band and wide zone.
- **Only where needed.** The window statistics (13 sums of colour, mask and their products) are worked out only at wide
  soft pixels, and their row blurs only within r rows of one. Those sums are exact in a double in any order (every term
  is a multiple of 2^-39 below 2^4; the row means are multiples of 2^-43 below 1), so the order does not matter. The a/b
  blur is not exact and keeps the plain filter's order over the whole box.
- **The opening on the soft pixels' box** rather than the whole frame, and `morph` walks columns a row at a time.
- **Bit for bit the same masks** as the measured version: all 923 BiRefNet 1024 masks and all 923 BiRefNet 640 masks
  byte-identical (`scripts/quality/ppsame.cjs`, the old function from the measured commit), so the quality results above
  stand unchanged. `morph` is shared with `hardenHaze`: all 923 ISNet masks with the haze fix are byte-identical too.
  Node, all 923: 71 ms to 27 ms a photo (1024 masks), 90 ms to 35 ms (640).

What that means:
- **Photo size doesn't matter.** The 18 MP copies cost the same as their originals (the filter only sees the 1024 drawing);
  drawing an 18 MP photo to 1024 is 27 to 32 ms, which the page does anyway.
- **There is no 2048 case.** The filter runs inside `segment()` at 1024. A 👎 retry runs `segment()` once more on the
  zoomed crop at 1024 (one more filter run), then `mergeRetry` merges the two filtered masks into the 2048 mask; nothing
  filters the 2048 mask.
- **Computers (BiRefNet today):** 45 ms median at full speed next to BiRefNet's 0.3 s; a slow laptop at 4x, 0.18 s
  median and 0.45 s at worst. On by default.
- **Phones (if BiRefNet 640 ships there):** at 6x, 0.29 s median and 0.67 s at worst on top of about 5 s, holding 12 MB.
  The worst photos are those with large see-through or fluffy areas (a dandelion, smoke), where it also changes the most.
  It stays on there too unless a real phone says otherwise. Not measured on a real phone or in Safari.
- The step runs on the main thread, so the page is busy for that long once per photo.

Earlier, Node on the M5 Pro (`scripts/quality/ppbench.cjs`, measured version): 65 ms median, 122 ms at most on BiRefNet
1024 masks; `edgeColors`, which the page already runs on every photo, 97 ms on the same photos.

## How

- `scripts/quality/rawdump.cjs` saves each model's raw mask (sigmoid, 1024) for the 923 photos; checked against the
  earlier runs: today's pipeline on these raw masks gives byte-identical final masks for BiRefNet (`out/birefnet`),
  ISNet with the haze fix (`out/isnet-h30s`) and BiRefNet 640 (`out/bir640`, the fp16 `c640h.onnx`; the fp32 file does
  not match).
- `postproc.cjs` runs the page's pipeline (despeck, haze fix for ISNet, edge curve) plus each candidate and scores the
  way `run.cjs` does (mask scaled to the photo, at most 2048 px). `ppcands.cjs` holds the candidates, `ppreport.cjs`
  the tables, `ppsave.cjs` and `sheet.cjs`/`zoom.cjs` the contact sheets.
- Split: a hash of the photo id (439 tuning, 484 held out; every set in both). Rule fixed before looking at the held-out
  half: no catastrophic failure, then the most "better minus 3x worse" photos, ties by mean IoU. Grid: components
  labelled at 0.25 and 0.5, keep over 5/10/20/30/50/100% of the largest; border drop under 10/25/50/100%; centre weight
  sigma 0.25/0.5; holes under 0.2/0.5/1/2/5% of the subject; Otsu clamped to 0.4-0.6/0.3-0.7/0.2-0.8; guided filter grey
  or colour, radius 2/3/4/8, eps 0.0001/0.001/0.01.
- Honest note on the winner: the opening (wide soft zones only) was added after the contact sheets of the plain
  filter showed the crisp-edge damage across the whole set. Its size (1 px, from 1/2/3) was chosen on the tuning half.
- The page's `refineEdge` and the harness's candidate give identical masks (checked on 10 masks, both engines).

## Not covered

- These sets have one subject per photo and the truth includes every piece of it. That is exactly where dropping
  pieces can only lose. COCO's busy scenes, where BiRefNet keeps a second car or a blanket, were left out: their truth
  is one labelled object, so dropping the rider would wrongly score as a win on the bicycle.
- Phone camera photos at 12 MP: the mask is still 1024, so the filter works at a quarter of the photo's pixels.
- Not looked at on a real iPhone or in Safari (timed only in Chrome with CPU throttling, see Cost). ISNet on the GPU provider was not rerun (the CPU provider is what phones
  use; GPU and CPU masks match closely on all but hazy photos).
- The bar asked for: better on at least 3 times as many photos as it hurts, and no catastrophic failures. The winner
  clears it on BiRefNet 1024 (12/0 held out, 23/1 on all 923) and 640 (8/0, 15/0), but the counts are small because
  edges rarely move IoU by 0.02; the edge error (176/1 held out) is the clearer signal. It does not clear it on ISNet.
