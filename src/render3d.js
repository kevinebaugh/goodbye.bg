// Photoreal product previews for the ad cards: the visitor's own cut-out on a mug, sticker, tote or t-shirt,
// rendered in 3D (Three.js, MIT) with physical materials, studio reflections and a soft shadow. Bundled with
// Three.js into render3d.mjs at build time and loaded only when ads show. Runs on the device: nothing leaves it.
//
// One WebGL context for all cards: each product renders offscreen and is copied into the card's canvas.
import {
  ACESFilmicToneMapping, Box3, CanvasTexture, CatmullRomCurve3, Color, CylinderGeometry, DataTexture, DirectionalLight,
  DoubleSide, Group, LatheGeometry, LinearMipmapLinearFilter, Mesh, MeshBasicMaterial, MeshPhysicalMaterial,
  MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, PMREMGenerator,
  CircleGeometry, RepeatWrapping, RGBAFormat, Scene, SRGBColorSpace, TorusGeometry, TubeGeometry, Vector2, Vector3,
  WebGLRenderer,
} from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

let renderer = null, envMap = null, weave = null;

function setup() {
  if (renderer) return;
  // A normal (unattached) canvas: Safari copies an OffscreenCanvas WebGL drawing without its transparency and
  // at the wrong size (dark floors, squashed products on iPhone).
  const canvas = document.createElement("canvas");
  renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: true });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const pmrem = new PMREMGenerator(renderer);
  envMap = pmrem.fromScene(new RoomEnvironment(), 0.03).texture;
  pmrem.dispose();
  weave = weaveNormalMap();
}

// A woven-fabric normal map, made here (no image to download): tiny alternating bumps of warp and weft.
function weaveNormalMap() {
  const n = 64, data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const warp = Math.sin((x / n) * Math.PI * 16), weft = Math.sin((y / n) * Math.PI * 16), over = ((x >> 2) + (y >> 2)) % 2;
    const nx = (over ? warp : 0) * 0.35, ny = (over ? 0 : weft) * 0.35, i = (y * n + x) * 4;
    data[i] = 128 + nx * 127; data[i + 1] = 128 + ny * 127; data[i + 2] = 255; data[i + 3] = 255;
  }
  const t = new DataTexture(data, n, n, RGBAFormat);
  t.wrapS = t.wrapT = RepeatWrapping; t.needsUpdate = true;
  return t;
}

