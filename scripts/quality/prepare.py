# Picks the test photos (fixed seed) from the downloaded public sets and writes them, their ground truth and
# manifest.jsonl into the work dir. Run with -I. Photos stay outside the repo. See docs/quality-1000.md for sources.
#   python -I prepare.py <work dir>
import sys, os, io, json, random, tarfile, zipfile, urllib.request
import pyarrow.parquet as pq
from PIL import Image, ImageDraw

W = sys.argv[1]; D = os.path.join(W, "data"); P = os.path.join(W, "photos")
rnd = random.Random(1000); rows = []

def ext(b): return ".png" if b[:4] == b"\x89PNG" else ".jpg"
def put(set_, cat, id_, img, gt, kind, gt2=None):
    d = os.path.join(P, set_); os.makedirs(d, exist_ok=True)
    ip = os.path.join("photos", set_, id_ + ext(img))
    open(os.path.join(W, ip), "wb").write(img)
    r = {"id": set_ + "-" + id_, "set": set_, "cat": cat, "image": ip}
    for k, g in (("gt", gt), ("gt2", gt2)):
        if g is None: continue
        gp = os.path.join("photos", set_, id_ + "." + k + ".png")
        (g if isinstance(g, Image.Image) else Image.open(io.BytesIO(g))).convert("L").save(os.path.join(W, gp))
        r[k] = gp
    r["gtKind"] = kind; rows.append(r)

def table(path, cols): return pq.read_table(os.path.join(D, path), columns=cols).to_pylist()

# AIM-500: all 500 natural photos with hand-made alpha mattes, seven categories.
for r in table("aim500/test.parquet", ["image_name", "image", "mask", "category", "type"]):
    put("aim500", r["category"], r["image_name"], r["image"]["bytes"], r["mask"]["bytes"], "alpha")
# P3M-500-NP: portraits (faces not blurred) with alpha mattes; 150 at random.
t = table("p3m/np.parquet", ["image", "mask"])
for i in sorted(rnd.sample(range(len(t)), 150)):
    put("p3m", "portrait", "%03d" % i, t[i]["image"]["bytes"], t[i]["mask"]["bytes"], "alpha")
# DIS5K test set 1: objects with fine structure, binary masks; 75 at random.
t = table("dis/te1.parquet", ["image", "label", "image_name"])
for i in sorted(rnd.sample(range(len(t)), 75)):
    put("dis", "fine structure", os.path.splitext(t[i]["image_name"])[0].replace("#", "_")[:60], t[i]["image"]["bytes"], t[i]["label"]["bytes"], "binary")
# AM-2k: animals with alpha mattes; the first shard of the mirror (100 photos).
for r in table("am2k/t0.parquet", ["id", "image", "mask"]):
    im = Image.open(io.BytesIO(r["image"]["bytes"])).convert("RGB"); b = io.BytesIO(); im.save(b, "JPEG", quality=95)  # the mirror's PNGs came from JPEGs
    put("am2k", "animal", r["id"], b.getvalue(), r["mask"]["bytes"], "alpha")
# Oxford-IIIT Pet: cats and dogs at home, trimaps (1 pet, 2 background, 3 unsure); 50 cats, 50 dogs.
ann = tarfile.open(os.path.join(D, "pets/annotations.tar.gz")); img = tarfile.open(os.path.join(D, "pets/images.tar.gz"))
names = [l.split() for l in ann.extractfile("annotations/list.txt").read().decode().splitlines() if not l.startswith("#")]
for species, cat in (("1", "cat"), ("2", "dog")):
    for n in sorted(rnd.sample([x[0] for x in names if x[2] == species], 50)):
        tri = Image.open(io.BytesIO(ann.extractfile("annotations/trimaps/%s.png" % n).read()))
        d = os.path.join(P, "pets"); os.makedirs(d, exist_ok=True)
        open(os.path.join(d, n + ".jpg"), "wb").write(img.extractfile("images/%s.jpg" % n).read())
        tri.save(os.path.join(d, n + ".gt.png"))  # values 1..3 kept as they are
        rows.append({"id": "pets-" + n, "set": "pets", "cat": cat, "image": "photos/pets/%s.jpg" % n, "gt": "photos/pets/%s.gt.png" % n, "gtKind": "trimap"})
# COCO val2017: everyday scenes where one annotated thing clearly dominates. Masks are coarse polygons.
# gt = the biggest instance; gt2 = it plus every other instance at least a fifth its size (a rider and the motorcycle).
c = json.load(zipfile.ZipFile(os.path.join(D, "coco/ann.zip")).open("annotations/instances_val2017.json"))
cats = {x["id"]: x["name"] for x in c["categories"]}; by = {}
for a in c["annotations"]: by.setdefault(a["image_id"], []).append(a)
GROUPS = {"vehicle": (["car"] * 3 + ["truck", "motorcycle", "bicycle", "bus"], 50), "person": (["person"], 50),
          "object": ("bottle cup teddy bear,vase,laptop,chair,couch,clock,backpack,handbag,suitcase,umbrella,cake,potted plant,bench,fire hydrant,skateboard,surfboard,tv,cell phone,book,bowl,donut,pizza".replace(" teddy bear", ",teddy bear").replace("bottle cup", "bottle,cup").split(","), 50)}
pool = {}
for im in c["images"]:
    a = by.get(im["id"], [])
    if not a or any(x["iscrowd"] for x in a): continue
    a.sort(key=lambda x: -x["area"]); area = im["width"] * im["height"]
    if not 0.08 <= a[0]["area"] / area <= 0.7: continue
    if len(a) > 1 and a[1]["area"] > 0.6 * a[0]["area"]: continue  # no clear main subject
    pool.setdefault(cats[a[0]["category_id"]], []).append((im, a))
def poly(im, anns):
    m = Image.new("L", (im["width"], im["height"]), 0); d = ImageDraw.Draw(m)
    for a in anns:
        for p in a["segmentation"]: d.polygon(p, fill=255)
    return m
os.makedirs(os.path.join(D, "coco/img"), exist_ok=True)
for g, (names_, count) in GROUPS.items():
    picked = []; order = {n: rnd.sample(pool.get(n, []), len(pool.get(n, []))) for n in set(names_)}
    while len(picked) < count:
        n = rnd.choice(names_)
        if order[n]: picked.append((n, order[n].pop()))
    for n, (im, a) in picked:
        f = os.path.join(D, "coco/img", im["file_name"])
        if not os.path.exists(f): urllib.request.urlretrieve("http://images.cocodataset.org/val2017/" + im["file_name"], f)
        put("coco", g + ": " + n if g != "person" else "person", im["file_name"][:-4], open(f, "rb").read(), poly(im, a[:1]), "coarse",
            poly(im, [x for x in a if x["area"] >= 0.2 * a[0]["area"]]))
open(os.path.join(W, "manifest.jsonl"), "w").write("".join(json.dumps(r) + "\n" for r in rows))
print(len(rows), "photos"); import collections; print(collections.Counter(r["set"] for r in rows))
