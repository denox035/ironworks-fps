// Bots: waypoint routes, vision cone + LOS, hearing, reaction time, and a
// small state machine (hold / patrol / advance / plant / defend / rotate /
// retreat / defuse). Attackers push a site in a loose group; defenders hold
// corners and rotate on sound or contact. Bot shooting is a seeded hit
// roll — never perfectly accurate — with a visible tracer either way.
import * as THREE from 'three';
import { clamp, lerp, distPointSeg2 } from './util.js';
import { WEAPONS, makeWeaponState, damageAtRange, tickReload, startReload } from './weapons.js';
import { moveAABB, SITES, SPAWNS } from './world.js';
import { PALETTE } from './palette.js';

export const BOT_RADIUS = 0.38;
export const BOT_HEIGHT = 1.75;
export const BOT_EYE = 1.55;

const EMBER_NAMES = ['Vex', 'Koda', 'Rook', 'Ash'];
const ANVIL_NAMES = ['Slag', 'Brunt', 'Ferrum', 'Gage', 'Talon'];

export function makeBots() {
  const bots = [];
  for (let i = 0; i < 4; i++) {
    bots.push(makeBot(i, 'ember', EMBER_NAMES[i], i === 0 ? 'vk7' : i === 1 ? 'kestrel' : 'vk7'));
  }
  for (let i = 0; i < 5; i++) {
    bots.push(makeBot(4 + i, 'anvil', ANVIL_NAMES[i], i % 2 === 0 ? 'vk7' : 'kestrel'));
  }
  return bots;
}

function makeBot(id, team, name, weaponId) {
  return {
    id, team, name, weaponId,
    x: 0, z: 0, yaw: 0, pitch: 0,
    vx: 0, vz: 0, speed: 0,
    hp: 100, armour: 0, alive: true,
    weapon: makeWeaponState(weaponId),
    state: 'hold',
    route: [], routeIdx: 0,
    holdNode: 0, holdT: 0,
    site: null, // 'A' | 'B' assigned objective
    hasBomb: false,
    plantT: 0, defuseT: 0,
    reactionT: 0, // counts down once an enemy is first seen
    seen: null, // {x, y, z, at, kind: 'player'|'bot', ref}
    lastShotAt: 0, burstLeft: 0, burstT: 0,
    investigate: null, // {x, z, at} heard something
    walkPhase: 0,
    aimErr: 0.03,
    skill: 0.85,
    kills: 0, deaths: 0,
    mesh: null, // three.js group, attached by the renderer
    deadT: 0,
  };
}

// Place bots for a new round: attackers at Ember spawn with a site each,
// defenders at hold corners. rng is the match RNG (seeded).
export function placeBots(bots, world, rng, roundNo) {
  let e = 0, a = 0;
  for (const b of bots) {
    if (b.team === 'ember') {
      const s = SPAWNS.ember[e % SPAWNS.ember.length];
      b.x = s[0]; b.z = s[1];
      b.yaw = -Math.PI / 2;
      b.site = (e + (roundNo % 2)) % 2 === 0 ? 'A' : 'B';
      b.state = 'advance';
      // Route: spawn -> lane -> site. Split the group: some via mid, some via
      // catwalk (A) or tunnel (B).
      const via = b.site === 'A' ? (e % 2 === 0 ? 10 : 3) : (e % 2 === 0 ? 13 : 3);
      const siteNode = b.site === 'A' ? 6 : 8;
      b.route = world.route(world.nearestNode(b.x, b.z), via)
        .concat(world.route(via, siteNode).slice(1));
      b.routeIdx = 0;
      b.hasBomb = e === 0; // first attacker carries the device
      e++;
    } else {
      const s = SPAWNS.anvil[a % SPAWNS.anvil.length];
      b.x = s[0]; b.z = s[1];
      b.yaw = Math.PI / 2;
      // Defenders: 2 hold A, 2 hold B, 1 roams mid.
      const holdNodes = [16, 17, 18, 19, 20];
      b.holdNode = holdNodes[a % holdNodes.length];
      b.site = a < 2 ? 'A' : a < 4 ? 'B' : null;
      b.state = 'hold';
      b.route = world.route(world.nearestNode(b.x, b.z), b.holdNode);
      b.routeIdx = 0;
      b.hasBomb = false;
      a++;
    }
    b.hp = 100;
    b.armour = 0;
    b.alive = true;
    b.plantT = 0; b.defuseT = 0;
    b.seen = null; b.reactionT = 0; b.investigate = null;
    b.burstLeft = 0; b.burstT = 0;
    b.deadT = 0;
    b.weapon = makeWeaponState(b.weaponId);
    b.skill = 0.75 + rng() * 0.25;
    b.aimErr = 0.02 + rng() * 0.03;
    b.speed = 0;
  }
}