// Smooth noise for folds and wrinkles.
function noise2(x, y) {
  const s = (a, b) => { const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return v - Math.floor(v); };
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = s(xi, yi), b = s(xi + 1, yi), c = s(xi, yi + 1), d = s(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function texture(src) {
  const t = new CanvasTexture(src);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  t.minFilter = LinearMipmapLinearFilter;
  return t;
}

// The cut-out with a border that follows its outline (a die-cut), as a canvas. `fill` colours the border.
function dieCut(art, border = 0.06, fill = "#fbfbf8") {
  const pad = Math.round(Math.max(art.width, art.height) * border), w = art.width + pad * 2, h = art.height + pad * 2;
  const c = new OffscreenCanvas(w, h), x = c.getContext("2d");
  for (let i = 0; i < 32; i++) { const t = (i / 32) * Math.PI * 2; x.drawImage(art, pad + Math.cos(t) * pad * 0.8, pad + Math.sin(t) * pad * 0.8); }
  x.globalCompositeOperation = "source-in"; x.fillStyle = fill; x.fillRect(0, 0, w, h);
  x.globalCompositeOperation = "source-over"; x.drawImage(art, pad, pad);
  return c;
}

// Fit art (aspect) inside maxW x maxH.
function fit(art, maxW, maxH) { const a = art.width / art.height; let w = maxW, h = w / a; if (h > maxH) { h = maxH; w = h * a; } return [w, h]; }

// A print material that shows the art only inside its UV square (the rest of the surface stays bare).
function inkMaterial(art, opts) {
  const m = new MeshStandardMaterial({ map: texture(art), transparent: true, alphaTest: 0.02, ...opts });
  m.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace("#include <map_fragment>", "#include <map_fragment>\nif (vMapUv.x < 0.0 || vMapUv.x > 1.0 || vMapUv.y < 0.0 || vMapUv.y > 1.0) discard;"); };
  return m;
}

// A studio: key light from the front left above, a shadow-catching floor, the environment for reflections.
function studio(floorY = 0, shadow = 0.3) {
  const scene = new Scene();
  scene.environment = envMap;
  const key = new DirectionalLight(0xffffff, 1.6);
  key.position.set(-3, 6, 4);
  scene.add(key);
  scene.userData.floor = { y: floorY, opacity: shadow }; // render() lays a soft shadow here once the product is built
  return scene;
}

// Frame `box` (centre and half sizes in world units) in a camera looking from `dir`, filling `fill` of the canvas.
function camera(w, h, target, halfW, halfH, dir, fill = 0.92) {
  const cam = new PerspectiveCamera(26, w / h, 0.1, 100);
  const fov = (cam.fov * Math.PI) / 180, needH = halfH / fill, needW = halfW / fill / cam.aspect;
  const dist = Math.max(needH, needW) / Math.tan(fov / 2) + 1;
  cam.position.copy(target).add(dir.clone().normalize().multiplyScalar(dist));
  cam.lookAt(target);
  return cam;
}

// ---------- mug: a lathe-turned 11 oz mug with a real handle, the print wrapped around the front ----------
function mug(art, dark) {
  const R = 1, H = 2.3, wall = 0.075, scene = studio(0, dark ? 0.45 : 0.28), g = new Group();
  const glaze = new MeshPhysicalMaterial({
    color: new Color(dark ? 0x17191a : 0xf7f7f5), roughness: dark ? 0.3 : 0.18, clearcoat: 1, clearcoatRoughness: 0.06,
    envMapIntensity: dark ? 1.1 : 0.9,
  });
  // Profile: base with a rounded foot, straight wall, rounded lip, inner wall and floor.
  const p = [];
  p.push(new Vector2(0, 0.0), new Vector2(R * 0.82, 0.0), new Vector2(R * 0.95, 0.02), new Vector2(R * 0.995, 0.08));
  for (let i = 0; i <= 10; i++) p.push(new Vector2(R, 0.1 + ((H - 0.16) * i) / 10));
  for (let i = 0; i <= 6; i++) { const t = (i / 6) * Math.PI; p.push(new Vector2(R - wall / 2 + (Math.cos(t) * wall) / 2, H - 0.06 + Math.sin(t) * 0.05)); }
  p.push(new Vector2(R - wall, H - 0.1), new Vector2(R - wall, 0.22), new Vector2(R - wall - 0.06, 0.17), new Vector2(0, 0.16));
  const body = new Mesh(new LatheGeometry(p, 128), glaze);
  g.add(body);
  // Handle: a C of oval cross-section on the right, its ends sunk into the wall.
  const curve = new CatmullRomCurve3([
    new Vector3(R - 0.05, H * 0.8, 0), new Vector3(R + 0.42, H * 0.82, 0), new Vector3(R + 0.66, H * 0.6, 0),
    new Vector3(R + 0.62, H * 0.36, 0), new Vector3(R + 0.36, H * 0.22, 0), new Vector3(R - 0.05, H * 0.24, 0),
  ]);
  const handle = new Mesh(new TubeGeometry(curve, 80, 0.11, 24, false), glaze);
  handle.scale.z = 0.72;
  g.add(handle);
  // Print: a slightly larger open cylinder segment facing the camera, the art as its colour, glazed over.
  const aspect = art.width / art.height, maxH = H * 0.66, maxArc = Math.PI * 0.95 * R;
  let ph = maxH, arc = ph * aspect;
  if (arc > maxArc) { arc = maxArc; ph = arc / aspect; }
  const L = arc / R, printMat = new MeshPhysicalMaterial({
    map: texture(art), transparent: true, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.06,
    polygonOffset: true, polygonOffsetFactor: -2, depthWrite: false,
  });
  const print = new Mesh(new CylinderGeometry(R + 0.002, R + 0.002, ph, 128, 1, true, -L / 2, L), printMat);
  print.position.y = 0.1 + (H - 0.16) / 2;
  g.add(print);
  g.rotation.y = -0.18; // a quarter-turn hint, so the handle reads as 3D
  scene.add(g);
  // Centre the camera on the body (not body + handle): the handle hangs off to the side.
  return { scene, target: new Vector3(0, H * 0.48, 0), halfW: R * 1.75, halfH: H * 0.62, dir: new Vector3(0, 0.55, 1) };
}

// ---------- sticker: die-cut vinyl with a white border, lying on the floor with one corner lifting ----------
function sticker(art, dark) {
  // The die-cut art: cut-out plus a white border following its outline (built in 2D, then mapped onto vinyl).
  const c = dieCut(art), w = c.width, h = c.height;
  const map = texture(c), scene = studio(0, dark ? 0.5 : 0.3);
  const S = 2.6, sw = (S * w) / Math.max(w, h), sh = (S * h) / Math.max(w, h);
  const geo = new PlaneGeometry(sw, sh, 48, 48), pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) { // the bottom-right corner peels up a little
    const u = pos.getX(i) / sw + 0.5, v = 0.5 - pos.getY(i) / sh, lift = Math.max(0, u + v - 1.35);
    pos.setZ(i, lift * lift * 1.4);
  }
  geo.computeVertexNormals();
  const vinyl = new MeshPhysicalMaterial({ map, alphaTest: 0.5, side: DoubleSide, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.12 });
  const m = new Mesh(geo, vinyl);
  m.rotation.x = -Math.PI / 2; m.rotation.z = 0.12; m.position.y = 0.01;
  scene.add(m);
  return { scene, target: new Vector3(0, 0, 0), halfW: S * 0.62, halfH: S * 0.5, dir: new Vector3(0, 2.2, 1.1) };
}

