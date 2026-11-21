#!/bin/sh
# Remakes weights/birefnet/ (the GPU engine's model, committed as parts under 25 MiB) from the original export.
# Only needed to change the model; the build just copies weights/birefnet/ (see CLAUDE.md, "Engines").
# Needs python3 with onnx and numpy (pip install onnx numpy).
# Source: BiRefNet lite (MIT, ZhengPeng7/BiRefNet), fp16 ONNX export by onnx-community, pinned by commit and hash.
set -eu
cd "$(dirname "$0")/.."
SRC=models/birefnet_lite_fp16.onnx
URL=https://huggingface.co/onnx-community/BiRefNet_lite-ONNX/resolve/de15b22ba131738a16dff04aab8bdf8dc32e3ac1/onnx/model_fp16.onnx
SHA=d39b897ceb16ae654c1731f3dba0cf9b368d9cae74b5a57459b455cc8bfec402
mkdir -p models
[ -f "$SRC" ] || curl -fL -o "$SRC" "$URL"
echo "$SHA  $SRC" | shasum -a 256 -c -
# 1. The decoder's deformable convs as chunked GridSample (memory). 2. Wide Concat/Split as trees (WebGPU allows 10 buffers per shader).
python3 scripts/deform-to-gridsample.py "$SRC" models/birefnet-gs.onnx 64
python3 scripts/narrow-onnx.py models/birefnet-gs.onnx models/birefnet-webgpu.onnx 6
rm models/birefnet-gs.onnx
rm -rf weights/birefnet && mkdir -p weights/birefnet
split -b 20m -a 1 models/birefnet-webgpu.onnx weights/birefnet/part-
node -e '
const fs = require("fs"), d = "weights/birefnet", parts = fs.readdirSync(d).filter((f) => f.startsWith("part-")).sort();
const names = parts.map((p, i) => { fs.renameSync(`${d}/${p}`, `${d}/${i}.bin`); return `${i}.bin`; });
const b = fs.readFileSync("models/birefnet-webgpu.onnx");
fs.writeFileSync(`${d}/manifest.json`, JSON.stringify({ size: b.length, sha256: require("crypto").createHash("sha256").update(b).digest("hex"), parts: names }) + "\n");'
ls -l weights/birefnet
