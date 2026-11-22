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
- `src/app.js`: the page sends `?model=` as typed, or for the GPU worker the GPU gate's pick (`isnet` after BiRefNet
  stepped down), plus whether it is a computer; the worker picks. Votes and crash reports name the engine
  `cpu-birefnet640` (`/api/rate` and `/api/crash` accept it), also when a computer's GPU fails and the CPU takes over
  (tested with `?gpufail=init`). The haze hardening (`hardenHaze`) now runs on ISNet masks only, as for BiRefNet 1024:
  it was tuned on ISNet's half see-through areas (before the rebase the 640 masks went through it too).
- Rebased on main at 56a36b5 (2026-11-22, night; measured on ad780d3, the later main commits are UI only, and a
  640 run on 56a36b5 peaked at 1930 / 1885 / 1941 MB), so the 640 model gets main's iPhone memory fixes for free: model and
  runtime parts read into one buffer of the final size, and after the iPhone idle shutdown a new engine starts no
  sooner than 3 s later (dbg step `engine-wait`). Also: download on intent (unchanged, the model is fetched by the
  same code), the offline cache (`sw.js` list holds `/m/birefnet640-9348c64d/`, cache `gb-m-birefnet640-9348c64d`),
  and the GPU gate.
- Rebased again on main at 1b35e6c (2026-11-22, early morning: card bar, picker pages and dock, accessibility, grid
  sizing, failed-file handling, README). No conflicts; main's memory fixes (single-buffer `fetchParts`, `engine-wait`),
  the offline cache list and the GPU-gate step names are unchanged. Tests on that tree: `npm run test` 21/21 (the CPU
  check names `cpu-birefnet640`), `npm run test:x` 41/41 (Firefox's first photo timed out once with other test runs
  loading the Mac and passed 13/13 on a rerun; it runs the 640 model on the CPU), `offline.mjs` 13/13.
- Cost on computers: when ISNet on the GPU fails, the CPU engine now downloads its own 95 MB model; before, it reused
  ISNet's files. Rare (a GPU that fails ISNet), and only once thanks to the cache.

## Measured on the Mac after the rebase (headless Chrome 157, iPhone user agent and touch, `?engine=cpu&threads=2`, M5 Pro)

Load average 4 to 8. The iPhone path, as in the iPhone memory work on main: 5 photos in one batch (portrait, two cats, flower,
person from AIM/AM-2k/P3M/pets/COCO), the engine shuts down when idle, a 👎 on the first card `gap` after the shutdown
(the engine restarts), then a new 18.75 MP photo (5000x3750) after the next shutdown. Largest Chrome renderer RSS
(page plus engine worker) per phase, from `ps` every 100 ms. Runs alternated 640 / ISNet, two of each per gap.

| Renderer RSS peak, MB | batch | 👎 after the shutdown | new 18.75 MP photo |
|---|---|---|---|
| BiRefNet 640, gap 0 | 1911, 2012 | 1899, 1974 | 1936, 1895 |
| ISNet, gap 0 | 1889, 1902 | 1843, 1891 | 1896, 1935 |
| BiRefNet 640, gap 1.5 s | 1909, 1846 | 1938, 1889 | 1934, 1916 |
| ISNet, gap 1.5 s | 1810, 1871 | 1826, 1897 | 1905, 1919 |
| ISNet on main before the rebase (iphone-memory hand-over, gap 0 / 1.5 s) | 2073 / 2000 | 2008 / 1991 | 2023 / 1970 |

- **Peaks: all under about 2.0 GB, none above main's ISNet.** 640 sits about 50 MB above ISNet in the same build in the
  batch and 👎 phases (means 1920 vs 1868 and 1925 vs 1864), level on the big photo (1920 vs 1914). The paired runs
  overlap, but the small lead is consistent with the Node wasm heap (+13%), so read it as "slightly more", not noise.
- **The old 2.5 to 2.8 GB 👎 peak is gone for both models**: it came from starting the new engine before the old one's
  memory was back, which main's 3 s wait now prevents (`engine-wait` about 3.0 s at gap 0, then `engine-start`).
