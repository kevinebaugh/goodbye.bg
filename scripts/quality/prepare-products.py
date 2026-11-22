# Picks the product and phone-size test photos (fixed seed) from the downloaded public sets, builds the synthetic seller
# shots, and writes photos, ground truth and manifest.jsonl into <work dir> (its own folder, next to the 1,073-photo set).
# Run with -I. Photos stay outside the repo. Sources and licences: docs/quality-products.md.
#   python -I prepare-products.py <work dir>        (<work dir>/data/ holds the downloads named in each block)
import sys, os, io, json, random, re
import numpy as np
import pyarrow.parquet as pq
from PIL import Image, ImageOps, ImageFilter

W = sys.argv[1]; D = os.path.join(W, "data"); P = os.path.join(W, "photos")
rnd = random.Random(2026); rows = []

def upright(img_bytes, mask_size):
    # Phone photos carry an EXIF orientation; the page draws them upright. Keep whichever orientation matches the truth.
    im = Image.open(io.BytesIO(img_bytes)); o = im.getexif().get(274, 1)
    if o in (None, 1): return img_bytes, im.size
    t = ImageOps.exif_transpose(im).convert("RGB")
    if t.size == mask_size and im.size != mask_size:
        b = io.BytesIO(); t.save(b, "JPEG", quality=95); return b.getvalue(), t.size
    return img_bytes, im.size

def put(set_, cat, id_, img, gt, kind="binary", extra=None, aux=None):
    d = os.path.join(P, set_); os.makedirs(d, exist_ok=True)
    g = gt if isinstance(gt, Image.Image) else Image.open(io.BytesIO(gt))
    if isinstance(img, Image.Image): b = io.BytesIO(); img.save(b, "JPEG", quality=95); img = b.getvalue()
    img, size = upright(img, g.size)
    if size != g.size: print("size mismatch, skipped", set_, id_, size, g.size); return
    ip = os.path.join("photos", set_, id_ + (".png" if img[:4] == b"\x89PNG" else ".jpg"))
    open(os.path.join(W, ip), "wb").write(img)
    gp = os.path.join("photos", set_, id_ + ".gt.png"); g.convert("L").save(os.path.join(W, gp))
    r = {"id": set_ + "-" + id_, "set": set_, "cat": cat, "image": ip, "gt": gp, "gtKind": kind, "w": size[0], "h": size[1]}
    if aux is not None:
        ap = os.path.join("photos", set_, id_ + ".aux.png"); aux.save(os.path.join(W, ap)); r["aux"] = ap
    r.update(extra or {}); rows.append(r)

def table(paths, cols):
    out = []
    for p in paths: out += pq.read_table(os.path.join(D, p), columns=cols).to_pylist()
    return out

# UHRSD test (Xie et al. 2022, CC BY-NC 4.0, nobg/UHRSD): 4K to 24 MP photos, many from phones. First two of ten shards, 150 at random.
t = table(["uhrsd/test0.parquet", "uhrsd/test1.parquet"], ["image", "mask"])
for i in sorted(rnd.sample(range(len(t)), 150)):
    put("uhrsd", "salient", os.path.splitext(t[i]["image"]["path"])[0], t[i]["image"]["bytes"], t[i]["mask"]["bytes"])
# HRSOD test (Zeng et al. 2019, CC BY-NC 4.0, nobg/HRSOD): high-resolution Flickr photos; 150 at random.
t = table(["hrsod/test0.parquet", "hrsod/test1.parquet"], ["image", "mask"])
for i in sorted(rnd.sample(range(len(t)), 150)):
    put("hrsod", "salient", os.path.splitext(t[i]["image"]["path"])[0], t[i]["image"]["bytes"], t[i]["mask"]["bytes"])
# DIS5K TE2 + TE3 (Qin et al. 2022, nobg/DIS5K; TE1 is in the 1,073 set): the things people sell; 200 at random.
PROD = {"Kitchenware", "Accessories", "Electronics", "Electrical", "Furniture", "Tool", "Sports", "Music Instrument", "Entertainment"}
NOT = {"UtilityPole", "StreetLamp", "TrafficLight", "Lightning", "Antenna", "Handrail", "KidsPlayground", "RockClimbing", "UnevenBars",
       "HorizontalBar", "OutdoorFitnessEquipment", "Wakesurfing", "Skiing", "Skateboarding", "Archery", "Fishing", "Swing", "Flag", "Hydrovalve"}
t = [r for r in table(["dis/te2.parquet", "dis/te3a.parquet", "dis/te3b.parquet"], ["image", "label", "image_name"])
     if r["image_name"].split("#")[1] in PROD and r["image_name"].split("#")[3] not in NOT]
