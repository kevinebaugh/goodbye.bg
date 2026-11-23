# Platforms and a better phone model (2026-11-22)

Research only; no app code changed. Measured on the M5 Pro Mac in Node (ONNX Runtime Web 1.31.1, the site's runtime, wasm,
2 threads) and with the quality harness from `docs/quality-1000.md`. No iPhone or Simulator was used.

## Decisions, ranked

1. **Phones: try BiRefNet lite at 640x640 on the CPU engine.** It needs the same wasm memory as ISNet, takes about 10%
   longer, and on 923 photos with real masks scores IoU 0.948 against ISNet's 0.894, with 78 bad cut-outs instead of 177.
   Its weaknesses: thin wire-frame objects (DIS set 0.859 against ISNet's 0.921), and more empty masks on busy scenes
   with small subjects (12 against 5 of 150 COCO photos). Test plan below.
2. **Mac Safari: still untested.** My run stalled because the display was asleep. Research says it should work
   (shader-f16, 44 storage buffers a shader, buffers up to about 2 GB). A 2-minute check for Kevin is below.
3. **Weak GPUs: gate at runtime, not on adapter limits.** Limits can't tell weak GPUs apart, and both models fit the
   WebGPU defaults. Proposed: if BiRefNet's GPU start fails or is slow, fall back to ISNet on the GPU, not straight to
   the CPU. Also send computers that report `navigator.deviceMemory` under 8 to ISNet.
4. **Automatic zoomed second pass: probably not worth it.** Preliminary numbers from another session's run, still in
   progress, make edges slightly worse; that session's result is the final word. On phones it doubles the time. A
   bigger model input does more for edges.

## 1. A better model for phones

### Measured: BiRefNet lite at smaller inputs vs ISNet

Wasm heap peak and time per photo: ONNX Runtime Web 1.31.1 in Node, wasm, 2 threads (the iPhone setting), fp16 models,
one photo, the first output only. Quality: the harness on the same 923 photos as `docs/quality-1000.md` (no COCO). The
mask is scaled to 1024, then goes through the page's despeckle and edge curve. Auto grade: good is IoU 0.95 or more,
bad is under 0.85.

| | ISNet 1024 (today) | BiRefNet lite 512 | **BiRefNet lite 640** | BiRefNet lite 768 | BiRefNet lite 1024 (computers) |
|---|---|---|---|---|---|
| Wasm heap peak | 918 MB | 745 MB (0.81x) | **913 MB (1.0x)** | 1383 MB (1.5x) | 2046 MB (2.2x) |
| Time, 2 threads, Mac | 3.7 s | 2.4 s | **4.0 s** | 6.1 s | 8.9 s |
| iPhone estimate (x1.35, from ISNet's 5.0 s) | 5.0 s | 3.3 s | **5.4 s** | 8 s | 12 s |
| Download (fp16) | 88 MB | 96 MB | **96 MB** | 96 MB | 93 MB |
| Mean IoU | 0.894 | 0.934 | **0.948** | not run (ruled out on memory) | 0.960 |
| Boundary IoU / edge error | 0.773 / 0.111 | 0.842 / 0.084 | **0.866 / 0.075** | | 0.904 / 0.060 |
| Good / usable / bad / no subject | 571 / 173 / 177 / 2 | 738 / 100 / 78 / 7 | **756 / 89 / 78 / 0** | | 798 / 74 / 51 / 0 |
| Better / worse than ISNet (IoU > 0.02) | | 299 / 96 | **314 / 77** | | 357 / 20 |
| Portraits (P3M) / animals (AM-2k) / pets | 0.935 / 0.913 / 0.889 | 0.986 / 0.962 / 0.938 | **0.987 / 0.973 / 0.960** | | 0.990 / 0.977 / 0.952 |
| Thin objects (DIS, 75) | 0.921, 1 under 0.5 | 0.767, 11 under 0.5 | **0.859, 4 under 0.5** | | 0.923, 1 under 0.5 |
| Nearly empty masks (under 0.2% of the photo), same 923 | 3 | 10 (7 of them DIS) | **2** | | 0 |
| COCO busy scenes (150): IoU / nearly empty masks | 0.547 / 5 | 0.545 / 23 | **0.577 / 12** | | 0.597 / 1 |

- **Why 640 and not 512:** 512 is faster and smaller, but it returns empty masks on thin frames (bicycle stand, rack,
  ironing board, shower). A third party saw the same with lite at 512
  ([jiabins](https://huggingface.co/jiabins0303/birefnet-lite-1024-webgpu)). 640 fixes those (DIS: 0 empty) and uses
  the memory ISNet already uses on Kevin's iPhone.
- **The caveat at 640:** on COCO's busy scenes (small subjects in a crowded frame), 640 comes back empty more often than
  ISNet (12 against 5 of 150), even though its mean IoU there is higher. The page should treat an empty mask as "no
  subject found" (it does today) and the iPhone test should include a few such photos.
- **Why not 768:** 1.5 times ISNet's memory. ISNet already peaks at 1.5 to 2 GB in the Simulator.
- **Memory is a ratio, not iPhone gigabytes.** Node measures 918 MB for ISNet; CLAUDE.md records 1.5 to 2 GB for the
  whole tab in the iOS Simulator. Read the table as "640 needs what ISNet needs". The Simulator test below has to
  confirm it.
- **int8 doesn't help.** Activations dominate: BiRefNet's heap is about 300 MB after loading and 2 GB at its peak at
  1024. Shrinking the weights saves at most a few tens of MB. Smaller inputs are the lever that works.
- **Checks:** my export reproduces the shipped model's memory at 1024 (2.16 GB against 2.05 GB). Its deform-conv
  rewrite matches torchvision's within 2.5e-5 to 6e-5 in the logits. The new runs used onnxruntime-node's CPU provider;
  the ISNet and 1024 rows come from the earlier WebGPU runs (fine for 640 against ISNet, slight noise against 1024).
- **Licence:** BiRefNet lite is MIT. If it replaces ISNet on the CPU path (and on Android GPUs), ISNet ships nowhere.
  Then the AGPL reason in CLAUDE.md goes away. That is Kevin's call. Note: Hugging Face tags IMG.LY's ISNet file MIT
  ([imgly](https://huggingface.co/imgly/isnet-general-onnx)) but onnx-community's copy AGPL-3.0
  ([onnx-community](https://huggingface.co/onnx-community/ISNet-ONNX)). Don't rely on either tag without checking.

### Other candidates (not measured; ranked)

| Model | Licence | Size | Verdict |
|---|---|---|---|
| ormbg ([HF](https://huggingface.co/schirrmacher/ormbg)) | Apache-2.0 | 88 MB fp16, ISNet architecture | Same memory as ISNet; trained on synthetic people. A licence fix, not a quality gain. The fallback if BiRefNet 640 fails on the iPhone |
| MODNet ([GitHub](https://github.com/ZHKKKe/MODNet)) | Apache-2.0 | 13 MB fp16 | Portrait matting only; no pets, products or cars |
| U2Net / U2NetP ([GitHub](https://github.com/xuebinqin/U-2-Net)) | Apache-2.0 | 176 / 4.7 MB | Older than ISNet and from the same authors; no reason to expect better |
| BEN2 base ([HF](https://huggingface.co/PramaLLC/BEN2)) | Base MIT (full model is commercial) | 219 MB fp16, 95M params | Twice BiRefNet lite's parameters; too big for the iPhone budget |
| MVANet ([HF](https://huggingface.co/onnx-community/MVANet-ONNX)) | MIT tag, upstream unchecked | 211 MB fp16 | Too big, same reason |
| InSPyReNet ([GitHub](https://github.com/plemeri/transparent-background)) | Code MIT, weights unstated | 199 MB fp16 (SwinB) | Too big, licence unclear |
| BiRefNet_512x512, BiRefNet_dynamic ([GitHub](https://github.com/ZhengPeng7/BiRefNet)) | MIT | 444 MB (Swin-L) | Full-size backbones, not lite; too big |
| RMBG-1.4, RMBG-2.0 ([1.4](https://huggingface.co/briaai/RMBG-1.4), [2.0](https://huggingface.co/briaai/RMBG-2.0)), ZIM ([GitHub](https://github.com/naver-ai/ZIM)) | Non-commercial | | Out: the site runs ads |
| MobileSAM ([GitHub](https://github.com/ChaoningZhang/MobileSAM)) | Apache-2.0 | 10M params | Needs a point or box; doesn't pick a subject |

I found no published iPhone memory figure for any of these.

### Test plan for BiRefNet lite 640

1. **Model:** `scripts/birefnet-lowres.py hf 640 birefnet-640.onnx check` (setup in its header; about 96 MB). Commit as
   20 MiB parts with a manifest, like `weights/birefnet/`. It runs on wasm as is. For WebGPU it would also need
   `scripts/narrow-onnx.py`.
2. **Code, behind a switch first:** `engine.js` assumes 1024 (`RES`). Give each model its own input size, and have
   `app.js` send pixels at that size and scale the mask up to 1024 before despeckle. Check the 👎 retry (2048 merged
   masks) and GIFs (frame size). `scripts/quality/pipeline.cjs` changes in step. Hang it on `?model=birefnet640`
   (`?model=` exists) and tag votes and crashes `cpu-birefnet640`.
3. **iOS Simulator:** the 3-photo test that took ISNet from 2.1 to 1.46 GB. Pass: peak no higher than ISNet's on the
   same photos.
4. **Kevin's iPhone, `?debug=1&model=birefnet640`:** the 18.75 MP photo, then 7 to 8 photos in one tab (the case that
   once crashed), a few busy scenes with a small subject, then a 16-frame GIF. Pass: no crash, 6 s or less a photo (Kevin's limit is "a few seconds"; ISNet is 5).
5. **Parity:** 20 photos through `npm run dev` against the harness, as in `docs/quality-1000.md`.
6. **Switch:** make it the default for iPhones and the CPU fallback. Watch crash reports by engine for a week. Keep ISNet
   one switch away (`?model=isnet`) until then.

A risk outside our code: WebKit bug 304810 reports a transient wasm-compile memory peak of about 4 GiB on iOS 26
that killed tabs running ONNX Runtime ([WebKit](https://bugs.webkit.org/show_bug.cgi?id=304810)). It would hit ISNet
the same way. Not reproduced here.

## 2. Mac Safari's WebGPU

**What I saw.** Safari 27.2 on macOS 27.2.1 opened the production deployment with `?debug=1&url=<a cat photo>`. The
page picked the GPU engine with BiRefNet, was cross-origin isolated, decoded the photo and fetched the model in 6.7 s.
Then it went silent: not even the 30 s warm-up timeout fired, which runs on the main thread. `pmset` shows the
display went off at 23:43, before the test, so the tab was most likely suspended. That says nothing about WebGPU.
**Untested.**

**What the sources say:**
- WebGPU ships on by default in Safari 26 on macOS, iOS and iPadOS
  ([gpuweb status](https://github.com/gpuweb/gpuweb/wiki/Implementation-Status)).
- `shader-f16` has no conditions in WebKit ([HardwareCapabilities.mm](https://github.com/WebKit/WebKit/blob/main/Source/WebGPU/WebGPU/HardwareCapabilities.mm)),
  and is reported on essentially all Safari devices ([web3dsurvey](https://web3dsurvey.com/webgpu/features/shader-f16)).
- Limits (WebKit main, November 2026; not confirmed in a shipping release):
  - 44 storage buffers per shader stage (BiRefNet's rewrite needed 10 or fewer, so there is room).
  - `maxBufferSize` and `maxStorageBufferBindingSize` up to about 2 GB on Macs, at most 1 GB on iOS.
  - BiRefNet's largest tensor is 56 MiB, so buffer limits are not the issue.
- Adapter info: Safari reports only the vendor ("apple") in every field ([GPUAdapterInfo.h](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/Modules/WebGPU/GPUAdapterInfo.h)).
  No `navigator.deviceMemory` ([caniuse](https://caniuse.com/mdn-api_navigator_devicememory)).
- Known issues:
  - ORT's WebGPU backend failed to start on Safari 26.0.1 because `adapterInfo` was undefined. Fixed in WebKit trunk
    ([WebKit 301878](https://bugs.webkit.org/show_bug.cgi?id=301878)); not checked against 27.2.
  - A WebGPU GPU-process memory leak on macOS/iOS 26 got the GPU process killed. Fixed in trunk
    ([WebKit 303203](https://bugs.webkit.org/show_bug.cgi?id=303203)).
  - Both would show up as a GPU failure. The page already handles that by finishing on the CPU.
- **Is the 3 GB GPU peak safe?** On Apple Silicon, GPU memory is system memory. On 16 GB and up, likely fine; on 8 GB
  Macs, unknown (see 3). Safari's GPU process has its own memory limits I couldn't find documented.

**Kevin's 2-minute check** (on the Mac, awake). First close the Safari tab left open overnight
(`dc827332.goodbye-bg-git.pages.dev`); it resumes when the Mac wakes.

    npx wrangler pages deployment list --project-name goodbye-bg-git        # newest Production ID
    npx wrangler pages deployment tail <id> --project-name goodbye-bg-git --format json | grep diag

Open `https://goodbye.bg/?debug=1` in Safari and drop 4 photos. Look for, in order: `worker:session`,
`worker:warm` (ms), `ready` with engine `gpu`, then one `run-done` per photo. `gpu-start-failed` or `gpu-run-failed`
means it fell back to the CPU. Then also check Activity Monitor: Safari's GPU process memory during the run.

## 3. 8 GB Macs and Windows/Linux GPUs

- **Adapter limits don't separate weak GPUs from strong ones:**
  - Browsers report them in tiers ([MDN](https://developer.mozilla.org/docs/Web/API/GPUSupportedLimits)).
  - On Windows, 99% of devices report a `maxBufferSize` and `maxStorageBufferBindingSize` of 2 GiB or more
    ([web3dsurvey](https://web3dsurvey.com/webgpu/limits/maxBufferSize)).
  - BiRefNet's largest tensor is 56 MiB and ISNet's 64 MiB, under the WebGPU defaults (128 MiB binding, 256 MiB
    buffer), so every adapter passes.
- **No way to read VRAM.** `memoryHeaps` sits behind a developer flag
  ([Chrome](https://developer.chrome.com/blog/new-in-webgpu-121)).
- **`navigator.deviceMemory`:** Chromium only, capped at 8 ([W3C](https://www.w3.org/TR/device-memory-1/)). An 8 GB
  Mac and a 64 GB Mac both say 8.
- **`adapter.info`:** Chrome gives vendor and architecture (e.g. "intel", "gen-12lp"). It is a weak signal, and there
  is no data yet on which ones fail.

**Proposed gate:**
1. Before starting: if `navigator.deviceMemory` exists and is under 8, use ISNet on the GPU (4 GB laptops, Chromebooks).
2. At runtime (the real gate): if BiRefNet's GPU session start or warm-up fails, takes longer than 10 s, or the first
   photo takes over 2 s, start ISNet on the GPU next, not the CPU.
   - Today a GPU failure goes straight to the CPU.
   - ISNet's GPU peak is a third of BiRefNet's. On a weak GPU, ISNet on the GPU (0.1 s a photo) beats the CPU (5 s).
   - Use a new worker, as the page does now: a failed WebGPU run poisons ORT's wasm instance.
3. Measure before tuning: add `adapter.info.vendor`/`architecture` (coarse, already tiered) and the warm-up ms to crash
   reports and the `ready` step. Then the gate can rest on data from real visitors.

8 GB Macs specifically: no signal tells them apart in Chrome or Safari. The runtime fallback is the protection. If
crash reports show `gpu-birefnet` failing there, BiRefNet at 768 on the GPU is an option: about half the activations
of 1024; it needs `narrow-onnx.py` and a check of its WebGPU memory.

## 4. Automatic zoomed second pass for edges

Another session has a run going in `~/goodbye-bg-quality/out/*-p2*` (a zoomed second pass, merged into the first
result). Its numbers so far, on the photos where the pass triggered, are not mine and may change:
- BiRefNet (574 photos): boundary IoU fell from 0.910 to 0.900 and edge error rose from 0.056 to 0.059. IoU got
  better on 15 photos and worse on 45.
- ISNet (605 photos): boundary IoU fell from 0.787 to 0.763. IoU got better on 77 photos and worse on 114.

On phones it would also double the time (5 s to 10 s), against Kevin's "a few seconds". The input size table above shows
the bigger lever: boundary IoU 0.866 at 640, 0.904 at 1024. Verdict, pending that session's final numbers: not worth
it automatically; keep it on 👎, where someone asked for another try.

## Reproduce

Working files in `~/goodbye-bg-quality/plat/` (outside the repo):
- `wasmmem.mjs` (heap peak: wraps `WebAssembly.Memory`, runs ORT Web 1.31.1 in Node).
- `run-res.cjs` (the harness with a model input size and an upscaled mask).
- `compare.py`.

The model export is in the repo: `scripts/birefnet-lowres.py`.
