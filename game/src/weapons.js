// Weapons: 4 guns + 2 grenades. Distinct feel per gun — damage, fire rate,
// spread, recoil and range all differ, and spread punishes firing on the
// move while rewarding a stopped, aimed first shot.
export const WEAPONS = {
  p9: {
    id: 'p9', name: 'P9 sidearm', price: 300, slot: 1,
    damage: 26, headMult: 4, mag: 12, reserve: 36, fireInterval: 0.14,
    reloadTime: 1.1, spread: 0.011, moveSpread: 0.03, recoil: 0.010,
    range: 40, auto: false, tracer: 0xe9e6df,
  },
  kestrel: {
    id: 'kestrel', name: 'Kestrel SMG', price: 1500, slot: 2,
    damage: 22, headMult: 4, mag: 30, reserve: 90, fireInterval: 0.075,
    reloadTime: 1.6, spread: 0.016, moveSpread: 0.05, recoil: 0.012,
    range: 28, auto: true, tracer: 0xffd27a,
  },
  vk7: {
    id: 'vk7', name: 'VK-7 rifle', price: 2700, slot: 3,
    damage: 34, headMult: 4, mag: 30, reserve: 90, fireInterval: 0.10,
    reloadTime: 1.9, spread: 0.008, moveSpread: 0.042, recoil: 0.021,
    range: 60, auto: true, tracer: 0xffb45e,
  },
  halberd: {
    id: 'halberd', name: 'Halberd marksman', price: 4750, slot: 4,
    damage: 95, headMult: 2, mag: 5, reserve: 15, fireInterval: 1.05,
    reloadTime: 2.6, spread: 0.001, moveSpread: 0.09, recoil: 0.055,
    range: 80, auto: false, scope: true, tracer: 0xff7a1a,
  },
};

export const GRENADES = {
  frag: { id: 'frag', name: 'Frag grenade', price: 300, fuse: 1.2, radius: 7, damage: 120 },
  smoke: { id: 'smoke', name: 'Smoke grenade', price: 400, duration: 12, radius: 4.5 },
};

// One weapon instance: mutable ammo/reload state for a single holder.
export function makeWeaponState(id) {
  const def = WEAPONS[id];
  return { id, mag: def.mag, reserve: def.reserve, reloadT: 0, cooldown: 0, shotsFired: 0 };
}

// Effective spread (radians) for a shot: base + movement + consecutive-fire
// bloom, tightened by crouching / standing still / aiming down sights.
export function currentSpread(def, moveSpeed, crouched, ads, consecutive) {
  let s = def.spread + def.moveSpread * Math.min(1, moveSpeed / 5.5);
  if (crouched) s *= 0.7;
  if (ads) s *= 0.45;
  s += Math.min(0.05, consecutive * 0.004);
  return s;
}

// Damage at range with falloff past half the weapon's range.
export function damageAtRange(def, dist, isHead) {
  let d = def.damage * (isHead ? def.headMult : 1);
  if (dist > def.range * 0.5) d *= Math.max(0.5, 1 - (dist - def.range * 0.5) / def.range);
  return d;
}

// Start a reload if there is anything to load; returns true when started.
export function startReload(w) {
  const def = WEAPONS[w.id];
  if (w.reloadT > 0 || w.mag >= def.mag || w.reserve <= 0) return false;
  w.reloadT = def.reloadTime;
  return true;
}

// Advance reload timers; returns true when a reload finished this tick.
export function tickReload(w, dt) {
  if (w.reloadT <= 0) return false;
  w.reloadT -= dt;
  if (w.reloadT > 0) return false;
  const def = WEAPONS[w.id];
  const need = def.mag - w.mag;
  const take = Math.min(need, w.reserve);
  w.mag += take;
  w.reserve -= take;
  w.shotsFired = 0;
  return true;
}
