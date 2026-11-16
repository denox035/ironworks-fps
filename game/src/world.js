// IRONWORKS map: a decommissioned iron foundry at dusk.
// Units are metres. x runs west(-) to east(+), z north(-) to south(+), y up.
// Ember spawns west, Anvil spawns east. Site A (Furnace Hall) north-east,
// Site B (Crane Yard) south-east. Three lanes: Foundry Floor (mid),
// Catwalk (north, long sightline), Service Tunnel (south, tight corners).
// Every solid is a box: the mesh and the collider come from the same entry,
// so what you see is what blocks movement, sight and bullets.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { segBox } from './util.js';

// [cx, cz, w, d, h, materialKey] — boxes sit on the floor (base y = 0).
const BOXES = [
  // perimeter (h 6)
  [0, -22.5, 62, 1, 6, 'wall'], [0, 22.5, 62, 1, 6, 'wall'],
  [-30.5, 0, 1, 46, 6, 'wall'], [30.5, 0, 1, 46, 6, 'wall'],
  // Site A — Furnace Hall: the furnace body + chimney base
  [22, -14, 6, 8, 5, 'furnace'], [22, -18, 2.5, 2.5, 8, 'wallDark'],
  [14, -10, 2.2, 2.2, 1.2, 'crate'], [15.5, -18.5, 3, 2, 1.2, 'crate'],
  [24, -8, 2, 2, 1.2, 'crate'],
  // Site B — Crane Yard: gantry pillars + overhead beam (beam is high, still solid)
  [15, 10, 1.6, 1.6, 7, 'steel'], [23, 16, 1.6, 1.6, 7, 'steel'],
  [19, 13, 10, 1.2, 1, 'steelDark'],
  [14, 10, 2.2, 2.2, 1.2, 'crate'], [24, 10, 2, 2, 1.2, 'crate'],
  [16, 18, 3, 2, 1.2, 'crate'],
  // Foundry Floor (mid): central pillar + crate clusters
  [0, -1, 1.6, 1.6, 5, 'steel'],
  [-8, 0, 3, 3, 1.2, 'crate'], [-2, -3.5, 2, 2, 1.2, 'crate'],
  [4, 2.5, 3, 2, 1.2, 'crate'], [-14, 3, 2, 2, 1.2, 'crate'],
  [10, -3.5, 2, 2, 1.2, 'crate'],
  // Catwalk (north lane): divider wall with gaps at both ends + crates
  [-2, -12.5, 12, 1, 3, 'wallDark'],
  [-10, -16, 2, 2, 1.2, 'crate'], [8, -16, 3, 2, 1.2, 'crate'],
  [16, -17, 2, 2, 1.2, 'crate'],
  // Service Tunnel (south lane): corridor walls, open at the west end and into B
  [-7, 12, 22, 1, 3, 'wallDark'], [-7, 20, 22, 1, 3, 'wallDark'],
  [-12, 16, 2, 2, 1.2, 'crate'], [-2, 16, 2, 2, 1.2, 'crate'],
  // spawn cover
  [-22, -6, 2, 2, 1.2, 'crate'], [-22, 6, 2, 2, 1.2, 'crate'],
  [24, -2, 2, 2, 1.2, 'crate'], [24, 2, 2, 2, 1.2, 'crate'],
];

// Waypoint graph: [x, z] nodes + adjacency by index.
const NODES = [
  [-26, 0], [-18, 0], [-10, 0], [0, 0], [8, 0], [14, -6], [19, -13],
  [14, 6], [19, 13], [26, 0], [-18, -16], [-6, -16], [8, -16],
  [-18, 16], [-6, 16], [8, 16], [12, -12], [22, -8], [12, 12],
  [22, 8], [16, 0], [24, -14], [24, 14], [-24, -8], [-24, 8],
];
const EDGES = [
  [0, 1], [0, 23], [0, 24], [1, 2], [1, 10], [1, 13], [2, 3], [2, 11],
  [2, 14], [3, 4], [3, 20], [4, 5], [4, 7], [4, 20], [5, 6], [5, 12],
  [5, 16], [6, 21], [6, 17], [7, 8], [7, 15], [7, 18], [8, 22], [8, 19],
  [9, 17], [9, 19], [9, 20], [9, 21], [9, 22], [10, 11], [11, 12],
  [12, 5], [13, 14], [14, 15], [15, 7], [16, 6], [16, 5], [17, 6],
  [18, 8], [19, 8], [23, 1], [24, 1],
];

