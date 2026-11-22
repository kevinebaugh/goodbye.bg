# Quality on 1,073 public photos (2026-11-21)

Both engines, run the way the page runs them, scored against ground truth and graded by eye.
Full report with the contact sheet: https://claude.ai/artifact/Rtq1ESvfQ4TeDtRwJKcYWy (private; it shows dataset photos).

## Verdict

- **Computers (BiRefNet lite, GPU)**: of 104 cut-outs graded by eye, 85 good, 14 usable, 5 bad. Mean IoU 0.960 on the
  923 photos with real masks; 86% of them at 0.95 or better.
- **iPhones, iPads, CPU fallback (ISNet)**: of the same 104, 57 good, 32 usable, 15 bad. Mean IoU 0.894; 62% at 0.95
  or better. On the same photo BiRefNet is clearly better (IoU more than 0.02 higher) 357 times, ISNet 20 times.
- Hair is a solid shape on both: flyaway strands are cut, curly hair has a stepped edge (BiRefNet) or a band of old
  background (ISNet). See-through objects fail on both.

## Scores (mean; mask after the page's despeckle and edge curve, scaled to the photo)

| Photos | n | BiRefNet IoU | MAE | Boundary IoU | Edge error | ISNet IoU | MAE | Boundary IoU | Edge error |
|---|---|---|---|---|---|---|---|---|---|
| All with real masks | 923 | 0.960 | 0.011 | 0.904 | 0.060 | 0.894 | 0.035 | 0.773 | 0.111 |
| AIM-500 (mixed, alpha mattes) | 500 | 0.955 | 0.012 | 0.897 | 0.063 | 0.875 | 0.037 | 0.751 | 0.122 |
| P3M-500-NP (portraits) | 150 | 0.990 | 0.005 | 0.937 | 0.049 | 0.935 | 0.026 | 0.790 | 0.103 |
| AM-2k (animals) | 98 | 0.977 | 0.009 | 0.905 | 0.064 | 0.913 | 0.037 | 0.771 | 0.109 |
| Oxford-IIIT Pet (trimaps) | 100 | 0.952 | 0.023 | | | 0.889 | 0.055 | | |
| DIS5K TE1 (thin objects) | 75 | 0.923 | 0.006 | 0.887 | 0.058 | 0.921 | 0.007 | 0.890 | 0.059 |
| COCO val2017 (coarse masks) | 150 | 0.597 | 0.141 | | | 0.547 | 0.159 | | |

Boundary IoU: overlap inside a band of 2% of the diagonal along the outline. Edge error: mean alpha error within 0.6%
of the diagonal of the true edge. Boundary and edge figures in the first row cover the 823 photos that have an edge to
score (no pets). AIM-500 "transparent" (34 photos): IoU 0.661 BiRefNet, 0.450 ISNet.

COCO's row is not a quality score: its mask is one labelled object (the bicycle without the rider). By eye, 30 of 40
COCO cut-outs were good on BiRefNet and 19 on ISNet.

## By eye (random 104: 40 COCO, 16 pets, 24 AIM-500, 8 P3M, 8 AM-2k, 8 DIS)

| Main flaw | BiRefNet (19 flawed) | ISNet (47 flawed) |
|---|---|---|
| Missing parts of the subject | 4 | 20 |
| Leftover background | 3 | 11 |
| Wrong or unclear subject | 6 | 4 |
| Halo, smear or ghost | 0 | 6 |
| See-through object | 4 | 4 |
| Ragged edge | 2 | 2 |

ISNet's typical failure is a subject with a piece missing or faded to a haze (dark body, white on white, a tail, a
chest over blur). BiRefNet's is the choice of subject where that is debatable (a blanket, hands, a collage). Hair was
not graded on the 104 (300 px thumbnails); eight full-size close-ups showed the hair findings above.
"No clear subject": 4 photos with ISNet (one a plain cat close-up), 1 with BiRefNet.

## How

- Photos: fixed seed, six public sets, kept outside the repo. Sources and the terms their authors give:
  AIM-500 and AM-2k (Li et al., research use; `nobg/AIM-500`, `nobg/am2k-rgba` on Hugging Face), P3M-10k
  (Li et al., `nobg/P3M-10K`), DIS5K (Qin et al., research use, `nobg/DIS5K`), Oxford-IIIT Pet (CC BY-SA 4.0,
  robots.ox.ac.uk), COCO val2017 (annotations CC BY 4.0, images under their Flickr licences).
