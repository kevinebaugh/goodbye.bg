// Photoreal product previews for the ad cards: the visitor's own cut-out on a mug, sticker, tote or t-shirt,
// rendered in 3D (Three.js, MIT) with physical materials, studio reflections and a soft shadow. Bundled with
// Three.js into render3d.mjs at build time and loaded only when ads show. Runs on the device: nothing leaves it.
//
// One WebGL context for all cards: each product renders offscreen and is copied into the card's canvas.
import {
  ACESFilmicToneMapping, CanvasTexture, CatmullRomCurve3, Color, CylinderGeometry, DataTexture, DirectionalLight,
  DoubleSide, Group, LatheGeometry, LinearMipmapLinearFilter, Mesh, MeshDepthMaterial, MeshPhysicalMaterial,
  MeshStandardMaterial, PCFSoftShadowMap, PerspectiveCamera, PlaneGeometry, PMREMGenerator, RGBADepthPacking,
  RepeatWrapping, RGBAFormat, Scene, ShadowMaterial, SRGBColorSpace, TorusGeometry, TubeGeometry, Vector2, Vector3,
  WebGLRenderer,
} from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

let renderer = null, envMap = null, weave = null;

function setup() {
  if (renderer) return;
  const canvas = new OffscreenCanvas(16, 16);
  renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
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

// A studio: key light from the front left above, a shadow-catching floor, the environment for reflections.
function studio(floorY = 0, shadow = 0.3) {
  const scene = new Scene();
  scene.environment = envMap;
  const key = new DirectionalLight(0xffffff, 1.6);
  key.position.set(-3, 6, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.radius = 6;
  key.shadow.bias = -0.0004;
  Object.assign(key.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 0.5, far: 20 });
  scene.add(key);
  const floor = new Mesh(new PlaneGeometry(30, 30), new ShadowMaterial({ opacity: shadow }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = floorY; floor.receiveShadow = true;
  scene.add(floor);
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

function castAll(group) { group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); }

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
  castAll(g); print.castShadow = false;
  g.rotation.y = -0.18; // a quarter-turn hint, so the handle reads as 3D
  scene.add(g);
  // Centre the camera on the body (not body + handle): the handle hangs off to the side.
  return { scene, target: new Vector3(0, H * 0.48, 0), halfW: R * 1.75, halfH: H * 0.62, dir: new Vector3(0, 0.55, 1) };
}

// ---------- sticker: die-cut vinyl with a white border, lying on the floor with one corner lifting ----------
function sticker(art, dark) {
  // The die-cut art: cut-out plus a white border following its outline (built in 2D, then mapped onto vinyl).
  const pad = Math.round(Math.max(art.width, art.height) * 0.06), w = art.width + pad * 2, h = art.height + pad * 2;
  const c = new OffscreenCanvas(w, h), x = c.getContext("2d");
  for (let i = 0; i < 32; i++) { const t = (i / 32) * Math.PI * 2; x.drawImage(art, pad + Math.cos(t) * pad * 0.8, pad + Math.sin(t) * pad * 0.8); }
  x.globalCompositeOperation = "source-in"; x.fillStyle = "#fbfbf8"; x.fillRect(0, 0, w, h);
  x.globalCompositeOperation = "source-over"; x.drawImage(art, pad, pad);
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
  m.customDepthMaterial = new MeshDepthMaterial({ depthPacking: RGBADepthPacking, map, alphaTest: 0.5 });
  m.rotation.x = -Math.PI / 2; m.rotation.z = 0.12; m.position.y = 0.01;
  m.castShadow = true;
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
  const aspect = art.width / art.height, maxW = W * 0.72, maxH = H * 0.66;
  let pw = maxW, ph = pw / aspect; if (ph > maxH) { ph = maxH; pw = ph * aspect; }
  const pgeo = front.clone(), ppos = pgeo.attributes.position, uv = pgeo.attributes.uv;
  for (let i = 0; i < ppos.count; i++) {
    ppos.setZ(i, ppos.getZ(i) + 0.003);
    uv.setXY(i, (ppos.getX(i) + pw / 2) / pw, (ppos.getY(i) + 0.04 + ph / 2) / ph);
  }
  const ink = texture(art); ink.wrapS = ink.wrapT = 1001; // clamp: ClampToEdgeWrapping
  const printMat = new MeshStandardMaterial({ map: ink, transparent: true, alphaTest: 0.02, roughness: 0.9, normalMap: weave, normalScale: new Vector2(0.3, 0.3) });
  printMat.onBeforeCompile = (s) => { // only inside the print rectangle
    s.fragmentShader = s.fragmentShader.replace("#include <map_fragment>", "#include <map_fragment>\nif (vMapUv.x < 0.0 || vMapUv.x > 1.0 || vMapUv.y < 0.0 || vMapUv.y > 1.0) discard;");
  };
  g.add(new Mesh(pgeo, printMat));
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
  castAll(g);
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
  tee.customDepthMaterial = new MeshDepthMaterial({ depthPacking: RGBADepthPacking, alphaMap: mask, alphaTest: 0.5 });
  // Print on the chest: same folded sheet, a hair above it, UVs covering only the chest area.
  const aspect = art.width / art.height, maxW = 0.48, maxH = 0.5;
  let pw = maxW, ph = pw / aspect; if (ph > maxH) { ph = maxH; pw = ph * aspect; }
  const top = 0.18; // from the collar down, as a fraction of the sheet
  const pgeo = geo.clone(), ppos = pgeo.attributes.position, uv = pgeo.attributes.uv;
  for (let i = 0; i < ppos.count; i++) {
    const u = ppos.getX(i) / S + 0.5, v = 0.5 - ppos.getY(i) / S;
    ppos.setZ(i, ppos.getZ(i) + 0.004);
    uv.setXY(i, (u - (0.5 - pw / 2)) / pw, 1 - (v - top) / ph);
  }
  const printMat = new MeshStandardMaterial({ map: texture(art), transparent: true, alphaTest: 0.02, roughness: 0.85, normalMap: weave, normalScale: new Vector2(0.25, 0.25) });
  printMat.onBeforeCompile = (s) => {
    s.fragmentShader = s.fragmentShader.replace("#include <map_fragment>", "#include <map_fragment>\nif (vMapUv.x < 0.0 || vMapUv.x > 1.0 || vMapUv.y < 0.0 || vMapUv.y > 1.0) discard;");
  };
  const print = new Mesh(pgeo, printMat);
  const g = new Group(); g.add(tee, print);
  g.rotation.x = -Math.PI / 2; g.rotation.z = 0.06; g.position.y = 0.06;
  tee.castShadow = true; tee.receiveShadow = true; print.receiveShadow = true;
  scene.add(g);
  return { scene, target: new Vector3(0, 0, 0.05), halfW: S * 0.5, halfH: S * 0.5, dir: new Vector3(0, 2.6, 0.9) };
}

const MAKERS = { mug, sticker, tote, shirt };

// Render `kind` with the visitor's cut-out `art` into the 2D canvas `out` (sized by CSS).
export function render(kind, out, art, dark) {
  setup();
  const k = Math.min(2, self.devicePixelRatio || 1), w = Math.max(1, Math.round((out.clientWidth || 200) * k)), h = Math.max(1, Math.round((out.clientHeight || 150) * k));
  const made = MAKERS[kind](art, dark), cam = camera(w, h, made.target, made.halfW, made.halfH, made.dir);
  renderer.setSize(w, h, false);
  renderer.render(made.scene, cam);
  out.width = w; out.height = h;
  out.getContext("2d").drawImage(renderer.domElement, 0, 0);
  made.scene.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); for (const m of [].concat(o.material)) { m.map?.dispose(); m.alphaMap?.dispose(); m.dispose(); } } });
}
