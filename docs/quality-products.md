# Quality on products and phone-size photos (2026-11-22)

`docs/quality-1000.md` left out phone-size photos (its median was 1.7 MP) and products. This run covers 800 more photos:
real high-resolution photos, the things people sell, see-through things, and 200 seller shots made for this test.
Four engines, the same way the page runs them: BiRefNet 1024 (computers), ISNet 1024 on the CPU provider with the haze fix
(today's phones), BiRefNet lite 640 (the phone candidate on `phone-birefnet640`), and the `?pp=1` edge filter (`refineEdge`
on `mask-postprocess`) on BiRefNet 1024 and 640. No app code changed.
Contact sheets show dataset photos, so they stay in `~/goodbye-bg-quality/products/sheets/`, not in the repo.

## Verdict

- **Phone-size photos (224 at 8 to 24 MP):** BiRefNet 640 is far better than ISNet: IoU 0.950 against 0.851, 10 bad
  against 56. BiRefNet 1024 scores 0.971. By eye, at a 2000 px view the 1024 or 640 mask, scaled up to a 12 MP photo, shows no
  stair-steps. A big photo doesn't hurt any engine. ISNet's failures here are the same ones as on small photos: it picks
  the whole scene, or it finds nothing (3 empty masks).
- **Products with thin parts (200 from DIS5K: chairs, tripods, cables, ladders, stands): BiRefNet 640 is clearly worse.**
  IoU 0.865 against ISNet's 0.933. It is worse than ISNet on 172 photos and better on 1. Legs, wires and frames get
  thinner or drop out. This matches what DIS TE1 showed before (0.859 against 0.921). BiRefNet 1024 is level with
  ISNet (0.926 against 0.933), even though it has probably trained on these photos.
- **Seller shots (product on white, drop shadow, floor shadow; 150):** all three are good. IoU: BiRefNet 0.971,
  ISNet 0.965, 640 0.947. Shadows are not a problem: a cut-out keeps 0.4 to 4% of the shadow on average, and only 2 to 4
  of 100 keep more than a fifth of it.
- **Reflections are the seller failure.** With a mirror reflection under the product, BiRefNet keeps 72% of it on average
  (38 of 50 keep over a fifth), 640 keeps 62%, ISNet 48%. All three treat the reflection as part of the product.
- **See-through things (Trans10K, 100):** the glass is kept, but as a solid shape with the old background showing through
  it. No engine makes it see-through. The IoU (0.60 to 0.67) mostly reflects the truth marking only the glass while the
  photos also show boxes and packets the models rightly keep.
- **`?pp=1`:** on these photos it does almost nothing. It changes about 0.1% of the pixels of a BiRefNet mask (0.2 to
  0.6% on 640). Mean scores are the same to three decimals: 0 photos better, 0 worse on IoU, edge error worse on 5 of 800
  and better on none. White products on white and crisp product edges are left alone, as intended. It neither helps nor
  harms products.

## Results

Good: IoU 0.95 or more. Usable: 0.85 to 0.95. Bad: under 0.85. Empty: under 0.2% of the photo kept. Boundary IoU and edge
error as in `docs/quality-1000.md`. Masks are scored at the photo's size, at most 2048 px on a side.