// Build the visible body for a bot: capsule-ish torso + head + gun, team trim.
export function buildBotMesh(bot) {
  const g = new THREE.Group();
  const trim = bot.team === 'ember' ? PALETTE.ember : PALETTE.anvil;
  const bodyMat = new THREE.MeshStandardMaterial({ color: bot.team === 'ember' ? 0x4a3220 : 0x2c3a4a, roughness: 0.8, metalness: 0.2 });
  const trimMat = new THREE.MeshStandardMaterial({ color: trim, roughness: 0.5, metalness: 0.3, emissive: trim, emissiveIntensity: 0.25 });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0x8a7a66, roughness: 0.9 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.85, 0.36), bodyMat);
  torso.position.y = 1.05;
  torso.castShadow = true;
  g.add(torso);
  const vest = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.3, 0.4), trimMat);
  vest.position.y = 1.25;
  g.add(vest);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), skinMat);
  head.position.y = 1.68;
  head.castShadow = true;
  g.add(head);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.1, 0.05), trimMat);
  visor.position.set(0, 1.7, 0.19);
  g.add(visor);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.7, 0.26), bodyMat);
  legL.position.set(-0.16, 0.35, 0);
  g.add(legL);
  const legR = legL.clone();
  legR.position.x = 0.16;
  g.add(legR);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.85), new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.4, metalness: 0.6 }));
  gun.position.set(0.28, 1.3, 0.3);
  g.add(gun);
  g.userData = { legL, legR, torso, head, gun };
  g.position.set(bot.x, 0, bot.z);
  bot.mesh = g;
  return g;
}

// Sync a bot's mesh to its sim state (called once per rendered frame).
export function syncBotMesh(bot, dt) {
  if (!bot.mesh) return;
  const g = bot.mesh;
  g.position.set(bot.x, 0, bot.z);
  g.rotation.y = bot.yaw + Math.PI; // model faces +z, yaw faces -z forward
  if (!bot.alive) {
    g.rotation.z = Math.PI / 2 * 0.96;
    g.position.y = -0.1;
    return;
  }
  g.rotation.z = 0;
  // Walk bob + leg swing.
  bot.walkPhase += bot.speed * dt * 2.4;
  const swing = Math.min(1, bot.speed / 3) * 0.5 * Math.sin(bot.walkPhase * 3.2);
  g.userData.legL.rotation.x = swing;
  g.userData.legR.rotation.x = -swing;
  g.userData.torso.position.y = 1.05 + Math.abs(Math.sin(bot.walkPhase * 3.2)) * 0.03;
}

// Vision: is `target` (x, y, z) visible to this bot? Cone ~100°, range 55,
// LOS through the world, and smoke blocks sight.
export function canSee(bot, tx, ty, tz, world, smokes) {
  const dx = tx - bot.x, dz = tz - bot.z;
  const dist = Math.hypot(dx, dz);
  if (dist > 55) return false;
  // Facing: bot forward is (-sin yaw, -cos yaw).
  const fx = -Math.sin(bot.yaw), fz = -Math.cos(bot.yaw);
  const dot = (dx * fx + dz * fz) / (dist || 1);
  if (dot < 0.42) return false; // ~100° cone
  if (world.losBlocked(bot.x, BOT_EYE, bot.z, tx, ty, tz)) return false;
  for (const s of smokes) {
    if (distPointSeg2(s.x, s.y, s.z, bot.x, BOT_EYE, bot.z, tx, ty, tz) < s.r * s.r) return false;
  }
  return true;
}

// Perceive the world: find the nearest visible enemy (player first, then
// enemy bots). Sets bot.seen / reactionT. Returns the seen target or null.
export function perceive(bot, player, bots, world, smokes, now, rng) {
  let best = null, bestD = Infinity;
  if (player.alive && bot.team === 'anvil') {
    if (canSee(bot, player.x, player.eyeY, player.z, world, smokes)) {
      best = { kind: 'player', ref: player, x: player.x, y: player.eyeY, z: player.z };
      bestD = Math.hypot(player.x - bot.x, player.z - bot.z);
    }
  }
  for (const o of bots) {
    if (o === bot || !o.alive || o.team === bot.team) continue;
    if (canSee(bot, o.x, BOT_EYE, o.z, world, smokes)) {
      const d = Math.hypot(o.x - bot.x, o.z - bot.z);
      if (d < bestD) { best = { kind: 'bot', ref: o, x: o.x, y: BOT_EYE, z: o.z }; bestD = d; }
    }
  }
  if (best) {
    if (!bot.seen || bot.seen.ref !== best.ref) {
      bot.reactionT = 0.25 + rng() * 0.2; // 250–450 ms to react
    }
    bot.seen = { ...best, at: now, dist: bestD };
  } else if (bot.seen && now - bot.seen.at > 1.2) {
    bot.seen = null;
  }
  return bot.seen;
}

