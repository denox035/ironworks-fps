// The player: pointer-lock look, acceleration + friction movement, crouch,
// jump, AABB collision, recoil/spread state, health + armour. Pure step
// functions over a plain object — the sim owns the numbers, the renderer
// owns the camera.
import { clamp } from './util.js';
import { moveAABB } from './world.js';
import { WEAPONS, makeWeaponState, startReload, tickReload, currentSpread } from './weapons.js';

export const EYE_STAND = 1.62;
export const EYE_CROUCH = 1.05;
export const PLAYER_RADIUS = 0.38;
export const PLAYER_HEIGHT = 1.75;

export function makePlayer(x, z) {
  return {
    x, z, y: 0, // y is the feet position (always 0 — flat map, jump is visual + eye offset)
    vx: 0, vz: 0,
    yaw: -Math.PI / 2, // facing east, down mid
    pitch: 0,
    eyeY: EYE_STAND,
    crouched: false,
    onGround: true,
    jumpV: 0,
    hp: 100, armour: 0, alive: true,
    money: 800,
    weapons: { p9: makeWeaponState('p9') },
    current: 'p9',
    grenades: { frag: 0, smoke: 0 },
    grenadeSel: 'frag',
    spreadBloom: 0,
    recoilPitch: 0,
    ads: false,
    walk: false, // Shift: slow, quiet, tighter spread
    kills: 0, deaths: 0,
    bombCarrier: true,
    plantT: 0, // plant progress 0..1
    defuseT: 0,
    lastDamageFrom: null, lastDamageAt: 0,
    speed: 0, // current horizontal speed, for spread + HUD
  };
}

export function resetPlayer(p, x, z, yaw) {
  p.x = x; p.z = z; p.y = 0;
  p.vx = 0; p.vz = 0;
  p.yaw = yaw; p.pitch = 0;
  p.eyeY = EYE_STAND; p.crouched = false;
  p.hp = 100; p.alive = true;
  p.spreadBloom = 0; p.recoilPitch = 0; p.ads = false;
  p.plantT = 0; p.defuseT = 0;
  p.current = 'p9';
  if (!p.weapons.p9) p.weapons.p9 = makeWeaponState('p9');
  p.weapons.p9.mag = WEAPONS.p9.mag; p.weapons.p9.reserve = WEAPONS.p9.reserve;
  p.speed = 0;
}

// Apply a look delta (mouse). Pitch clamped so the player cannot flip over.
export function applyLook(p, dx, dy, sens) {
  p.yaw -= dx * sens;
  p.pitch = clamp(p.pitch - dy * sens, -1.45, 1.45);
}

// One fixed step of movement. input: {f, b, l, r, crouch, jump, walk}.
// Returns nothing; mutates p.
export function stepPlayer(p, input, world, dt) {
  if (!p.alive) return;
  const crouch = input.crouch;
  p.crouched = crouch;
  const targetEye = crouch ? EYE_CROUCH : EYE_STAND;
  p.eyeY += (targetEye - p.eyeY) * Math.min(1, dt * 12);

  const baseSpeed = p.ads ? 2.2 : crouch ? 2.4 : p.walk ? 2.6 : 5.4;
  const accel = p.onGround ? 42 : 12;
  const friction = p.onGround ? 10 : 0.6;
  const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
  // Forward is (sin(yaw), cos(yaw)) in xz with our yaw convention: yaw=-PI/2 faces +x.
  let mx = 0, mz = 0;
  if (input.f) { mx += -sy; mz += -cy; }
  if (input.b) { mx -= -sy; mz -= -cy; }
  if (input.l) { mx += -cy; mz += sy; }
  if (input.r) { mx += cy; mz += -sy; }
  const len = Math.hypot(mx, mz);
  if (len > 0) { mx /= len; mz /= len; }
  p.vx += mx * accel * dt;
  p.vz += mz * accel * dt;
  // Friction when no input (and always, lightly, so speed settles).
  const fr = Math.max(0, 1 - friction * dt);
  if (len === 0) { p.vx *= fr; p.vz *= fr; }
  const sp = Math.hypot(p.vx, p.vz);
  if (sp > baseSpeed) { p.vx *= baseSpeed / sp; p.vz *= baseSpeed / sp; }
  p.speed = Math.hypot(p.vx, p.vz);

  const pos = { x: p.x, z: p.z, y: 0 };
  moveAABB(world, pos, p.vx * dt, p.vz * dt, PLAYER_RADIUS, PLAYER_RADIUS, PLAYER_HEIGHT);
  p.x = pos.x; p.z = pos.z;

  // Jump: simple vertical velocity, eye height rides along; landing is instant
  // (flat map) so this is a small hop that clears nothing but feels right.
  if (input.jump && p.onGround) { p.jumpV = 4.2; p.onGround = false; }
  if (!p.onGround) {
    p.jumpV -= 14 * dt;
    p.y += p.jumpV * dt;
    if (p.y <= 0) { p.y = 0; p.jumpV = 0; p.onGround = true; }
  }

  // Recoil recovery + bloom decay.
  p.recoilPitch *= Math.max(0, 1 - dt * 6);
  p.spreadBloom = Math.max(0, p.spreadBloom - dt * 0.09);
}

// Current weapon state + definition for the player.
export function playerWeapon(p) {
  return p.weapons[p.current];
}
export function playerWeaponDef(p) {
  return WEAPONS[p.current];
}

// Spread for the player's next shot, in radians.
export function playerSpread(p) {
  const def = playerWeaponDef(p);
  return currentSpread(def, p.speed, p.crouched, p.ads, p.spreadBloom * 100);
}

// Fire one shot if the weapon is ready. Returns 'shot' | 'dry' | 'busy' | 'reloading'.
export function tryFire(p) {
  const w = playerWeapon(p);
  const def = playerWeaponDef(p);
  if (w.reloadT > 0) return 'reloading';
  if (w.cooldown > 0) return 'busy';
  if (w.mag <= 0) return 'dry';
  w.mag -= 1;
  w.cooldown = def.fireInterval;
  w.shotsFired += 1;
  p.spreadBloom = Math.min(1, p.spreadBloom + (def.id === 'halberd' ? 0.5 : 0.08));
  p.recoilPitch += def.recoil;
  p.pitch = clamp(p.pitch + def.recoil * 0.6, -1.45, 1.45);
  return 'shot';
}

// Tick weapon timers (cooldown, reload) for the player.
export function tickPlayerWeapon(p, dt) {
  const w = playerWeapon(p);
  if (w.cooldown > 0) w.cooldown -= dt;
  tickReload(w, dt);
}

export function tryReload(p) {
  return startReload(playerWeapon(p));
}

// Damage the player; armour absorbs 60% of incoming damage until depleted.
export function damagePlayer(p, dmg, fromName, now) {
  if (!p.alive) return 0;
  let remaining = dmg;
  if (p.armour > 0) {
    const absorbed = Math.min(p.armour, remaining * 0.6);
    p.armour -= absorbed;
    remaining -= absorbed;
  }
  p.hp -= remaining;
  p.lastDamageFrom = fromName;
  p.lastDamageAt = now;
  if (p.hp <= 0) {
    p.hp = 0;
    p.alive = false;
    p.deaths += 1;
  }
  return remaining;
}