export const SITES = {
  A: { name: 'Furnace Hall', x: 19, z: -13, r: 6.5, plantX: 20, plantZ: -14 },
  B: { name: 'Crane Yard', x: 19, z: 13, r: 6.5, plantX: 20, plantZ: 14 },
};
export const SPAWNS = {
  ember: [[-26, -3], [-26, 0], [-26, 3], [-24, -6], [-24, 6]],
  anvil: [[26, -4], [26, 0], [26, 4], [24, -8], [24, 8]],
};

const MAT_KEYS = {
  wall: PALETTE.wall, wallDark: PALETTE.wallDark, crate: PALETTE.crate,
  steel: PALETTE.steel, steelDark: PALETTE.steelDark, furnace: PALETTE.furnace,
};

export function buildWorld(scene) {
  const materials = {};
  for (const k of Object.keys(MAT_KEYS)) {
    materials[k] = new THREE.MeshStandardMaterial({ color: MAT_KEYS[k], roughness: 0.85, metalness: 0.25 });
  }
  // Furnace body glows: emissive, the map's warm heart.
  materials.furnace = new THREE.MeshStandardMaterial({
    color: 0x4a2c14, roughness: 0.6, metalness: 0.4,
    emissive: PALETTE.furnace, emissiveIntensity: 0.55,
  });
  const colliders = [];
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const tmpColor = new THREE.Color();

  for (const [cx, cz, w, d, h, key] of BOXES) {
    const mesh = new THREE.Mesh(boxGeo, materials[key]);
    mesh.scale.set(w, h, d);
    mesh.position.set(cx, h / 2, cz);
    mesh.castShadow = h > 2;
    mesh.receiveShadow = true;
    scene.add(mesh);
    colliders.push({ minX: cx - w / 2, maxX: cx + w / 2, minY: 0, maxY: h, minZ: cz - d / 2, maxZ: cz + d / 2 });
  }

  // Floor: one big slab, gunmetal with a darker mid strip.
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(62, 46),
    new THREE.MeshStandardMaterial({ color: PALETTE.floor, roughness: 0.95, metalness: 0.15 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const strip = new THREE.Mesh(
    new THREE.PlaneGeometry(62, 10),
    new THREE.MeshStandardMaterial({ color: 0x1d2025, roughness: 0.95, metalness: 0.15 }),
  );
  strip.rotation.x = -Math.PI / 2;
  strip.position.y = 0.01;
  strip.receiveShadow = true;
  scene.add(strip);

  // Pipes along the north wall + around the furnace (visual, with colliders).
  const pipeMat = new THREE.MeshStandardMaterial({ color: PALETTE.steelDark, roughness: 0.5, metalness: 0.7 });
  const pipeGeo = new THREE.CylinderGeometry(0.35, 0.35, 40, 10);
  const pipe = new THREE.Mesh(pipeGeo, pipeMat);
  pipe.rotation.z = Math.PI / 2;
  pipe.position.set(0, 5.4, -21.6);
  scene.add(pipe);
  const pipe2 = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 6, 10), pipeMat);
  pipe2.position.set(22, 3, -18.5);
  scene.add(pipe2);

  // Emissive furnace strips: molten light spilling from the furnace mouth.
  const glowMat = new THREE.MeshBasicMaterial({ color: PALETTE.furnace });
  for (const [x, z, w] of [[18.6, -13, 4], [18.6, -15, 3]]) {
    const stripMesh = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.5), glowMat);
    stripMesh.position.set(x, 1.2, z);
    stripMesh.rotation.y = Math.PI / 2;
    scene.add(stripMesh);
  }
  // Sodium lamps: small emissive boxes + two real point lights (cheap, static).
  const lampMat = new THREE.MeshBasicMaterial({ color: PALETTE.lamp });
  for (const [x, z] of [[-14, 0], [0, 0], [14, 0], [19, -13], [19, 13], [-18, -16], [-6, 16]]) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.15, 0.4), lampMat);
    lamp.position.set(x, 5.6, z);
    scene.add(lamp);
  }
  const glowA = new THREE.PointLight(PALETTE.furnace, 60, 22, 1.8);
  glowA.position.set(17, 3, -13);
  scene.add(glowA);
  const glowB = new THREE.PointLight(PALETTE.lamp, 25, 30, 1.8);
  glowB.position.set(0, 5, 0);
  scene.add(glowB);

  // Site markers: flat rings on the floor so both sites read at a glance.
  const ringGeo = new THREE.RingGeometry(5.6, 6.1, 40);
  const ringMat = new THREE.MeshBasicMaterial({ color: PALETTE.accent, transparent: true, opacity: 0.35, side: THREE.DoubleSide });
  for (const s of [SITES.A, SITES.B]) {
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(s.x, 0.03, s.z);
    scene.add(ring);
  }

  // Lighting: one directional key (dusk sun through the foundry roof) + hemisphere fill.
  const sun = new THREE.DirectionalLight(0xffd9a0, 2.1);
  sun.position.set(-18, 26, -10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -34; sun.shadow.camera.right = 34;
  sun.shadow.camera.top = 26; sun.shadow.camera.bottom = -26;
  sun.shadow.camera.far = 80;
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0x8fa3c0, 0x1a140f, 0.85));
  scene.fog = new THREE.Fog(PALETTE.canvas, 30, 85);
  scene.background = new THREE.Color(PALETTE.canvas);

  // Waypoint adjacency.
  const adj = NODES.map(() => []);
  for (const [a, b] of EDGES) { adj[a].push(b); adj[b].push(a); }

  return {
    colliders,
    nodes: NODES,
    adj,
    // Breadth-first route from node a to node b (indices). Small graph, no heap needed.
    route(a, b) {
      if (a === b) return [a];
      const prev = new Array(NODES.length).fill(-1);
      const q = [a];
      prev[a] = a;
      for (let i = 0; i < q.length; i++) {
        const n = q[i];
        for (const m of adj[n]) {
          if (prev[m] === -1) { prev[m] = n; if (m === b) { const path = [b]; let c = b; while (c !== a) { c = prev[c]; path.unshift(c); } return path; } q.push(m); }
        }
      }
      return [a, b];
    },
    nearestNode(x, z) {
      let best = 0, bd = Infinity;
      for (let i = 0; i < NODES.length; i++) {
        const dx = NODES[i][0] - x, dz = NODES[i][1] - z;
        const d = dx * dx + dz * dz;
        if (d < bd) { bd = d; best = i; }
      }
      return best;
    },
    // Line of sight between two points (eye heights given): blocked if any
    // collider box intersects the segment. Reuses one scratch object.
    losBlocked(x0, y0, z0, x1, y1, z1) {
      const p0 = { x: x0, y: y0, z: z0 };
      const p1 = { x: x1, y: y1, z: z1 };
      for (let i = 0; i < colliders.length; i++) {
        if (segBox(p0, p1, colliders[i]) >= 0) return true;
      }
      return false;
    },
    // First world hit along a segment: returns t in [0,1] or -1.
    firstHit(x0, y0, z0, x1, y1, z1) {
      const p0 = { x: x0, y: y0, z: z0 };
      const p1 = { x: x1, y: y1, z: z1 };
      let best = -1;
      for (let i = 0; i < colliders.length; i++) {
        const t = segBox(p0, p1, colliders[i]);
        if (t >= 0 && (best < 0 || t < best)) best = t;
      }
      return best;
    },
  };
}