| Set | n | Engine | IoU | Boundary IoU | Edge error | Good / usable / bad / empty |
|---|---|---|---|---|---|---|
| **8 MP or more (UHRSD + HRSOD)** | 224 | BiRefNet 1024 | 0.971 | 0.915 | 0.058 | 197 / 25 / 1 / 1 |
| | | ISNet | 0.851 | 0.740 | 0.117 | 99 / 66 / 56 / 3 |
| | | BiRefNet 640 | 0.950 | 0.867 | 0.086 | 160 / 53 / 10 / 1 |
| UHRSD (median 15.9 MP) | 150 | BiRefNet 1024 | 0.972 | 0.919 | 0.054 | 134 / 15 / 1 / 0 |
| | | ISNet | 0.866 | 0.757 | 0.110 | 69 / 43 / 37 / 1 |
| | | BiRefNet 640 | 0.953 | 0.873 | 0.081 | 111 / 32 / 7 / 0 |
| HRSOD (median 8.0 MP) | 150 | BiRefNet 1024 | 0.964 | 0.905 | 0.068 | 121 / 27 / 1 / 1 |
| | | ISNet | 0.811 | 0.693 | 0.142 | 53 / 44 / 51 / 2 |
| | | BiRefNet 640 | 0.934 | 0.848 | 0.102 | 98 / 39 / 12 / 1 |
| **Products, DIS5K TE2+TE3 (median 10 MP)** | 200 | BiRefNet 1024 | 0.926 | 0.889 | 0.061 | 80 / 105 / 15 / 0 |
| | | ISNet | 0.933 | 0.902 | 0.056 | 91 / 95 / 14 / 0 |
| | | BiRefNet 640 | 0.865 | 0.804 | 0.108 | 30 / 109 / 61 / 0 |
| **Seller shots (made here, 8 MP)** | 200 | BiRefNet 1024 | 0.916 | 0.885 | 0.037 | 145 / 16 / 39 / 0 |
| | | ISNet | 0.936 | 0.894 | 0.042 | 152 / 22 / 26 / 0 |
| | | BiRefNet 640 | 0.901 | 0.851 | 0.069 | 105 / 59 / 36 / 0 |
| See-through, Trans10K (1.1 MP) | 100 | BiRefNet 1024 | 0.652 | 0.465 | 0.197 | 13 / 10 / 77 / 0 |
| | | ISNet | 0.604 | 0.401 | 0.243 | 6 / 12 / 82 / 0 |
| | | BiRefNet 640 | 0.674 | 0.470 | 0.221 | 10 / 16 / 72 / 2 |

Better / worse on the same photo (IoU more than 0.02 apart):

| Set | 640 vs ISNet | 640 vs 1024 | 1024 vs ISNet |
|---|---|---|---|
| 8 MP or more | 104 / 16 | 1 / 51 | 116 / 0 |
| Products (DIS) | **1 / 172** | 0 / 166 | 10 / 25 |
| Seller shots | 19 / 97 | 11 / 83 | 25 / 25 |
| See-through | 47 / 18 | 34 / 13 | 43 / 25 |

DIS products by kind (IoU ISNet / 1024 / 640, kinds with 6 or more): tripods 0.890 / 0.865 / 0.724, chairs 0.914 / 0.903 /
0.815, ladders 0.882 / 0.883 / 0.785, cables 0.932 / 0.918 / 0.838, stands 0.950 / 0.946 / 0.880, table and chairs
0.948 / 0.942 / 0.892, gym equipment 0.965 / 0.958 / 0.908, harps 0.956 / 0.942 / 0.902. 640 loses on every kind, and
loses most where the product is legs and wires.

### Seller failures, one by one

| Failure | n | BiRefNet 1024 | ISNet | BiRefNet 640 |
|---|---|---|---|---|
| Soft drop shadow kept (mean share of the shadow; photos keeping over 20%) | 50 | 2.9%; 2 | 3.7%; 3 | 4.1%; 2 |
| Floor contact and cast shadow kept | 50 | 0.4%; 0 | 1.0%; 1 | 0.9%; 1 |
| Mirror reflection kept | 50 | **72%; 38** | 48%; 26 | 62%; 34 |
| Plain white, IoU (bad) | 50 | 0.966 (2) | 0.959 (3) | 0.939 (3) |
| White products on white | 7 | too few to say: IoU 0.90 / 0.98 / 0.90, every one found | | |
| See-through: glass kept 90% or more | 100 | 69 | 68 | 84 |
| Thin parts | see the DIS rows | level with ISNet | best | clearly worse |

By eye (worst 10 of each on the sheets):
- **Reflections:** the cut-out carries a faded copy of the product hanging off its bottom (pencil, mascara, helmet,
  carabiner). This is what a seller who shoots on acrylic or glass will hit. ISNet drops the reflection completely more
  often (mascara, pencil, helmet: IoU 0.97 to 0.98 where BiRefNet has 0.60 to 0.67), but still keeps it on 26 of 50.