// ---------- tote: a canvas bag with a little body to it, straps front and back, the print on the front ----------
function tote(art, dark) {
  const W = 1.7, H = 1.8, scene = studio(-H / 2 - 0.02, dark ? 0.45 : 0.25), g = new Group();
  const cloth = new MeshStandardMaterial({ color: new Color(dark ? 0x2a2f31 : 0xe9e0cb), roughness: 0.95, normalMap: weave, normalScale: new Vector2(0.5, 0.5), side: DoubleSide });
  weave.repeat.set(10, 10);
  const panel = (z, sign) => {
    const geo = new PlaneGeometry(W, H, 60, 60), pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i) / (W / 2), py = pos.getY(i) / (H / 2);
      const bulge = 0.09 * (1 - px * px) * (1 - Math.max(0, py) ** 2 * 0.7);
      const wrinkle = (noise2(px * 3 + 7, py * 4) - 0.5) * 0.03 + (noise2(px * 9, py * 9 + 3) - 0.5) * 0.008;
      pos.setZ(i, z + sign * (bulge + wrinkle));
    }
    geo.computeVertexNormals();
    return geo;
  };
  const front = panel(0.05, 1), back = panel(-0.05, -1);
  g.add(new Mesh(front, cloth), new Mesh(back, cloth));
  // Print: the same front surface, a hair forward, with the art (ink sits in the weave: rough, a touch of bump).
  const [pw, ph] = fit(art, W * 0.72, H * 0.66);
  const pgeo = front.clone(), ppos = pgeo.attributes.position, uv = pgeo.attributes.uv;
  for (let i = 0; i < ppos.count; i++) {
    ppos.setZ(i, ppos.getZ(i) + 0.003);
    uv.setXY(i, (ppos.getX(i) + pw / 2) / pw, (ppos.getY(i) + 0.04 + ph / 2) / ph);
  }
  g.add(new Mesh(pgeo, inkMaterial(art, { roughness: 0.9, normalMap: weave, normalScale: new Vector2(0.3, 0.3) })));
  // Straps: flat bands rising from the top hem, one on the front, one on the back.
  const strap = (z, rise) => {
    const curve = new CatmullRomCurve3([
      new Vector3(-0.42, H / 2 - 0.12, z), new Vector3(-0.4, H / 2 + rise * 0.7, z), new Vector3(0, H / 2 + rise, z),
      new Vector3(0.4, H / 2 + rise * 0.7, z), new Vector3(0.42, H / 2 - 0.12, z),
    ]);
    const m = new Mesh(new TubeGeometry(curve, 64, 0.05, 12, false), cloth);
    m.scale.z = 0.35;
    return m;
  };
  g.add(strap(0.06, 0.95), strap(-0.06, 1.05));
  g.rotation.y = 0.22;
  scene.add(g);
  return { scene, target: new Vector3(0, 0.5, 0), halfW: W * 0.6, halfH: 1.62, dir: new Vector3(0, 0.25, 1) }; // bag + straps
}