// Move toward (tx, tz) at speed; returns true when arrived (within 0.6).
function moveToward(bot, world, tx, tz, speed, dt) {
  const dx = tx - bot.x, dz = tz - bot.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.6) { bot.speed = 0; return true; }
  const want = Math.atan2(-dx, -dz); // yaw so forward (-sin,-cos) points at target
  let dyaw = want - bot.yaw;
  while (dyaw > Math.PI) dyaw -= Math.PI * 2;
  while (dyaw < -Math.PI) dyaw += Math.PI * 2;
  bot.yaw += clamp(dyaw, -3.2 * dt, 3.2 * dt);
  const step = Math.min(d, speed * dt);
  const pos = { x: bot.x, z: bot.z, y: 0 };
  moveAABB(world, pos, -Math.sin(bot.yaw) * step, -Math.cos(bot.yaw) * step, BOT_RADIUS, BOT_RADIUS, BOT_HEIGHT);
  bot.speed = Math.hypot(pos.x - bot.x, pos.z - bot.z) / Math.max(dt, 1e-6);
  bot.x = pos.x; bot.z = pos.z;
  return false;
}

// Bot fires a burst at its seen target. Returns an event for the sim to
// resolve (tracer + hit roll), or null.
export function botShoot(bot, now, rng) {
  const w = bot.weapon;
  const def = WEAPONS[bot.weaponId];
  if (w.reloadT > 0 || w.mag <= 0) {
    if (w.mag <= 0) startReload(w);
    return null;
  }
  if (bot.burstT > 0) return null;
  if (bot.burstLeft <= 0) {
    bot.burstLeft = 3 + Math.floor(rng() * 3);
    bot.burstT = 0.55 + rng() * 0.6; // pause between bursts — bots are not lasers
    return null;
  }
  bot.burstLeft -= 1;
  bot.burstT = 0.2;
  w.mag -= 1;
  w.cooldown = def.fireInterval;
  return { shooter: bot, target: bot.seen, def, now };
}

// Resolve one bot shot: seeded hit roll against the seen target.
// Returns {hit, kill, head, dmg, endX, endY, endZ} for tracer + feedback.
export function resolveBotShot(bot, ev, player, rng) {
  const t = ev.target;
  const dist = t.dist;
  const moving = t.kind === 'player' ? t.ref.speed > 2 : t.ref.speed > 2;
  let p = 0.38 * bot.skill;
  p *= clamp(1 - dist / 90, 0.35, 1);
  if (moving) p *= 0.72;
  if (t.kind === 'player' && t.ref.crouched) p *= 0.85;
  const hit = rng() < p;
  const head = hit && rng() < 0.05;
  // Aim error: misses land near the target, not through walls.
  const err = bot.aimErr * dist;
  const ex = t.x + (rng() - 0.5) * 2 * err * 3;
  const ey = t.y + (rng() - 0.5) * 2 * err * 3;
  const ez = t.z + (rng() - 0.5) * 2 * err * 3;
  let dmg = 0;
  if (hit) {
    dmg = damageAtRange(ev.def, dist, head);
  }
  return { hit, head, dmg, ex, ey, ez, target: t };
}