- **Mesh and gaps:** the rest of the worst seller shots are fan grilles, comb teeth, racket strings and chains. BiRefNet
  opens the gaps (racket strings come out as a net). ISNet fills a racket head solid white. Both lose some comb teeth.
  For a listing photo, either looks acceptable at thumbnail size. The IoU punishes ISNet's fill.
- **640 on products:** the same product, with tripod legs, chair legs and cables noticeably thinner. Sometimes a piece is
  missing: one of five rocking chairs, the frame of a punching-bag stand. On the plain seller shots the difference is
  small by eye.
- **Phone-size photos, ISNet:** keeps the whole scene (the aircraft behind the deck crew, the anemone around the clownfish,
  the grass around a moth), or finds nothing (a skier in snow, a bird on a tree trunk). 640 and 1024 pick the subject the truth
  wants, but the truth here is what BiRefNet trained on (see below).
- **Phone-size photos, 640's worst:** groups. It keeps one boxer of three people, one camper of two, the girl but also
  the singer behind her. This is the same "which subject" choice that `docs/platforms-and-phone-model.md` saw on COCO.

### `?pp=1` (BiRefNet, and 640 for reference)

| Set | Pixels changed (BiRefNet / 640) | IoU better / worse | Boundary IoU better / worse | Edge error better / worse |
|---|---|---|---|---|
| All 800, BiRefNet 1024 | 0.10% | 0 / 0 | 0 / 2 | 0 / 5 |
| All 800, BiRefNet 640 | 0.36% | 1 / 0 | 3 / 1 | 0 / 21 |

The truths here are hard 0/1 masks. Any softening of an edge counts against the edge error, so "worse" here is a bias of
the test, not something seen by eye. On the 923 photos with soft truths (hair, fur), the filter was clearly better
(`docs/mask-postprocess.md`). The good/usable/bad counts move by 1 or 2 photos. Seller shots: unchanged (one photo
moves from usable to good on each engine).

## What it means for the two decisions

**Merge `phone-birefnet640`?** Not for everything as it stands. It is a trade:
- Better on people, pets and real phone photos. Here: +0.10 IoU over ISNet at 8 MP and up, 46 fewer bad. Before: +0.054 on
  923 photos.
- Worse on products with thin parts (−0.07 IoU, worse on 172 of 200).
- Slightly worse on plain seller shots (0.947 against 0.965).

Typical phone photos are people, kids and pets first, so 640 still wins on the photos the site mostly sees. Sellers on
iPhones would lose.

Options, cheapest first:
1. Merge, and accept the loss on thin products. Say so in the doc and watch 👎 by engine.
2. Merge, and make 👎 on a 640 result retry with ISNet instead of the zoomed retry. That costs a second model download
   (88 MB) the first time.
3. Wait for a better phone export. 768 was ruled out on memory; none is measured yet.

The iPhone test for the branch should include a few thin products (a tripod, a chair, a cable).

**Merge `?pp=1`?** No product regression found. On products and phone photos it changes almost nothing and harms nothing.
White on white and crisp edges stay as they were. The case for it rests on the hair, fur and plant gains in
`docs/mask-postprocess.md`. This run removes the worry that it would hurt sellers.

Separate from both: **reflections** are the one seller failure all engines share, and the most common way a cut-out
here goes wrong (38 of 50 on BiRefNet). It is worth a fix of its own, for example a tap to drop a piece, or cutting below
the product's base line.

## Sets and licences

All downloaded without an account from Hugging Face mirrors. Kept in `~/goodbye-bg-quality/products/data/`, never in the repo,
used only to measure.

