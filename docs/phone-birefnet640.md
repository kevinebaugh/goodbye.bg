# BiRefNet lite 640 on phones (branch `phone-birefnet640`, 2026-11-22)

**Preview:** https://phone-birefnet640.goodbye-bg-git.pages.dev (branch only; main and production still run ISNet on the CPU).

What the branch changes: the CPU engine (every iPhone and iPad, and computers without a usable GPU) runs **BiRefNet lite
at 640x640** instead of ISNet. `?model=isnet` brings ISNet back on the same device. The GPU engine is unchanged
(BiRefNet 1024 on computers, ISNet on Android). Background and earlier numbers: `docs/platforms-and-phone-model.md`.

## How it works

- Model: `weights/birefnet640/` (95.2 MB fp16, 5 parts, sha256 `9348c64d...`), made by `scripts/birefnet640.sh`
  (`scripts/birefnet-lowres.py` at 640). The export already writes the deformable convs as chunked GridSample, and
  `scripts/narrow-onnx.py` finds nothing to rewrite in it (0 Concat, 0 Split), so neither runs; it would run on WebGPU
  as is too, untested. The build copies it to `m/birefnet640-<hash>/` with the MIT notice.
- `src/engine.js`: each model has its own input size. The page still sends 1024x1024 RGBA and gets a 1024x1024 mask
  back. For the 640 model the worker area-averages the pixels down to 640, applies the ImageNet mean/std, runs it
  (first output only, logits, sigmoid), and scales the mask back up to 1024 (bilinear). So the despeckle, crop box,
  edge colours, the 👎 zoomed retry (2048 merge) and GIF frames are untouched. The model bytes are still freed after
  the session starts.
- `src/app.js`: the page now sends `?model=` as typed (or nothing) plus whether it is a computer; the worker picks.
  Votes and crash reports name the engine `cpu-birefnet640` (`/api/rate` and `/api/crash` accept it). The iPhone idle
  shutdown and the CPU engine's lack of warm-up are unchanged (the GPU warm-up probe uses the model's size).

## Measured on the Mac (headless Chrome 157, `?engine=cpu&threads=2`, M5 Pro)

The Mac was busy with another session's harness (load average 11 to 30), so times are noisy; runs alternated
ISNet / 640. Five photos (portrait, two cats, flower, person from AIM/AM-2k/P3M/pets/COCO), in one batch per run.

| | ISNet 1024 | BiRefNet lite 640 |
|---|---|---|
| Time per photo, 2 threads (browser, includes the resize) | 4.7 to 5.7 s, mean 5.0 s (10 photos) | 4.5 to 5.4 s, mean 4.85 s (15 photos) |
| 18.75 MP photo (5000x3750) | 6.2 s | 5.5 s |
| Chrome renderer RSS peak (page + engine worker), 5 photos | 1934, 1985 MB | 2017, 2067, 2016 MB (about +60 MB, +3%) |
| Renderer RSS peak, the 18.75 MP photo | 1826 MB | 1894 MB |
| Wasm heap peak (Node, ORT Web 1.31.1, 2 threads, one run) | 918 to 920 MB, steady | 908 to 1048 MB, usually about 1040 (+13%) |

- **Memory is close but not equal.** The research doc's "913 MB, 1.0x" was a low reading: repeated runs of both the
  research file and this export land at 1031 to 1048 MB most of the time. The renderer RSS (what Safari's limit is
  about) is about 3% higher. So the iPhone test below decides it, not this table.
  (`performance.measureUserAgentSpecificMemory` never returned in headless Chrome within 45 s, so RSS is from `ps`.)
- **Masks:** all five photos cut out cleanly (hair, whiskers, the flower's stem); the 18.75 MP cat too.
- **👎 zoomed retry:** works on both models (one extra run, merged result shown).
- **GIF:** 8 frames, 4.6 to 5.1 s each, comes back animated (`gif-done`, 8 frames).
- **iPhone path** (Chrome with an iPhone user agent and touch): picks `birefnet640` with 2 threads, the engine shuts
  down when idle (`engine-idle`) and a 👎 starts it again from the cached model. Not a real iPhone: Safari's memory
  limit is what matters.
- `npm run test` passes on the branch (16 of 16; the CPU check reports `cpu-birefnet640`).

## Kevin's 2-minute test on the iPhone

Use Safari, a fresh tab. Each step's URL carries `?debug=1` so every step lands in the Functions log.

1. **One big photo.** Open `https://phone-birefnet640.goodbye-bg-git.pages.dev/?debug=1`, pick the 18.75 MP photo
   that used to crash. Pass: it cuts out, no "A problem repeatedly occurred". Note the time it feels like (ISNet: about 5 s).
2. **7 to 8 photos in one tab** (the case that once crashed Safari): pick 8 camera-roll photos at once, include a
   couple of busy scenes with a small subject (a cat in a yard, a car interior). Then add 2 more. Pass: no reload or
   crash, each photo about 6 s or less. An empty card ("no subject") on a busy scene is a known weak spot; note how many.
3. **Compare with ISNet.** Open `.../?debug=1&model=isnet` in a new tab and pick the same 8 photos. Which cut-outs look
   better? (Research: 640 wins on people, pets, products; ISNet wins on thin wire frames like a bike stand.)
4. Optional: a GIF (16 frames on iPhone) and one 👎 on a photo that doesn't fill the frame.

### Reading the diag log

    npx wrangler pages deployment list --project-name goodbye-bg-git | grep phone-birefnet640   # newest ID on the branch
    npx wrangler pages deployment tail <id> --project-name goodbye-bg-git --format json | grep diag

Start the tail before testing. Look for, per tab (`id` is the same within a tab):
- `worker:init` with `"model":"birefnet640"` (or `"isnet"` with `?model=isnet`), then `worker:session`, `ready` with engine `cpu`.
- `inferred` with `ms` for each photo: the model's time on the phone.
- `engine-idle` after a batch (the engine let go of its memory), `engine-start` when the next photo arrives.
- A crash shows up as the log simply stopping. The next visit sends a crash report; read it with the crash query in
  CLAUDE.md (engine `cpu-birefnet640`).

## What decides merging

Merge when, on Kevin's iPhone:
1. **No crash** on the 18.75 MP photo and on 8 + 2 photos in one tab (ISNet passes both today);
2. **6 s or less a photo** (ISNet: 5.0 s on 2 threads);
3. the cut-outs look **at least as good as ISNet** on his own photos, with empty masks on busy scenes rare.

If it crashes where ISNet doesn't, don't merge; the fallback idea is ormbg (ISNet's architecture and memory,
Apache-2.0) or BiRefNet at 512 (745 MB heap, weaker on thin objects). If it is slower than 6 s but stable, 512 is
the next try. On merge: update CLAUDE.md's Engines section (CPU engine = BiRefNet 640, the engine names in
"Votes and crash reports", the measured numbers), and watch crash reports by engine for a week. ISNet still runs on
Android's GPU, so the AGPL reason stays unless that changes too.