// One fixed AI step for a single bot. ctx carries the shared sim bits the
// bot needs: {world, smokes, bomb, now, rng, onPlant, onDefuse, onShoot}.
export function stepBot(bot, ctx, dt) {
  const { world, now, rng } = ctx;
  if (!bot.alive) { bot.deadT += dt; return; }
  tickReload(bot.weapon, dt);
  if (bot.weapon.cooldown > 0) bot.weapon.cooldown -= dt;
  if (bot.burstT > 0) bot.burstT -= dt;

  // Perception every tick (cheap: 9 bots, short ranges).
  perceive(bot, ctx.player, ctx.bots, world, ctx.smokes, now, rng);
  if (bot.reactionT > 0) bot.reactionT -= dt;

  // Combat overrides movement: if we see an enemy and have reacted, shoot.
  if (bot.seen && bot.reactionT <= 0) {
    const t = bot.seen;
    const want = Math.atan2(-(t.x - bot.x), -(t.z - bot.z));
    let dyaw = want - bot.yaw;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    bot.yaw += clamp(dyaw, -4 * dt, 4 * dt);
    bot.speed = 0;
    const ev = botShoot(bot, now, rng);
    if (ev) ctx.onShoot(bot, ev);
    // Low HP: fall back from a fight.
    if (bot.hp < 30 && bot.state !== 'retreat') {
      bot.state = 'retreat';
      const back = bot.team === 'ember' ? 0 : 9;
      bot.route = world.route(world.nearestNode(bot.x, bot.z), back);
      bot.routeIdx = 0;
    }
  }

  switch (bot.state) {
    case 'advance': {
      if (bot.seen) break; // hold and fight
      const node = bot.route[bot.routeIdx];
      if (node === undefined) { bot.state = bot.hasBomb ? 'plant' : 'defend'; break; }
      const [nx, nz] = world.nodes[node];
      if (moveToward(bot, world, nx, nz, 3.6, dt)) bot.routeIdx += 1;
      break;
    }
    case 'plant': {
      if (bot.seen) break;
      const site = SITES[bot.site];
      const d = Math.hypot(site.plantX - bot.x, site.plantZ - bot.z);
      if (d > 1.5) {
        moveToward(bot, world, site.plantX, site.plantZ, 3.6, dt);
        break;
      }
      bot.plantT += dt;
      if (bot.plantT >= 3) ctx.onPlant(bot);
      break;
    }
    case 'defend': {
      if (bot.seen) break;
      // Idle at the site: small patrol between two nearby nodes.
      bot.holdT += dt;
      if (bot.holdT > 6) {
        bot.holdT = 0;
        const near = bot.site === 'A' ? [16, 17, 6] : [18, 19, 8];
        bot.holdNode = near[Math.floor(rng() * near.length)];
        bot.route = world.route(world.nearestNode(bot.x, bot.z), bot.holdNode);
        bot.routeIdx = 0;
        bot.state = 'patrol';
      }
      break;
    }
    case 'patrol': {
      if (bot.seen) break;
      const node = bot.route[bot.routeIdx];
      if (node === undefined) { bot.state = 'defend'; break; }
      const [nx, nz] = world.nodes[node];
      if (moveToward(bot, world, nx, nz, 2.6, dt)) bot.routeIdx += 1;
      break;
    }
    case 'hold': {
      if (bot.seen) break;
      const node = bot.route[bot.routeIdx];
      if (node !== undefined) {
        const [nx, nz] = world.nodes[node];
        if (moveToward(bot, world, nx, nz, 3.0, dt)) bot.routeIdx += 1;
      }
      break;
    }
    case 'rotate': {
      if (bot.seen) break;
      const node = bot.route[bot.routeIdx];
      if (node === undefined) { bot.state = 'defend'; break; }
      const [nx, nz] = world.nodes[node];
      if (moveToward(bot, world, nx, nz, 4.2, dt)) bot.routeIdx += 1;
      break;
    }
    case 'retreat': {
      if (bot.hp > 55) { bot.state = 'advance'; break; }
      const node = bot.route[bot.routeIdx];
      if (node === undefined) { bot.state = 'hold'; break; }
      const [nx, nz] = world.nodes[node];
      if (moveToward(bot, world, nx, nz, 4.0, dt)) bot.routeIdx += 1;
      break;
    }
    case 'defuse': {
      const bomb = ctx.bomb;
      if (!bomb.planted) { bot.state = 'defend'; break; }
      const d = Math.hypot(bomb.x - bot.x, bomb.z - bot.z);
      if (d > 1.6) {
        moveToward(bot, world, bomb.x, bomb.z, 4.2, dt);
        break;
      }
      if (bot.seen) break; // a visible planter interrupts the defuse
      bot.defuseT += dt;
      if (bot.defuseT >= 5) ctx.onDefuse(bot);
      break;
    }
    default:
      break;
  }
}

// A bot heard a noise: defenders rotate toward it.
export function hearNoise(bot, world, x, z, now) {
  const d = Math.hypot(x - bot.x, z - bot.z);
  if (d > 30) return;
  bot.investigate = { x, z, at: now };
  if (bot.team === 'anvil' && (bot.state === 'hold' || bot.state === 'defend' || bot.state === 'patrol')) {
    bot.state = 'rotate';
    bot.route = world.route(world.nearestNode(bot.x, bot.z), world.nearestNode(x, z));
    bot.routeIdx = 0;
  }
}