- **Time per photo** (the model's `inferred` ms, 2 threads): 640 2.9 to 3.2 s in the batch, 3.1 to 3.5 s for the 👎 and
  the big photo; ISNet 3.2 to 4.1 s. A 👎 at gap 0 takes 7.5 s in all (3 s of it the wait), at 1.5 s about 6.3 s.
- **Masks** (computer UA, `?engine=cpu&threads=2`, cut-outs exported and looked at): all five clean with 640: the
  flower with its stem, the cat on the wall (no plants left), the man by the toilet (gloves kept, toilet gone), the
  portrait's hair, the Abyssinian with whiskers. The 18.75 MP cat cut out on every run.
- **Fallback name:** `?gpufail=init` on a computer: the photo finishes on the CPU and the vote says `cpu-birefnet640`.
- `npm run test` 20/20, `npm run test:x` 41/41 (WebKit iPhone and Firefox report `cpu-birefnet640`),
  `node scripts/test/offline.mjs` 13/13 (the worker keeps `gb-m-birefnet640-9348c64d`, 6 files; offline CPU photo works).

Before the rebase (2026-11-22, evening, loaded Mac): 640 4.85 s vs ISNet 5.0 s a photo on 2 threads (computer UA);
renderer RSS +3%; the 👎 right after the idle shutdown peaked at 2.5 to 2.8 GB for both models (the restart overlap,
fixed on main since).

## Kevin's 2-minute test on the iPhone

Use Safari, a fresh tab. Each step's URL carries `?debug=1` so every step lands in the Functions log.

1. **One big photo.** Open `https://phone-birefnet640.goodbye-bg-git.pages.dev/?debug=1`, pick the 18.75 MP photo
   that used to crash. Pass: it cuts out, no "A problem repeatedly occurred". Note the time it feels like (ISNet: about 5 s).
2. **7 to 8 photos in one tab** (the case that once crashed Safari): pick 8 camera-roll photos at once, include a
   couple of busy scenes with a small subject (a cat in a yard, a car interior). Then add 2 more. Pass: no reload or
   crash, each photo about 6 s or less. An empty card ("no subject") on a busy scene is a known weak spot; note how many.
3. **Compare with ISNet.** Open `.../?debug=1&model=isnet` in a new tab and pick the same 8 photos. Which cut-outs look
   better? (Research: 640 wins on people, pets, products; ISNet wins on thin wire frames like a bike stand.)
4. **Required: a 👎 right after the batch finished** (the engine has just shut down; the 👎 starts a new one, up to 3 s
   later) on a photo whose subject doesn't fill the frame. Pass: the zoomed retry comes back, no crash. This is the
   pattern that crashed iPhones before main's 3 s wait. Then a GIF (16 frames on iPhone).

### Reading the diag log

    ID=$(npx wrangler pages deployment list --project-name goodbye-bg-git --environment preview --json \
      | node -e 'console.log(JSON.parse(require("fs").readFileSync(0,"utf8")).find((d) => d.Branch === "phone-birefnet640").Id)')
    npx wrangler pages deployment tail $ID --project-name goodbye-bg-git --format json | grep diag

The first line finds the branch's newest deployment (every push makes a new one; the branch URL always serves the
newest). Start the tail before testing. Look for, per tab (`id` is the same within a tab):
- `worker:init` with `"model":"birefnet640"` (or `"isnet"` with `?model=isnet`), then `worker:session`, `ready` with engine `cpu-birefnet640` (`cpu` with `?model=isnet`).
- `inferred` with `ms` for each photo: the model's time on the phone.
- `engine-idle` after a batch (the engine let go of its memory), `engine-wait` (ms until 3 s after the shutdown) when a
  photo or 👎 comes sooner, then `engine-start`.
- A crash shows up as the log simply stopping. The next visit sends a crash report; read it with the crash query in
  CLAUDE.md (engine `cpu-birefnet640`).

## What decides merging

Merge when, on Kevin's iPhone:
1. **No crash** on the 18.75 MP photo, on 8 + 2 photos in one tab, and on the 👎 after the idle shutdown (ISNet passes
   the first two today);
2. **6 s or less a photo** (ISNet: 5.0 s on 2 threads);
3. the cut-outs look **at least as good as ISNet** on his own photos, with empty masks on busy scenes rare.

If it crashes where ISNet doesn't, don't merge; the fallback idea is ormbg (ISNet's architecture and memory,
Apache-2.0) or BiRefNet at 512 (745 MB heap, weaker on thin objects). If it is slower than 6 s but stable, 512 is
the next try. On merge: update CLAUDE.md's Engines section (CPU engine = BiRefNet 640, the engine names in
"Votes and crash reports", the measured numbers), and watch crash reports by engine for a week. ISNet still runs on
Android's GPU, so the AGPL reason stays unless that changes too.