// ---------- t-shirt: laid flat on the floor, soft folds, the print on the chest ----------
function shirt(art, dark) {
  const S = 3, scene = studio(0, dark ? 0.5 : 0.28);
  // The silhouette as an alpha mask on a finely divided sheet, so folds can bend it.
  const n = 512, m = new OffscreenCanvas(n, n), x = m.getContext("2d"), P = (u, v) => [u * n, v * n];
  x.fillStyle = "#fff"; x.beginPath(); x.moveTo(...P(0.37, 0.04)); x.quadraticCurveTo(...P(0.5, 0.14), ...P(0.63, 0.04));
  for (const [u, v] of [[0.84, 0.1], [1, 0.32], [0.87, 0.41], [0.79, 0.33], [0.79, 0.97], [0.21, 0.97], [0.21, 0.33], [0.13, 0.41], [0, 0.32], [0.16, 0.1]]) x.lineTo(...P(u, v));
  x.closePath(); x.fill();
  const mask = new CanvasTexture(m);
  const geo = new PlaneGeometry(S, S, 90, 90), pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i) / S, v = pos.getY(i) / S;
    pos.setZ(i, (noise2(u * 4 + 2, v * 3) - 0.5) * 0.09 + (noise2(u * 10, v * 10 + 5) - 0.5) * 0.02 + Math.exp(-((u - 0.18) ** 2) * 60) * 0.03);
  }
  geo.computeVertexNormals();
  weave.repeat.set(14, 14);
  const fabric = new MeshStandardMaterial({ color: new Color(dark ? 0x1b1e1f : 0xf6f6f3), alphaMap: mask, alphaTest: 0.5, roughness: 0.92, normalMap: weave, normalScale: new Vector2(0.45, 0.45), side: DoubleSide });
  const tee = new Mesh(geo, fabric);
  // Print on the chest: same folded sheet, a hair above it, UVs covering only the chest area.
  const [pw, ph] = fit(art, 0.48, 0.5);
  const top = 0.18; // from the collar down, as a fraction of the sheet
  const pgeo = geo.clone(), ppos = pgeo.attributes.position, uv = pgeo.attributes.uv;
  for (let i = 0; i < ppos.count; i++) {
    const u = ppos.getX(i) / S + 0.5, v = 0.5 - ppos.getY(i) / S;
    ppos.setZ(i, ppos.getZ(i) + 0.004);
    uv.setXY(i, (u - (0.5 - pw / 2)) / pw, 1 - (v - top) / ph);
  }
  const print = new Mesh(pgeo, inkMaterial(art, { roughness: 0.85, normalMap: weave, normalScale: new Vector2(0.25, 0.25) }));
  const g = new Group(); g.add(tee, print);
  g.rotation.x = -Math.PI / 2; g.rotation.z = 0.06; g.position.y = 0.06;
  scene.add(g);
  return { scene, target: new Vector3(0, 0, 0.05), halfW: S * 0.5, halfH: S * 0.5, dir: new Vector3(0, 2.6, 0.9) };
}

