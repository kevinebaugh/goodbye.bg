# BiRefNet lite 640 on phones (branch `phone-birefnet640`, 2026-11-22)

**Preview:** https://phone-birefnet640.goodbye-bg-git.pages.dev (branch only; main and production still run ISNet on the CPU).

What the branch changes: the CPU engine (every iPhone and iPad, and computers without a usable GPU) runs **BiRefNet lite
at 640x640** instead of ISNet. `?model=isnet` brings ISNet back on the same device. The GPU engine is unchanged
(BiRefNet 1024 on computers, ISNet on Android). Background and earlier numbers: `docs/platforms-and-phone-model.md`.
**A 👎 on a 640 result runs ISNet 1024 on the whole photo** (2026-11-22, below), so the photos where ISNet is better
(thin products) are one tap away.

## 👎 retries with ISNet (2026-11-22, morning)

`docs/quality-products.md` (on main) found 640 far better than ISNet on phone photos (IoU 0.950 against 0.851 at 8 MP and
up) but worse on thin products (DIS5K: 0.865 against 0.933, worse on 172 of 200). Now a 👎 on a `cpu-birefnet640` result
runs ISNet 1024 instead.

What the 👎 does:
- **Whole photo, not zoomed.** The zoomed retry crops to the 640 mask's box, and that box misses the legs and cables 640 lost.
  On the 198 DIS photos where ISNet beats 640, the zoomed ISNet retry (merged as `mergeRetry` does) scored 0.817, the
  whole-photo one 0.920. Whole-photo also wins on every other set (seller shots 0.957 against 0.937, UHRSD 0.962 against
  0.958). It goes through `mergeRetry` with the full frame, so the second 👎 still puts the 640 result back.
- **Also when the subject fills the frame.** Before, a 👎 there was a vote only (half the DIS photos). Now it always says
  "Bad result, try again" on a 640 result.
- **Everything else is unchanged.** The zoomed retry stays for the GPU engines and for `?model=isnet`, and a GIF's 👎 is
  still a vote only.
- **Votes.** The retry's vote says engine `cpu` (ISNet) with `retry: true`. The 👎 itself says `cpu-birefnet640`.

One engine at a time (`loadModel(want)` in app.js):
- The page asks for a model per photo: `""` is the engine's own model, `"isnet"` the retry's.
- A different model waits until the engine's jobs are done. Then the 640 worker is terminated and an ISNet worker
  starts (`engine-switch`, then `engine-start` with `want: isnet`).
- On iPhones the stop sets the same 3 s gap as the idle shutdown, so two engines never overlap.
- The worker is replaced, not swapped in place, because a wasm heap never shrinks. Terminating the worker is the path
  main's memory work measured.
- **A 👎 during a batch waits for the batch to finish.** Otherwise the engine would swap back and forth. On iPhones the
  idle shutdown then frees 640, and ISNet starts after the gap.
- **The next new photo runs on 640 again.** On iPhones ISNet goes at the idle shutdown. On computers using the CPU
  fallback, the next photo switches back to 640.
- **Cost:** the first 👎 downloads ISNet (88 MB) once, and the service worker then caches it. Offline before that, the
  retry fails quietly and the 640 result stays.

### What it scores (best case: a 👎 on every 640 result that ISNet beats)

`scripts/quality/retry-isnet.cjs` and the scores in `~/goodbye-bg-quality/products/out/`. "640, then ISNet" takes, per photo,
ISNet's whole-photo result where it is better, else the 640 one. This is what someone gets who taps 👎 exactly when it
helps and keeps the retry. IoU, then good / usable / bad / empty:

| Set | n | ISNet | BiRefNet 640 | **640, then ISNet on 👎** | 👎 would help on | vs ISNet better / worse |
|---|---|---|---|---|---|---|
| **Products, DIS5K (thin parts)** | 200 | 0.933 (91/95/14/0) | 0.865 (30/109/61/0) | **0.934 (91/95/14/0)** | 172 | 1 / 0 |
| Seller shots | 200 | 0.936 (152/22/26/0) | 0.901 (105/59/36/0) | **0.944 (160/19/21/0)** | 97 | 19 / 0 |
| 8 MP or more (UHRSD + HRSOD) | 224 | 0.851 (99/66/56/3) | 0.950 (160/53/10/1) | **0.955 (166/50/7/1)** | 16 | 104 / 0 |
| See-through (Trans10K) | 100 | 0.604 | 0.674 | **0.697** | 18 | 47 / 0 |

("👎 would help on" counts photos where ISNet is more than 0.02 IoU better than 640; "vs ISNet" compares the combined
result with ISNet alone, also at 0.02.)

- **With the 👎, the 640 branch is never worse than today's ISNet on any set**, and better on phone photos, see-through
  things and seller shots. Thin products end level with ISNet (0.934 vs 0.933), up from 0.865.
- That is the best case. Without a 👎, a thin product stays at 640's 0.865, and people only tap 👎 on a result that looks
  wrong. The thin-product failures are visible (a missing chair leg, a broken cable), though, which is when people tap.