// Move an AABB (half extents hx, hz; height h) by (dx, dz), resolving one
// axis at a time against the collider list so walls never swallow the mover.
// pos is mutated in place; returns true if any axis was blocked.
export function moveAABB(world, pos, dx, dz, hx, hz, h) {
  let blocked = false;
  const nx = pos.x + dx;
  for (const c of world.colliders) {
    if (pos.y + h <= c.minY || pos.y >= c.maxY) continue;
    if (nx + hx > c.minX && nx - hx < c.maxX && pos.z + hz > c.minZ && pos.z - hz < c.maxZ) {
      blocked = true;
      if (dx > 0) pos.x = c.minX - hx; else if (dx < 0) pos.x = c.maxX + hx;
      break;
    }
  }
  if (!blocked) pos.x = nx;
  const nz = pos.z + dz;
  blocked = false;
  for (const c of world.colliders) {
    if (pos.y + h <= c.minY || pos.y >= c.maxY) continue;
    if (pos.x + hx > c.minX && pos.x - hx < c.maxX && nz + hz > c.minZ && nz - hz < c.maxZ) {
      blocked = true;
      if (dz > 0) pos.z = c.minZ - hz; else if (dz < 0) pos.z = c.maxZ + hz;
      break;
    }
  }
  if (!blocked) pos.z = nz;
  // Clamp to the arena.
  pos.x = Math.max(-29.4, Math.min(29.4, pos.x));
  pos.z = Math.max(-21.4, Math.min(21.4, pos.z));
  return blocked;
}