// ---------- ornament: a glossy porcelain disc on a gold cap, hung from a satin ribbon ----------
function ornament(art, dark) {
  const R = 1, T = 0.09, scene = studio(-1.6, dark ? 0.35 : 0.18), g = new Group();
  const porcelain = new MeshPhysicalMaterial({ color: 0xfbfbf8, roughness: 0.14, clearcoat: 1, clearcoatRoughness: 0.04 });
  const gold = new MeshPhysicalMaterial({ color: 0xd8b25a, metalness: 1, roughness: 0.28 });
  const disc = new Mesh(new CylinderGeometry(R, R, T, 96), porcelain); disc.rotation.x = Math.PI / 2;
  g.add(disc);
  // The print, fitted inside the circle.
  const [pw, ph] = fit(art, R * 1.45, R * 1.45), side = Math.max(pw, ph) * 1.0;
  const sq = new OffscreenCanvas(512, 512), sx = sq.getContext("2d"), k = 512 / side;
  sx.drawImage(art, (512 - pw * k) / 2, (512 - ph * k) / 2, pw * k, ph * k);
  const face = new Mesh(new CircleGeometry(side / 2, 96), new MeshPhysicalMaterial({ map: texture(sq), transparent: true, roughness: 0.16, clearcoat: 1, clearcoatRoughness: 0.04, polygonOffset: true, polygonOffsetFactor: -2 }));
  face.position.z = T / 2 + 0.001;
  g.add(face);
  const cap = new Mesh(new CylinderGeometry(0.15, 0.17, 0.16, 32), gold); cap.position.y = R + 0.05;
  const loop = new Mesh(new TorusGeometry(0.07, 0.018, 12, 32), gold); loop.position.y = R + 0.17;
  const ribbon = new Mesh(new TubeGeometry(new CatmullRomCurve3([
    new Vector3(0, R + 0.18, 0), new Vector3(-0.22, R + 0.55, 0), new Vector3(0, R + 0.85, 0), new Vector3(0.22, R + 0.55, 0), new Vector3(0, R + 0.18, 0),
  ], true), 64, 0.035, 8, true), new MeshPhysicalMaterial({ color: 0x1f6f7a, roughness: 0.35, sheen: 1, sheenColor: new Color(0x8fd3dc) }));
  ribbon.scale.z = 0.3;
  g.add(cap, loop, ribbon);
  g.rotation.y = 0.32;
  scene.add(g);
  return { scene, target: new Vector3(0, 0.3, 0), halfW: 1.2, halfH: 1.6, dir: new Vector3(0, 0.12, 1) };
}

// ---------- phone case: a glossy case standing at an angle, camera bump, the cut-out on the back ----------
function phonecase(art, dark) {
  const W = 0.78, H = 1.62, D = 0.1, scene = studio(-H / 2, dark ? 0.45 : 0.25), g = new Group();
  const shell = new MeshPhysicalMaterial({ color: new Color(dark ? 0x1a1c1d : 0xf4f4f1), roughness: 0.22, clearcoat: 0.8, clearcoatRoughness: 0.08 });
  g.add(new Mesh(new RoundedBoxGeometry(W, H, D, 8, 0.11), shell));
  const [pw, ph] = fit(art, W * 0.86, H * 0.62);
  const back = new Mesh(new PlaneGeometry(pw, ph), new MeshPhysicalMaterial({ map: texture(art), transparent: true, roughness: 0.2, clearcoat: 0.8, polygonOffset: true, polygonOffsetFactor: -2 }));
  back.position.set(0, -H * 0.08, D / 2 + 0.001);
  g.add(back);
  // Camera bump with three lenses.
  const bump = new Mesh(new RoundedBoxGeometry(0.34, 0.34, 0.05, 6, 0.08), shell);
  bump.position.set(-W / 2 + 0.24, H / 2 - 0.24, D / 2 + 0.02);
  g.add(bump);
  const glass = new MeshPhysicalMaterial({ color: 0x0b0d0e, roughness: 0.04, metalness: 0.3, clearcoat: 1 });
  const ring = new MeshPhysicalMaterial({ color: 0xb8bcbf, metalness: 1, roughness: 0.25 });
  for (const [x, y] of [[-0.075, 0.075], [-0.075, -0.075], [0.08, 0]]) {
    const r = new Mesh(new CylinderGeometry(0.062, 0.062, 0.03, 32), ring); r.rotation.x = Math.PI / 2;
    const l = new Mesh(new CylinderGeometry(0.048, 0.048, 0.034, 32), glass); l.rotation.x = Math.PI / 2;
    r.position.set(bump.position.x + x, bump.position.y + y, D / 2 + 0.05); l.position.copy(r.position); l.position.z += 0.002;
    g.add(r, l);
  }
  g.rotation.set(-0.06, -0.42, 0.05);
  scene.add(g);
  return { scene, target: new Vector3(0, 0, 0), halfW: 0.75, halfH: H * 0.56, dir: new Vector3(0, 0.15, 1) };
}

