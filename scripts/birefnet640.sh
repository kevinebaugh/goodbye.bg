#!/bin/sh
# Remakes weights/birefnet640/ (BiRefNet lite at 640x640, the CPU engine's model on branch phone-birefnet640),
# committed as parts under 25 MiB with a manifest, like weights/birefnet/. See docs/phone-birefnet640.md.
# Needs the venv and hf/ folder from the header of scripts/birefnet-lowres.py:  scripts/birefnet640.sh <hf dir> <python>
# The export already writes the deformable convs as chunked GridSample (what deform-to-gridsample.py does for the 1024
# export), and scripts/narrow-onnx.py finds nothing to rewrite in it (0 Concat, 0 Split), so neither step runs here.
set -eu
cd "$(dirname "$0")/.."
HF=${1:-hf}; PY=${2:-python3}
mkdir -p models
"$PY" scripts/birefnet-lowres.py "$HF" 640 models/birefnet-640.onnx check
rm -rf weights/birefnet640 && mkdir -p weights/birefnet640
split -b 20m -a 1 models/birefnet-640.onnx weights/birefnet640/part-
node -e '
const fs = require("fs"), d = "weights/birefnet640", parts = fs.readdirSync(d).filter((f) => f.startsWith("part-")).sort();
const names = parts.map((p, i) => { fs.renameSync(`${d}/${p}`, `${d}/${i}.bin`); return `${i}.bin`; });
const b = fs.readFileSync("models/birefnet-640.onnx");
fs.writeFileSync(`${d}/manifest.json`, JSON.stringify({ size: b.length, sha256: require("crypto").createHash("sha256").update(b).digest("hex"), parts: names }) + "\n");'
ls -l weights/birefnet640