| Set | Mirror | Licence the authors give | Used |
|---|---|---|---|
| UHRSD test (Xie et al., CVPR 2022, PGNet) | `nobg/UHRSD`, 2 of 10 test shards | CC BY-NC 4.0 (research, non-commercial) | 150 at random from 198 |
| HRSOD test (Zeng et al., ICCV 2019) | `nobg/HRSOD` | CC BY-NC 4.0 | 150 at random from 400 |
| DIS5K TE2 + TE3 (Qin et al., ECCV 2022) | `nobg/DIS5K` | DIS5K Terms of Use: non-commercial research or education, no redistribution (PDF in the data folder) | 200 at random from the product kinds (Kitchenware, Accessories, Electronics, Electrical, Furniture, Tool, Sports, Music Instrument, Entertainment; poles, lamps, playgrounds and the like left out) |
| ThinObject-5K test (Liew et al., AAAI 2021) | `nobg/ThinObject-5K` | CC BY-NC 4.0 | the product cut-outs, for the seller shots |
| Trans10K-v2 validation (Xie et al., ECCV 2020) | `rdyzakya/Trans10K-v2` | Apache-2.0 per the mirror (from the Trans2Seg repo) | 100 with one kind of see-through thing (cup, bottle, jar, bowl, glasses, box), no windows or walls, filling 8 to 80% |

These terms allow research use. The site runs ads. This was a measurement only, and nothing from these sets ships or
trains anything. Kevin should know the licences are non-commercial before he quotes any of these numbers in public
marketing.

**Seller shots, made here:** 200 product cut-outs from ThinObject-5K test (hairbrushes, padlocks, chairs, helmets,
jewellery, tools; objects from PNG cut-out sites with exact masks). Each is placed on a square seller canvas, filling 72%,
with a long side of 2400 to 3600 px. The looks rotate: plain white, white with a soft drop shadow, a light grey sweep with
a contact and cast shadow, white with a fading mirror reflection. The truth is the product. A second mask marks the shadow
or reflection, to count how much of it a cut-out keeps. Real seller photos have real lighting. These test the background,
not the lighting. ThinObject's own photos were not used: they are the same cut-outs pasted onto unrelated scenes, where the
"right" subject is often not the obvious one (an umbrella next to a cow).

**Not tested:** kids (no public set with labels found), real (not composited) seller photos with ground truth (none found
that is free), white products on white (7 photos, too few).

## Trust

- **BiRefNet probably trained on UHRSD, HRSOD and DIS5K test sets.** Its README lists "DIS-TEs, HRSOD-TR_TE, UHRSD-TR_TE" for the
  general checkpoints, the lite one included. The 640 model is the same weights. On those sets, BiRefNet's lead over ISNet
  is an upper bound. On the phone-size photos, by eye, ISNet's subject is often defensible and the truth simply agrees with
  BiRefNet. The products result goes against BiRefNet despite this, which makes it the more solid finding. The seller shots and
  the ThinObject cut-outs in them are not in BiRefNet's list. ISNet's training data is not published.
- Truth masks here are binary. Edge error is not comparable with the alpha-matte sets in `docs/quality-1000.md`.
- Scored at no more than 2048 px. The phone-size check by eye was at a 2000 px view, not at 100% of a 16 MP photo.
- One grader (Claude), once. Same harness as before: `rawdump.cjs` and `ppcands.cjs` from `mask-postprocess`, byte-identical.
  The 640 run uses `plat/c640h.onnx` (fp16), the file that matched the page.

## Reproduce

    # downloads: see the table above, into ~/goodbye-bg-quality/products/data/{uhrsd,hrsod,dis,thin5k,trans10k}/
    python3 -I scripts/quality/prepare-products.py ~/goodbye-bg-quality/products      # 800 photos + manifest (11 min)
    ln -s ../harness ~/goodbye-bg-quality/products/harness
    EP=webgpu node scripts/quality/rawdump.cjs <work> birefnet ../models/birefnet.onnx birefnet
    EP=cpu    node scripts/quality/rawdump.cjs <work> isnet ../models/isnet.onnx isnet
    EP=cpu    node scripts/quality/rawdump.cjs <work> bir640 ../plat/c640h.onnx birefnet 640
    node scripts/quality/finals.cjs <work> birefnet birefnet          # and isnet isnet, bir640 birefnet; PP=1 for ?pp=1
    node scripts/quality/report-products.cjs <work>                   # the tables above
    MODELS=isnet,birefnet,bir640 node scripts/quality/sheet.cjs <work> sheet.jpg <id> ...
