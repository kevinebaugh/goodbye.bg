# BiRefNet lite on WebGPU vs ISNet (2026-11-21)

Chrome 156 (Claude desktop browser pane), M-series Mac, ONNX Runtime Web 1.31.1, both models fp16 at 1024x1024.
Ten test photos: hair (girl, kid with cat), close-ups over blur (cat, Larry), busy backdrops (bicycle on graffiti),
small subject in a dark yard, product shots (headphones, sneaker), girl with dog, tree.
The side-by-side sheets (photo | ISNet | BiRefNet) are not in the repo; the photos aren't ours to publish.

## Speed and memory

| | ISNet (GPU) | BiRefNet (GPU) |
|---|---|---|
| Per photo, warm | 86 ms | 280 to 300 ms |
| First run (shader compile) | ~0.1 s | 0.7 to 1.4 s |
| Session create | 0.4 s | 1.2 s |
| GPU process memory, peak over idle | +1.0 GB | +3.0 GB |
| Download | 88 MB | 93 MB |
| Four photos end to end in the app | 4.3 s | 3.9 s |

The app's own work (decode, despeckle, edge colors, previews) dominates end-to-end time; the model adds about
0.2 s a photo. BiRefNet on the CPU (onnxruntime-node, 64-bit): 9.9 s and 6.7 GB for one photo, so the CPU engine
stays ISNet.

## Quality (same photos, same 1024 input)

- Close-ups over a blurred background: ISNet keeps a blob of the blur (cat: orange glow around ear and whiskers;
  Larry: keeps the mug and the desk; kid with cat: keeps the sofa). BiRefNet cuts all three cleanly and keeps
  whiskers and ear tufts.
- Busy backdrop (bicycle on graffiti): ISNet keeps graffiti blobs inside the wheels; BiRefNet doesn't.
- See-through product (headphone case): ISNet leaves the case half transparent; BiRefNet solid.
- Small subject (cat in a dark yard): ISNet finds part of the cat; BiRefNet all of it.
- Tree: BiRefNet removes more of the sky between branches.
- Hair (girl, kid): about the same at 1024. Neither is a hair matting model.
- No photo where ISNet was clearly better.

## Correctness of the rewrite

`scripts/deform-to-gridsample.py` replaces the export's GatherND sampling with GridSample. Checked against the
unmodified model on the CPU, same input: mean difference 0.0005, max 0.21, 0.04% of pixels off by more than 0.1,
none across 0.5. The script asserts the export's base grid is "pixel + tap - centre" before rewriting each block.

## Recommendation

Use both: BiRefNet on computer GPUs, ISNet on the CPU (iPhones, iPads, fallback) and on phone/tablet GPUs.
The license stays AGPL because ISNet stays.
