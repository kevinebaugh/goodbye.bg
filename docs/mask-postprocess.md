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
- **Guided filter on wide soft edges (`refineEdge`): ship for BiRefNet only, behind `?pp=1` first.** On the held-out half,
  12 photos better and 0 worse on IoU, edge error 0.0615 to 0.0561 (9% lower) and lower on 176 photos and higher on 1, no
  catastrophic failures. The good/usable/bad counts don't move: it fixes edges, not subjects. What it looks like: fur,
  dandelion fluff, smoke and twigs against the sky get their gaps back instead of a soft blur of old background. On
  ISNet it does almost nothing (1 better, 1 worse; edge error 2% lower), so the page runs it on BiRefNet only.

Implemented on branch `mask-postprocess`: `refineEdge` in `src/app.js`, run in `segment()` after the edge curve when the
page has `?pp=1` and the model is BiRefNet; it reports its step as `edge` with ms and pixels changed. All results go
through `segment()`, so 👎 retries and GIF frames get it too. The subject box (the crop) is read again after the filter. Smoke check: "edge refinement (?pp=1, BiRefNet)".

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
again makes 66 edges worse. If BiRefNet 640 goes to phones, `refineEdge` should go with it (change `PP && birefnet` to
cover it; it is a BiRefNet result too). The worst 10 photos for the winner on 640 show no visible change. The plain
filter on 640 is worth a look by eye then.

## Cost

ms at 1024, one Node thread on the M5 Pro, median of 20 photos (`scripts/quality/ppbench.cjs`, which times the page's
own `refineEdge`; other sessions kept the load average near 7 on 18 cores): **65 ms median, 122 ms at most** on BiRefNet 1024 masks,
85 ms median and 122 ms at most on BiRefNet 640 masks. `edgeColors`, which the page already runs on every photo, takes
97 ms on the same photos. The filter works only on the box around the wide soft zones; a photo without any skips it after the full-frame
checks (a few ms to 25 ms). On computers that is about a fifth of BiRefNet's 0.3 s. A phone CPU is several times slower
than the M5 Pro (ISNet: 3.7 s here against 5.0 s on Kevin's iPhone with 2 threads, but single-thread JavaScript
differs more); if BiRefNet 640 goes to phones, expect roughly 0.2 to 0.4 s a photo on top of about 5 s. Not measured on a phone.

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
- Not looked at on a real iPhone or in Safari. ISNet on the GPU provider was not rerun (the CPU provider is what phones
  use; GPU and CPU masks match closely on all but hazy photos).
- The bar asked for: better on at least 3 times as many photos as it hurts, and no catastrophic failures. The winner
  clears it on BiRefNet 1024 (12/0 held out, 23/1 on all 923) and 640 (8/0, 15/0), but the counts are small because
  edges rarely move IoU by 0.02; the edge error (176/1 held out) is the clearer signal. It does not clear it on ISNet.
