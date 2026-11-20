# Usage: python3 scripts/narrow-onnx.py in.onnx out.onnx 6   (needs: pip install onnx)
# Not used by the build. Kept for the next attempt at BiRefNet on WebGPU (see CLAUDE.md).
# Make BiRefNet fit WebGPU's storage-buffer limit: no Concat with more than K inputs and
# no Split with more than K outputs. Both become trees of smaller ops with the same result.
import sys, onnx
from onnx import helper, numpy_helper
import numpy as np
src, dst, K = sys.argv[1], sys.argv[2], int(sys.argv[3])
m = onnx.load(src); g = m.graph
consts = {i.name: numpy_helper.to_array(i) for i in g.initializer}
for n in g.node:
    if n.op_type == "Constant":
        for a in n.attribute:
            if a.name == "value": consts[n.output[0]] = numpy_helper.to_array(a.t)
def groups(seq):
    return [seq[i:i + K] for i in range(0, len(seq), K)]
out_nodes, nc, ns, uid = [], 0, 0, [0]
def name(base):
    uid[0] += 1; return f"{base}__n{uid[0]}"
def split_tree(inp, outs, sizes, axis, base, nodes):
    if len(outs) <= K:
        s = name(base + "_sizes"); g.initializer.append(numpy_helper.from_array(np.array(sizes, dtype=np.int64), s))
        nodes.append(helper.make_node("Split", [inp, s], outs, name=name(base), axis=axis)); return
    gs = groups(list(range(len(outs))))
    while len(gs) > K:  # more than K groups: group the groups
        gs = [sum(x, []) for x in groups(gs)]
    mids = [name(base + "_part") for _ in gs]
    s = name(base + "_sizes"); g.initializer.append(numpy_helper.from_array(np.array([sum(sizes[i] for i in grp) for grp in gs], dtype=np.int64), s))
    nodes.append(helper.make_node("Split", [inp, s], mids, name=name(base), axis=axis))
    for mid, grp in zip(mids, gs):
        if len(grp) == 1:
            nodes.append(helper.make_node("Identity", [mid], [outs[grp[0]]], name=name(base + "_id")))
        else:
            split_tree(mid, [outs[i] for i in grp], [sizes[i] for i in grp], axis, base, nodes)
for n in g.node:
    attrs = {a.name: helper.get_attribute_value(a) for a in n.attribute}
    if n.op_type == "Concat" and len(n.input) > K:
        nc += 1; cur, axis = list(n.input), attrs["axis"]
        while len(cur) > K:
            nxt = []
            for grp in groups(cur):
                if len(grp) == 1: nxt.append(grp[0]); continue
                o = name(n.output[0]); out_nodes.append(helper.make_node("Concat", grp, [o], name=name(n.name), axis=axis)); nxt.append(o)
            cur = nxt
        out_nodes.append(helper.make_node("Concat", cur, list(n.output), name=n.name, axis=axis))
    elif n.op_type == "Split" and len(n.output) > K:
        ns += 1
        if len(n.input) < 2 or n.input[1] not in consts: raise SystemExit(f"{n.name}: split sizes not constant")
        split_tree(n.input[0], list(n.output), [int(v) for v in consts[n.input[1]]], attrs.get("axis", 0), n.name, out_nodes)
    else:
        out_nodes.append(n)
del g.node[:]; g.node.extend(out_nodes)
onnx.checker.check_model(m)
onnx.save(m, dst)
print(f"Concat rewritten: {nc}, Split rewritten: {ns}, nodes: {len(g.node)}")
