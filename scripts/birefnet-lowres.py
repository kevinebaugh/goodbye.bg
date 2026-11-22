# BiRefNet lite at a smaller input (512, 640, 768, ...) for the CPU engine. Research tool: nothing in the build uses it yet.
# See docs/platforms-and-phone-model.md. The onnx-community export is fixed at 1024 (sizes baked into its deform convs),
# so this exports again from the PyTorch weights.
#
#   python3 -m venv venv && venv/bin/pip install torch torchvision transformers timm einops safetensors onnx onnxscript onnxconverter-common
#   mkdir hf && for f in birefnet.py BiRefNet_config.py config.json model.safetensors; do
#     curl -fL -o hf/$f https://huggingface.co/ZhengPeng7/BiRefNet_lite/resolve/aa62cd87eafb9cc43056d08ef3615a14628b831d/$f; done
#   venv/bin/python scripts/birefnet-lowres.py hf 512 birefnet-512.onnx [check]
#
# Tested 2026-11-21 with torch 2.15.0, onnx 1.23.2, onnxscript 0.7.2, onnxconverter-common 1.16.0, transformers 5.24.0,
# timm 1.0.31 (Python 3.15). model.safetensors sha256 4417d89795250e698c3cb0ae8df15743810065f646f48a694fdfa7ca052d0815.
#
# The deformable convs become chunked GridSample + strided Conv, like scripts/deform-to-gridsample.py does for the
# 1024 export (one big sampled tensor per kernel row chunk, at most 64 MB). Spelling them out per tap instead doubled
# the wasm memory peak. "check" compares against torchvision's deform_conv2d first (largest logit difference 2.5e-5 to 6e-5).
# Output: fp16 weights and activations, float32 input [1,3,R,R] (ImageNet mean/std) and output logits [1,1,R,R],
# the same contract as the 1024 model in weights/birefnet/. About 96 MB.
import sys, os, types, importlib.util, tempfile, torch, torch.nn.functional as F

d, res, out = sys.argv[1], int(sys.argv[2]), sys.argv[3]
assert res % 32 == 0, "input size must be a multiple of 32"
# birefnet.py imports kornia for a training-only path (laplacian); it is not needed to run the model.
kf = types.ModuleType("kornia.filters"); kf.laplacian = None
ko = types.ModuleType("kornia"); ko.filters = kf; sys.modules["kornia"] = ko; sys.modules["kornia.filters"] = kf
pkg = types.ModuleType("brnpkg"); pkg.__path__ = [d]; sys.modules["brnpkg"] = pkg  # birefnet.py imports its config relatively
spec = importlib.util.spec_from_file_location("brnpkg.birefnet", os.path.join(d, "birefnet.py"))
m = importlib.util.module_from_spec(spec); sys.modules["brnpkg.birefnet"] = m; spec.loader.exec_module(m)


def deform(input, offset, weight, bias=None, padding=0, mask=None, stride=(1, 1)):
    """torchvision.ops.deform_conv2d (stride 1, one offset group) with GridSample, a few kernel rows at a time."""
    N, C, H, W = input.shape; _, _, kh, kw = weight.shape; Ho, Wo = offset.shape[2:]
    p = padding if isinstance(padding, (tuple, list)) else (padding, padding)
    assert tuple(stride if isinstance(stride, (tuple, list)) else (stride, stride)) == (1, 1)
    o5 = offset.reshape(N, kh, kw, 2, Ho, Wo)  # torchvision order: tap (ky, kx), then (dy, dx)
    m4 = mask.reshape(N, kh, kw, Ho, Wo)
    ys = torch.arange(Ho, dtype=input.dtype).view(1, 1, 1, Ho, 1); xs = torch.arange(Wo, dtype=input.dtype).view(1, 1, 1, 1, Wo)
    G = max(1, min(kh, int(64 * 2**20 // (C * Ho * Wo * kw * 2))))  # kernel rows per chunk: sampled tensor (fp16) <= 64 MB
    acc = None
    for r0 in range(0, kh, G):
        r1 = min(kh, r0 + G); g = r1 - r0
        ky = torch.arange(r0, r1, dtype=input.dtype).view(1, g, 1, 1, 1); kx = torch.arange(kw, dtype=input.dtype).view(1, 1, kw, 1, 1)
        y = ys - p[0] + ky + o5[:, r0:r1, :, 0]; x = xs - p[1] + kx + o5[:, r0:r1, :, 1]  # sample positions, N,g,kw,Ho,Wo
        grid = torch.stack((2 * x / (W - 1) - 1, 2 * y / (H - 1) - 1), -1)  # align_corners=True coordinates
        grid = grid.permute(0, 3, 1, 4, 2, 5).reshape(N, Ho * g, Wo * kw, 2)  # rows (ho, ky), columns (wo, kx)
        mk = m4[:, r0:r1].permute(0, 3, 1, 4, 2).reshape(N, 1, Ho * g, Wo * kw)
        smp = F.grid_sample(input, grid, mode="bilinear", padding_mode="zeros", align_corners=True) * mk
        t = F.conv2d(smp, weight[:, :, r0:r1, :], stride=(g, kw))
        acc = t if acc is None else acc + t
    return acc if bias is None else acc + bias.view(1, -1, 1, 1)


from safetensors.torch import load_file
model = m.BiRefNet(bb_pretrained=False)
print(model.load_state_dict(load_file(os.path.join(d, "model.safetensors"))))
model.eval()


class Final(torch.nn.Module):  # the last (full-size) prediction only, as logits
    def __init__(self, net): super().__init__(); self.net = net
    def forward(self, x): return self.net(x)[-1]


w = Final(model); x = torch.randn(1, 3, res, res)
with torch.no_grad():
    if "check" in sys.argv:
        a = w(x); m.deform_conv2d = deform; b = w(x)
        print("largest logit difference vs torchvision:", (a - b).abs().max().item())
    m.deform_conv2d = deform
    tmp = os.path.join(tempfile.mkdtemp(), "fp32.onnx")
    torch.onnx.export(w, (x,), tmp, input_names=["input_image"], output_names=["output_image"], opset_version=18, dynamo=True, optimize=True)

import onnx
from onnxconverter_common import float16
onnx.save(float16.convert_float_to_float16(onnx.load(tmp), keep_io_types=True), out)
print("wrote", out, os.path.getsize(out), "bytes")