// ---------- throw pillow: a plump square cushion, corners pinched, woven fabric, the cut-out on the front ----------
function pillow(art, dark) {
  const S = 2, scene = studio(-S / 2 + 0.05, dark ? 0.45 : 0.25), g = new Group();
  weave.repeat.set(12, 12);
  const fabric = new MeshStandardMaterial({ color: new Color(dark ? 0x2a2f31 : 0xece6da), roughness: 0.96, normalMap: weave, normalScale: new Vector2(0.45, 0.45), side: DoubleSide });
  const half = (sign) => {
    const geo = new PlaneGeometry(S, S, 70, 70), pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const u = pos.getX(i) / (S / 2), v = pos.getY(i) / (S / 2);
      const puff = 0.46 * (1 - u ** 4) * (1 - v ** 4), wr = (noise2(u * 3 + 4, v * 3) - 0.5) * 0.035;
      pos.setX(i, pos.getX(i) * (1 - 0.06 * (1 - v * v))); pos.setY(i, pos.getY(i) * (1 - 0.06 * (1 - u * u))); // edges bow in
      pos.setZ(i, sign * (puff + wr));
    }
    geo.computeVertexNormals();
    return geo;
  };
  const front = half(1);
  g.add(new Mesh(front, fabric), new Mesh(half(-1), fabric));
  const [pw, ph] = fit(art, S * 0.62, S * 0.62), pgeo = front.clone(), pp = pgeo.attributes.position, uv = pgeo.attributes.uv;
  for (let i = 0; i < pp.count; i++) { pp.setZ(i, pp.getZ(i) + 0.003); uv.setXY(i, (pp.getX(i) + pw / 2) / pw, (pp.getY(i) + ph / 2) / ph); }
  g.add(new Mesh(pgeo, inkMaterial(art, { roughness: 0.9, normalMap: weave, normalScale: new Vector2(0.3, 0.3) })));
  g.rotation.set(-0.1, 0.42, 0.03); // turned a little, so its plumpness and pinched corners show
  scene.add(g);
  // Centred on what the camera sees (the turned pillow's box), not its pivot, so it sits in the middle of the card.
  g.updateMatrixWorld(true);
  const target = new Box3().setFromObject(g).getCenter(new Vector3());
  return { scene, target, halfW: S * 0.58, halfH: S * 0.58, dir: new Vector3(0, 0.3, 1) };
}