- Engines: the two model files the site ships, onnxruntime-node 1.31.1 with its WebGPU provider (BiRefNet 0.28 s a
  photo, ISNet 0.10 s). `scripts/quality/pipeline.cjs` is a copy of the page's pre- and post-processing; keep it in step
  with `src/engine.js` and `src/app.js`.
- Checked against the page: 20 photos through `npm run dev`, GPU engine and `?engine=cpu`. Page and harness masks
  overlap 0.94 to 0.9997 (median 0.995); mean pixel difference at most 0.006 (resizing differs between the browser
  and sharp).

Run it again (about 3 GB of downloads, 10 minutes):

    mkdir -p ~/goodbye-bg-quality/{harness,data,models} && cd ~/goodbye-bg-quality/harness && npm i onnxruntime-node sharp
    # models/isnet.onnx and models/birefnet.onnx: the parts in dist/m/ joined in order
    # data/: the downloads prepare.py names at the top of each block (needs pyarrow and pillow)
    python3 -I scripts/quality/prepare.py ~/goodbye-bg-quality
    node scripts/quality/run.cjs ~/goodbye-bg-quality          # scores and masks in out/
    node scripts/quality/summary.cjs ~/goodbye-bg-quality
    node scripts/quality/sheet.cjs ~/goodbye-bg-quality sheet.jpg <id> ...   # zoom.cjs for edge close-ups

## Not covered

- BiRefNet may have seen P3M and DIS5K in training (its author's general checkpoints use them, test splits included;
  the lite model's card names DIS). ISNet's training data is not published.
- Not phone camera rolls: median 1.7 MP, only 24 photos over 8 MP, mostly well-lit. A 12 MP photo stretches the
  1024 mask four times. No set of kids, few products, few cars shot on purpose, no low light.
- One grader (Claude), once. Not tested: the 👎 zoomed retry, GIFs, see-through inputs, a real iPhone.

## Follow-up experiments (2026-11-22)

Kevin said go on 1 and 2 below (3 needs thought). Each was measured on the same 1,073 photos before anything shipped.

| Change | Result | Decision |
|---|---|---|
| ISNet: harden the haze (wide half see-through areas at 0.3 or more become solid, the rest clear) | 102 photos better, 27 worse (IoU moved more than 0.02). Mean IoU on real masks 0.894 to 0.901, MAE 0.035 to 0.032, 0.95-or-better 571 to 587 of 923. Same on the CPU provider: 104 better, 29 worse. | Shipped (`hardenHaze` in app.js, ISNet only, `?haze=0` turns it off) |
| Second pass zoomed on the subject, merged like the 👎 retry, whenever the retry would zoom | Worse on both. BiRefNet: 15 better, 45 worse, edge error 0.060 to 0.062. ISNet: 77 better, 114 worse, 0.111 to 0.115. Zoomed in, the model changes its mind about what the subject is. | Rejected |
| The same, but the second pass only counts within 2% of the first mask's outline | Still worse. BiRefNet: 16 better, 38 worse, edge 0.062. ISNet: 61 better, 92 worse, edge 0.117. | Rejected |
| BiRefNet lite at a smaller input for phones | Not possible with the files we have: both exports are fixed at 1024 x 1024. Needs a new export from PyTorch. | Open |

What the haze fix looks like: a cow's dark body, a cat's back half, a hand, legs on a black background come back solid
instead of a ghost, with a rougher outline than a true edge. When the haze was background (a white blanket behind a
dog, a plate under a cake), that turns solid too; those are most of the 27. The eyeball grades above were made before
this change.

Why the second pass did not help here: the photos are about 1.7 MP, so the 1024 mask is already close to the photo's
own pixels. It may still help on 12 MP phone photos; these sets cannot show that.

The page's CPU engine and the harness agree less on hazy photos than on clean ones (masks overlap 0.91 to 0.96 against
0.997 and up), with or without the fix: ISNet's unsure areas shift with small differences in how the photo is resized.

## What would help most

1. Close the gap on phones: ISNet is three times as likely to give a bad cut-out. A BiRefNet-class model that fits an
   iPhone (needs a new export at a smaller input). The stopgap, hardening ISNet's haze, shipped 2026-11-22.
2. ~~A second pass zoomed on the subject for the edge.~~ Measured on 2026-11-22: worse. See above.
3. Tap a piece of the cut-out to drop it or bring it back: fixes BiRefNet's most common flaw (blanket, hands, the
   second car) without touching the model.