for i in sorted(rnd.sample(range(len(t)), min(200, len(t)))):
    n = t[i]["image_name"].split("#")
    put("disprod", n[3], (n[3] + "_" + os.path.splitext(n[4])[0])[:60], t[i]["image"]["bytes"], t[i]["label"]["bytes"])
# Trans10K-v2 validation (Xie et al. 2020, Apache-2.0 per the mirror rdyzakya/Trans10K-v2): see-through things. Photos whose
# mask holds one kind of thing (bottle, cup, jar, bowl, glasses, box) and no window, wall, door, shelf or freezer, filling 8 to 80%.
THING = {(4, 250, 7): "box", (150, 5, 61): "bottle", (140, 140, 140): "eyeglass", (235, 255, 7): "jar", (255, 51, 7): "cup", (255, 0, 0): "cup", (204, 5, 255): "bowl"}
t = table(["trans10k/validation.parquet"], ["image", "mask"]); cand = []
for i, r in enumerate(t):
    m = np.asarray(Image.open(io.BytesIO(r["mask"]["bytes"])).convert("RGB")).reshape(-1, 3)
    cols, cnt = np.unique(m, axis=0, return_counts=True); fg = [(tuple(int(v) for v in c), k) for c, k in zip(cols, cnt) if tuple(c) != (0, 0, 0) and k > 50]
    if not fg or any(c not in THING for c, _ in fg) or len({THING[c] for c, _ in fg}) != 1: continue
    frac = sum(k for _, k in fg) / len(m)
    if 0.08 <= frac <= 0.8: cand.append((i, THING[fg[0][0]]))
for i, kind in sorted(rnd.sample(cand, min(100, len(cand)))):
    m = np.asarray(Image.open(io.BytesIO(t[i]["mask"]["bytes"])).convert("RGB")).reshape(-1, 3)
    keep = np.isin(m.view([("", m.dtype)] * 3).ravel(), np.array([c for c in THING], dtype=np.uint8).view([("", np.uint8)] * 3).ravel())
    size = Image.open(io.BytesIO(t[i]["mask"]["bytes"])).size
    put("trans", kind, "%04d" % i, t[i]["image"]["bytes"], Image.fromarray((keep.reshape(size[1], size[0]) * 255).astype(np.uint8)))
print("transparent candidates", len(cand))