// ---------- keychain: a die-cut clear acrylic charm on a steel ring ----------
function keychain(art, dark) {
  const scene = studio(-1.5, dark ? 0.35 : 0.18), g = new Group();
  // Clear acrylic border (faintly frosted) around the cut-out, with a tab and hole for the ring.
  const cut = dieCut(art, 0.07, "rgba(235,242,245,0.42)"), w = cut.width, h = cut.height, tab = Math.round(Math.max(w, h) * 0.09);
  const c = new OffscreenCanvas(w, h + tab * 2), x = c.getContext("2d");
  x.drawImage(cut, 0, tab * 2);
  x.fillStyle = "rgba(235,242,245,0.42)"; x.beginPath(); x.arc(w / 2, tab * 1.5, tab * 1.1, 0, Math.PI * 2); x.fill();
  x.globalCompositeOperation = "destination-out"; x.beginPath(); x.arc(w / 2, tab * 1.4, tab * 0.42, 0, Math.PI * 2); x.fill();
  const S = 2.3, cw = (S * c.width) / Math.max(c.width, c.height), ch = (S * c.height) / Math.max(c.width, c.height);
  const acrylic = (z) => {
    const m = new Mesh(new PlaneGeometry(cw, ch), new MeshPhysicalMaterial({ map: texture(c), transparent: true, alphaTest: 0.05, roughness: 0.03, clearcoat: 1, clearcoatRoughness: 0.02, side: DoubleSide }));
    m.position.z = z; return m;
  };
  g.add(acrylic(0.025), acrylic(-0.025));
  const steel = new MeshPhysicalMaterial({ color: 0xc9cdd0, metalness: 1, roughness: 0.18 });
  const holeY = ch / 2 - (tab * 1.4 / c.height) * ch;
  const ring = new Mesh(new TorusGeometry(0.3, 0.03, 16, 64), steel); ring.rotation.y = Math.PI / 2; ring.position.set(0, holeY + 0.27, 0);
  g.add(ring);
  g.rotation.set(0, 0.3, 0.05);
  scene.add(g);
  return { scene, target: new Vector3(0, 0.15, 0), halfW: cw * 0.62, halfH: ch * 0.62 + 0.15, dir: new Vector3(0, 0.12, 1) };
}

const MAKERS = { mug, sticker, tote, shirt, ornament, phonecase, pillow, keychain };

// Render `kind` with the visitor's cut-out `art` into the 2D canvas `out` (sized by CSS).
// A soft shadow on the floor under the product: a blurred ellipse, nudged away from the key light. Not a shadow
// map: on iPhones the shadow-map test failed and darkened the whole floor into a slab behind the product.
let blobTex = null;
function groundShadow(scene) {
  const f = scene.userData.floor;
  if (!f) return;
  const box = new Box3().setFromObject(scene), size = box.getSize(new Vector3()), mid = box.getCenter(new Vector3());
  if (!blobTex) {
    const c = document.createElement("canvas"); c.width = c.height = 128;
    const x = c.getContext("2d"), g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, "rgba(0,0,0,1)"); g.addColorStop(0.45, "rgba(0,0,0,.55)"); g.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    blobTex = new CanvasTexture(c);
  }
  const blob = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ color: 0x000000, map: blobTex, transparent: true, opacity: f.opacity * 1.6, depthWrite: false, toneMapped: false }));
  blob.userData.shared = true;
  blob.rotation.x = -Math.PI / 2;
  const flat = size.y < 0.3 * Math.max(size.x, size.z), grow = flat ? 1.06 : 1.3; // lying flat: a tight edge, not a halo
  blob.scale.set(Math.max(0.6, size.x * grow), Math.max(0.5, size.z * grow), 1);
  if (flat) blob.material.opacity = f.opacity;
  blob.position.set(mid.x + 0.12, f.y + 0.002, mid.z - 0.06);
  blob.renderOrder = -1;
  scene.add(blob);
}

export function render(kind, out, art, dark) {
  setup();
  const k = Math.min(2, self.devicePixelRatio || 1), w = Math.max(1, Math.round((out.clientWidth || 200) * k)), h = Math.max(1, Math.round((out.clientHeight || 150) * k));
  const made = MAKERS[kind](art, dark);
  groundShadow(made.scene);
  const cam = camera(w, h, made.target, made.halfW, made.halfH, made.dir);
  renderer.setSize(w, h, false);
  renderer.render(made.scene, cam);
  out.width = w; out.height = h;
  const o = out.getContext("2d"); o.clearRect(0, 0, w, h);
  o.drawImage(renderer.domElement, 0, 0, w, h, 0, 0, w, h);
  made.scene.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); for (const m of [].concat(o.material)) { if (!o.userData.shared) m.map?.dispose(); m.alphaMap?.dispose(); m.dispose(); } } });
}