- If someone keeps a retry that is worse (they tapped 👎 on a 640 result ISNet doesn't beat), a second 👎 brings the
  640 result back.

### Swap time and memory (headless Chrome 157, iPhone UA and touch, `?engine=cpu&threads=2`, M5 Pro, load average 7 to 9)

The same iPhone path as below: 5 photos, the idle shutdown, a 👎 on the first card `gap` after it, then the 18.75 MP
photo. Two runs each. "Cold" means ISNet was not yet in the browser cache (it comes from localhost here, so it shows no
download time: on a phone add the 88 MB download to the first 👎). "Warm" means it was fetched before the batch. The
warm runs' batch peaks include that fetched copy, which the page still held. Largest renderer RSS, MB:

| 👎 | 👎 to new result | of which | Peak during the 👎 | Peak, whole run |
|---|---|---|---|---|
| right at the shutdown (gap 0), cold | 7.2, 7.0 s | wait 3.0 s, ISNet session 0.3 to 0.4 s, run 3.5 s | 1848, 1869 | 1959, 2025 |
| right at the shutdown, warm | 7.8, 7.6 s | the same | 1872, 1940 | 1986, 2020 |
| after the shutdown (gap 4 s), cold | 4.6, 5.3 s | session 0.3 s, run 3.7 to 4.5 s | 1885, 1850 | 1966, 1966 |
| after the shutdown, warm | 4.4, 4.6 s | the same | 1934, 1858 | 2022, 1995 |
| during the batch (first card done, 4 to go) | 22, 23 s, mostly the batch | waits for the batch, then as gap 0 | 1892, 1866 | 1991, 1946 |
| **ISNet only (`?model=isnet`, today's main), gap 0** | 8.2, 6.9 s | zoomed ISNet retry | 1929, 1798 | 1929, 1851 |

- **Peak during the swap: 1850 to 1940 MB, level with ISNet's own 👎 (1798 to 1929) and under main's 2.0 GB.** It
  never holds two engines: the log always shows `engine-idle`, then `engine-wait` (about 3.0 s), then `engine-start want isnet`.
- The whole-run peaks (up to 2022 MB) come from the 18.75 MP photo on 640 or the warm runs' extra copy, not from the swap.
- ISNet's session starts in 0.3 to 0.4 s, faster than 640's (1.0 to 1.2 s). The 3 s wait is the main cost of a quick 👎.
- On a computer using the CPU fallback (engine kept, no idle shutdown), the smoke check shows the switch to ISNet and back
  to 640 for the next photo.
- Tests, rebased on main 979dc8a: `npm run test` 22/22 with the GPU and with the CPU as the main engine. The new check
  `cpu 👎`: the 👎 vote says `cpu-birefnet640`, the retry's 👍 says `cpu` with `retry: true`, and the next photo says
  `cpu-birefnet640`. `ONLY=<name>` runs single checks. One earlier run failed `output: Square...` on the GPU (timed out
  waiting for 2 photos) while the quality harness loaded the Mac; it passed in both reruns. `npm run test:x` 41/41,
  `offline.mjs` 13/13.

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
   better? (Research: 640 wins on people and pets; ISNet wins on thin products such as a tripod, a chair or a cable.)
4. **Required: a 👎 right after the batch finished** on a thin product (a chair, a tripod, a cable), ideally one where 640
   lost a leg. The engine has just shut down, and the 👎 starts ISNet up to 3 s later. The first time it also downloads
   ISNet (88 MB), so use Wi-Fi. Pass: ISNet's whole-photo result comes back in about 7 to 9 s, with no crash. A second 👎
   puts the 640 result back. This is the pattern that crashed iPhones before main's 3 s wait. Then add one more photo
   (the log should show `want` empty and `birefnet640` again), and a GIF (16 frames on iPhone).

### Reading the diag log

    ID=$(npx wrangler pages deployment list --project-name goodbye-bg-git --environment preview --json \
      | node -e 'console.log(JSON.parse(require("fs").readFileSync(0,"utf8")).find((d) => d.Branch === "phone-birefnet640").Id)')
    npx wrangler pages deployment tail $ID --project-name goodbye-bg-git --format json | grep diag

The first line finds the branch's newest deployment (every push makes a new one; the branch URL always serves the
newest). Start the tail before testing. Look for, per tab (`id` is the same within a tab):
- `worker:init` with `"model":"birefnet640"` (or `"isnet"` with `?model=isnet`), then `worker:session`, `ready` with engine `cpu-birefnet640` (`cpu` with `?model=isnet`).
- `inferred` with `ms` for each photo: the model's time on the phone.
- `engine-idle` after a batch (the engine let go of its memory), `engine-wait` (ms until 3 s after the shutdown) when a
  photo or 👎 comes sooner, then `engine-start` (`"want":"isnet"` for a 👎 on a 640 result, then `worker:init` with
  `"model":"isnet"`; `engine-switch` when the engine was still running).
- A crash shows up as the log simply stopping. The next visit sends a crash report; read it with the crash query in
  CLAUDE.md (engine `cpu-birefnet640`).

## What decides merging

Merge when, on Kevin's iPhone:
1. **No crash** on the 18.75 MP photo, on 8 + 2 photos in one tab, and on the 👎 after the idle shutdown (ISNet passes
   the first two today);
2. **6 s or less a photo** (ISNet: 5.0 s on 2 threads);
3. the cut-outs look **at least as good as ISNet** on his own photos, with empty masks on busy scenes rare. With the 👎
   retry, a thin product 640 gets wrong is one tap from ISNet's result. In the product test that makes the branch at
   least level with ISNet on every set (best case, above), so the quality trade-off is gone; what is left is the iPhone
   check (crashes and time).

If it crashes where ISNet doesn't, don't merge; the fallback idea is ormbg (ISNet's architecture and memory,
Apache-2.0) or BiRefNet at 512 (745 MB heap, weaker on thin objects). If it is slower than 6 s but stable, 512 is
the next try. On merge: update CLAUDE.md's Engines section (CPU engine = BiRefNet 640, the engine names in
"Votes and crash reports", the measured numbers; the UX note "👎 zooms in only when..." gains "a 640 result's 👎
always runs ISNet on the whole photo"), and watch 👎 on `cpu-birefnet640` against 👍 on its `cpu` retries, and crash reports by engine for a week. ISNet still runs on
Android's GPU, so the AGPL reason stays unless that changes too.