# Seller shots, made here: the product cut-outs of ThinObject-5K test (Liew et al. 2021, CC BY-NC 4.0, nobg/ThinObject-5K; objects
# from PNG cut-out sites with exact masks) placed on a seller's background. Four looks in turn: plain white, white with a soft drop
# shadow, a light grey sweep with a contact and cast shadow, white with a mirror reflection. The truth is the product; aux marks
# the shadow or reflection (where the background was changed), to count how much of it a cut-out keeps.
PRODUCTS = set("""air_pump alarm_clock american_football apron armchair backpack badminton barbell baseball bassinet bell bicycle_helmet
bottle_opener broom brush candle carabiner chain chain_saw chair comb corkscrew cowboy_hat crutch darts drone drum extinguisher fan
fish_hook flashlight flute fork frying_pan gavel generator grill gym_equipment hairbrush hammer hammock harp hockey ice_axe jewelry
keychain kick_scooter knife ladder leash lemonade lifebuoy louboutin mascara measure_tape megaphone metal_nail mirror mop mortar necklace
notebook paddle padlock pearl pen pencil piano piercing pin plier plunger pram punching_bag recycle_bin ribbon ruler safety_pin samovar
sandals scales scissors scooter screwdriver sewing_machine sewing_needle shoelaces shopping_cart shower skiing suitcase sunglasses syringe
table telescope tennis thermometer thermos tie toilet_brush toothbrush trampoline treadmill trekking_pole tripod trombone
trumpet_saxophone typewriter umbrella vacuum_cleaner video_camera violin walking_stick weight_plate wheelchair whip whistle wineglass
women_bag women_shoes wrench""".split())
LOOKS = ["white", "drop", "floor", "mirror"]
t = [r for r in table(["thin5k/test.parquet"], ["image", "mask"]) if re.sub(r"_PNG\d+.*", "", r["image"]["path"]) in PRODUCTS]
blur = lambda a, r: np.asarray(Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(r)), np.float32) / 255
for k, r in enumerate(sorted(t, key=lambda r: r["image"]["path"])[:200]):
    name = os.path.splitext(r["image"]["path"])[0]; look = LOOKS[k % 4]
    im = np.asarray(Image.open(io.BytesIO(r["image"]["bytes"])).convert("RGB"), np.float32)
    m = np.asarray(Image.open(io.BytesIO(r["mask"]["bytes"])).convert("L"), np.float32) / 255
    ys, xs = np.nonzero(m > 0.5)
    if len(ys) < 500: continue
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    obj, om = im[y0:y1, x0:x1], m[y0:y1, x0:x1]
    L = rnd.randint(1800, 2600); s = min(L / max(obj.shape[:2]), 2.5)  # long side of the product; never more than 2.5x up
    ow, oh = max(1, round(obj.shape[1] * s)), max(1, round(obj.shape[0] * s))
    obj = np.asarray(Image.fromarray(obj.astype(np.uint8)).resize((ow, oh), Image.LANCZOS), np.float32)
    om = (np.asarray(Image.fromarray((om * 255).astype(np.uint8)).resize((ow, oh), Image.LANCZOS), np.float32) / 255 > 0.5).astype(np.float32)
    side = round(max(ow, oh) / 0.72); cw, ch = side, side  # square, as marketplaces ask; the product fills about 72%
    ox, oy = (cw - ow) // 2, (ch - oh) // 2 - (round(0.04 * side) if look in ("floor", "mirror") else 0)
    if look == "floor":  # light grey sweep, darker at the top
        bg = np.repeat(np.linspace(228, 248, ch, dtype=np.float32)[:, None], cw, 1)[..., None].repeat(3, 2)
    else: bg = np.full((ch, cw, 3), 255 if look != "mirror" else 250, np.float32)
    full = np.zeros((ch, cw), np.float32); full[oy:oy + oh, ox:ox + ow] = om
    dark = np.zeros((ch, cw), np.float32); add = None  # dark: how much each background pixel is darkened
    if look == "drop":
        sh = np.roll(np.roll(full, round(0.03 * side), 1), round(0.035 * side), 0)
        dark = 0.45 * blur(sh, 0.02 * side)
    elif look == "floor":
        bottom = oy + oh; cols = np.nonzero(om[-max(2, oh // 20):].max(0) > 0)[0]
        cx = ox + (cols.mean() if len(cols) else ow / 2); rw = max(0.55 * ow, (np.ptp(cols) if len(cols) else ow) * 0.6); rh = 0.035 * side
        yy, xx = np.mgrid[0:ch, 0:cw]
        ell = (((xx - cx) / rw) ** 2 + ((yy - bottom) / rh) ** 2 <= 1).astype(np.float32)
        cast = np.zeros_like(full); sq = np.asarray(Image.fromarray((om * 255).astype(np.uint8)).resize((ow, max(1, oh // 4))), np.float32) / 255
        sx = ox + round(0.12 * side); h4 = sq.shape[0]; xs_ = slice(max(0, sx), min(cw, sx + ow)); y_ = slice(bottom - h4, bottom)
        cast[y_, xs_] = sq[:, : xs_.stop - xs_.start] if sx >= 0 else sq[:, -sx:-sx + (xs_.stop - xs_.start)]
        dark = np.maximum(0.55 * blur(ell, 0.012 * side), 0.32 * blur(cast, 0.02 * side))
    elif look == "mirror":
        ref = np.zeros((ch, cw, 3), np.float32); rm = np.zeros((ch, cw), np.float32)
        hh = min(oh, ch - (oy + oh)); fade = np.linspace(0.38, 0, hh, dtype=np.float32)[:, None]
        ref[oy + oh:oy + oh + hh, ox:ox + ow] = obj[::-1][:hh]; rm[oy + oh:oy + oh + hh, ox:ox + ow] = om[::-1][:hh] * fade
        add = (ref, rm)
    out = bg * (1 - dark[..., None])
    if add: out = out * (1 - add[1][..., None]) + add[0] * add[1][..., None]
    out = out * (1 - full[..., None]); out[oy:oy + oh, ox:ox + ow] += obj * om[..., None]
    changed = (np.abs(out - bg).max(2) > 8) & (full < 0.5)
    lum = float((obj[..., 0] * 0.299 + obj[..., 1] * 0.587 + obj[..., 2] * 0.114)[om > 0.5].mean())
    put("seller", re.sub(r"_PNG\d+.*", "", name), name + "_" + look, Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)),
        Image.fromarray((full * 255).astype(np.uint8)), "binary", {"look": look, "lum": round(lum)}, Image.fromarray((changed * 255).astype(np.uint8)))

with open(os.path.join(W, "manifest.jsonl"), "w") as f:
    for r in rows: f.write(json.dumps(r) + "\n")
from collections import Counter
print(len(rows), Counter(r["set"] for r in rows))
mp = {s: sorted(r["w"] * r["h"] / 1e6 for r in rows if r["set"] == s) for s in Counter(r["set"] for r in rows)}
for s, v in mp.items(): print(s, "median MP %.1f" % v[len(v) // 2], ">=8MP:", sum(x >= 8 for x in v), ">=12MP:", sum(x >= 11.9 for x in v))
