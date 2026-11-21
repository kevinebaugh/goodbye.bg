# Usage: python3 scripts/deform-to-gridsample.py in.onnx out.onnx [chunk_mb]   (needs: pip install onnx numpy)
# Used by scripts/birefnet.sh, not by the build. Makes BiRefNet run on WebGPU (see CLAUDE.md, "Engines").
#
# BiRefNet's decoder has 20 deformable convs (5 ASPP modules, kernels 1, 1, 3, 7). The export spells
# each one out as Floor/Clip/GatherND x4/Mul/Sum over all k*k taps at once: the 7x7 at 256x256x64 builds
# several 392 MiB tensors and the session runs out of memory. This replaces that sampling with
# GridSample (bilinear, zeros, align_corners=1, which is what the export computes), done a few kernel
# rows at a time so no tensor is bigger than chunk_mb (default 64), then a strided Conv per chunk and a sum.
# The offset conv, the mask (2*sigmoid), the conv weights and the bias are the model's own. Sample
# positions are computed in fp32 (the export did it in fp16: a quarter pixel off at x=256).
import sys, onnx, numpy as np
from onnx import helper as h, numpy_helper as nh, TensorProto as TP

src, dst = sys.argv[1], sys.argv[2]
LIMIT = float(sys.argv[3] if len(sys.argv) > 3 else 64) * 2**20
m = onnx.load(src); g = m.graph
init = {i.name: nh.to_array(i) for i in g.initializer}
const = {n.output[0]: nh.to_array(n.attribute[0].t) for n in g.node if n.op_type == "Constant"}
byname = {n.name: n for n in g.node}
uid = [0]
def nm(base): uid[0] += 1; return f"{base}/gs{uid[0]}"
def C(base, arr):  # new initializer
    n = nm(base); g.initializer.append(nh.from_array(np.ascontiguousarray(arr), n)); return n

prefixes = sorted({n.name.rsplit("/", 1)[0] for n in g.node if n.op_type == "GatherND"})
new_nodes = {}  # insert new nodes right before the bias Add of each block (keeps topological order)
for p in prefixes:
    pad, conv, add_p, mul_mask, bias_add = (byname[p + s] for s in ("/Pad", "/Conv", "/Add", "/Mul", "/Add_3"))
    offconv = next(n for n in g.node if n.output[0] == byname[p + "/Reshape"].input[0])
    assert offconv.op_type == "Conv" and bias_add.input[0] == conv.output[0]
    x = pad.input[0]
    wt = init[conv.input[1]]; cout, cin, kh, kw = wt.shape
    _, _, K, two, H, W = const[byname[p + "/Reshape"].input[1]].tolist(); assert K == kh * kw and two == 2
    pads = const[pad.input[1]].tolist(); pt, pl = pads[2], pads[3]
    base = const[add_p.input[0]].astype(np.float32).reshape(kh, kw, 2, H, W)
    # Check that the export's base grid is "pixel + tap - centre" in padded coordinates; the rewrite relies on it.
    yy, xx = np.meshgrid(np.arange(H), np.arange(W), indexing="ij")
    for ky in range(kh):
        for kx in range(kw):
            assert np.array_equal(base[ky, kx, 0], yy + ky - (kh - 1) // 2 + pt), p
            assert np.array_equal(base[ky, kx, 1], xx + kx - (kw - 1) // 2 + pl), p
    # Offset conv: reorder output channels from (k, [dy, dx]) to (k, [dx, dy]); GridSample wants (x, y).
    ow, ob = init[offconv.input[1]], init[offconv.input[2]]
    perm = np.arange(2 * K).reshape(K, 2)[:, ::-1].reshape(-1)
    ow2, ob2 = C(p + "/offw", ow[perm]), C(p + "/offb", ob[perm])
    nodes = []
    def N(op, ins, **kw):
        o = nm(p + "/" + op); nodes.append(h.make_node(op, ins, [o], name=o, **kw)); return o
    off = N("Conv", [offconv.input[0], ow2, ob2], **{a.name: h.get_attribute_value(a) for a in offconv.attribute})
    off = N("Cast", [off], to=TP.FLOAT)
    off = N("Reshape", [off, C(p + "/s", np.array([1, kh, kw * 2, H, W], np.int64))])
    off = N("Transpose", [off], perm=[0, 3, 1, 4, 2])            # [1, H, kh, W, kw*2], last axis (kx, [x, y])
    sx, sy = 2.0 / (W - 1), 2.0 / (H - 1)
    off = N("Mul", [off, C(p + "/scale", np.tile(np.array([sx, sy], np.float32), kw))])
    bx = np.zeros((1, 1, 1, W, kw, 2), np.float32); bx[..., 0] = (np.arange(W)[:, None] + np.arange(kw)[None, :] - (kw - 1) // 2) * sx - 1
    by = np.zeros((1, H, kh, 1, kw, 2), np.float32); by[..., 1] = (np.arange(H)[:, None, None, None] + np.arange(kh)[None, :, None, None] - (kh - 1) // 2) * sy - 1
    grid = N("Add", [N("Add", [off, C(p + "/bx", bx.reshape(1, 1, 1, W, kw * 2))]), C(p + "/by", by.reshape(1, H, kh, 1, kw * 2))])
    # Mask (2*sigmoid of the modulator), [1, K, H, W] -> [1, H, kh, W, kw]
    mask = N("Transpose", [N("Reshape", [mul_mask.output[0], C(p + "/ms", np.array([1, kh, kw, H, W], np.int64))])], perm=[0, 3, 1, 4, 2])
    # Kernel rows per chunk so the sampled tensor [1, cin, H*G, W*kw] (fp16) stays under LIMIT.
    G = max(1, min(kh, int(LIMIT // (cin * H * W * kw * 2))))
    parts = []
    for r0 in range(0, kh, G):
        r1 = min(kh, r0 + G); gr = r1 - r0
        sl = lambda t, ax: N("Slice", [t, C(p + "/a", np.array([r0], np.int64)), C(p + "/b", np.array([r1], np.int64)), C(p + "/ax", np.array([ax], np.int64))]) if gr < kh else t
        gch = N("Reshape", [sl(grid, 2), C(p + "/gs", np.array([1, H * gr, W * kw, 2], np.int64))])
        mch = N("Reshape", [sl(mask, 2), C(p + "/mk", np.array([1, 1, H * gr, W * kw], np.int64))])
        samp = N("GridSample", [x, gch], mode="bilinear", padding_mode="zeros", align_corners=1)
        samp = N("Mul", [samp, mch])
        parts.append(N("Conv", [samp, C(p + "/w", wt[:, :, r0:r1, :])], kernel_shape=[gr, kw], strides=[gr, kw]))
    acc = parts[0]
    for q in parts[1:]: acc = N("Add", [acc, q])
    bias_add.input[0] = acc
    new_nodes[bias_add.name] = nodes
    print(f"{p}: k={kh}x{kw} {H}x{W}x{cin} -> {len(parts)} chunk(s) of {G} row(s)")

out = []
for n in g.node:
    out.extend(new_nodes.get(n.name, [])); out.append(n)
# Drop everything nothing reads any more (the old sampling, the old offset conv and the base grids).
used = {o.name for o in g.output}
keep = []
for n in reversed(out):
    if any(o in used for o in n.output):
        keep.append(n); used.update(i for i in n.input if i)
keep.reverse()
del g.node[:]; g.node.extend(keep)
live = [i for i in g.initializer if i.name in used]
del g.initializer[:]; g.initializer.extend(live)
onnx.checker.check_model(m)
onnx.save(m, dst)
print(f"nodes: {len(out)} -> {len(keep)}")
