// Small deterministic helpers. One seeded RNG drives the whole game path:
// no Math.random, no Date.now inside the simulation, so a fixed seed replays
// the same match. Rendering-only code may use performance.now for the clock.

// mulberry32 — tiny, fast, good enough for gameplay randomness.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Segment vs axis-aligned box. Returns the fraction t in [0,1] of the
// first hit along p0->p1, or -1 when the segment misses. Used for LOS and
// hitscan against world colliders (no three.js Raycaster in hot loops).
export function segBox(p0, p1, b) {
  let tmin = 0;
  let tmax = 1;
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const dz = p1.z - p0.z;
  // X slab
  if (dx === 0) {
    if (p0.x < b.minX || p0.x > b.maxX) return -1;
  } else {
    let t1 = (b.minX - p0.x) / dx;
    let t2 = (b.maxX - p0.x) / dx;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  // Y slab
  if (dy === 0) {
    if (p0.y < b.minY || p0.y > b.maxY) return -1;
  } else {
    let t1 = (b.minY - p0.y) / dy;
    let t2 = (b.maxY - p0.y) / dy;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  // Z slab
  if (dz === 0) {
    if (p0.z < b.minZ || p0.z > b.maxZ) return -1;
  } else {
    let t1 = (b.minZ - p0.z) / dz;
    let t2 = (b.maxZ - p0.z) / dz;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  return tmin;
}

// Distance from a point to a segment (squared), for melee-ish proximity checks.
export function distPointSeg2(px, py, pz, ax, ay, az, bx, by, bz) {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const len2 = abx * abx + aby * aby + abz * abz;
  let t = len2 === 0 ? 0 : ((px - ax) * abx + (py - ay) * aby + (pz - az) * abz) / len2;
  t = clamp(t, 0, 1);
  const cx = ax + abx * t - px, cy = ay + aby * t - py, cz = az + abz * t - pz;
  return cx * cx + cy * cy + cz * cz;
}
