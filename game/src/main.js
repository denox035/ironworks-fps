// IRONWORKS — main. One state store, a fixed 60 Hz simulation kept apart
// from rendering, and a seeded RNG (mulberry32) so a fixed seed replays the
// same match. No Math.random and no Date.now in the simulation path.
import * as THREE from 'three';
import { buildWorld, SITES, SPAWNS } from './world.js';
import { mulberry32, clamp, segBox } from './util.js';
import { WEAPONS, GRENADES, damageAtRange, currentSpread } from './weapons.js';
import {
  makePlayer, resetPlayer, applyLook, stepPlayer, playerWeapon, playerWeaponDef,
  tryFire, tickPlayerWeapon, tryReload, damagePlayer, EYE_STAND,
} from './player.js';
import {
  makeBots, placeBots, buildBotMesh, syncBotMesh, stepBot,
  resolveBotShot, hearNoise, BOT_EYE,
} from './bots.js';
import {
  makeMatch, startRound, endRound, nextRound, buy, canPlant, plantBomb,
  aliveCounts, checkWin, BUY_TIME, ROUND_TIME, PLANT_TIME, FUSE_TIME,
} from './rounds.js';
import { makeAudio } from './audio.js';
import { makeInput } from './input.js';
import { makeHud } from './hud.js';
import { PALETTE } from './palette.js';

const DT = 1 / 60;
const params = new URLSearchParams(location.search);
const SHOT = params.get('shot'); // buy | fight | plant | win (aliases: start, play, end)
const SEED = Number(params.get('seed') || '1') || 1;

// Scratch objects — no per-frame allocation in hot loops.
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _rayDir = new THREE.Vector3();

function createState(seed) {
  return {
    seed,
    rng: mulberry32(seed),
    time: 0,
    player: makePlayer(-26, 0),
    bots: makeBots(),
    match: makeMatch(),
    smokes: [], // {x, y, z, r, until}
    grenades: [], // flying grenades {x,y,z,vx,vy,vz,fuse,kind}
    buyOpen: false,
    spreadPx: 0,
    paused: false,
    over: false,
    shotMode: SHOT || null,
    shotDone: false,
    muted: false,
  };
}

let renderer, scene, camera, world;
let state, audio, input, hud;
let muzzleLight, muzzleQuad, viewGun;
let tracers = [], impacts = [], smokeMeshes = [];
let botCtx;

function init() {
  state = createState(SEED);
  audio = makeAudio();
  input = makeInput();
  hud = makeHud();

  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  document.getElementById('game').appendChild(renderer.domElement);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.08, 120);
  camera.rotation.order = 'YXZ';
  world = buildWorld(scene);

  for (const b of state.bots) scene.add(buildBotMesh(b));

  // View model: a simple gun held at the lower right of the camera.
  viewGun = new THREE.Group();
  const gunMat = new THREE.MeshStandardMaterial({ color: 0x33373d, roughness: 0.45, metalness: 0.55 });
  const gunBody = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.55), gunMat);
  viewGun.add(gunBody);
  const gunBarrel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.3), gunMat);
  gunBarrel.position.set(0, 0.02, -0.4);
  viewGun.add(gunBarrel);
  const gunSight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.06, 0.08), new THREE.MeshStandardMaterial({ color: PALETTE.accent, emissive: PALETTE.accent, emissiveIntensity: 0.6 }));
  gunSight.position.set(0, 0.09, -0.1);
  viewGun.add(gunSight);
  viewGun.position.set(0.28, -0.24, -0.5);
  camera.add(viewGun);
  scene.add(camera);

  // Muzzle flash: one reused point light + quad at the barrel tip.
  muzzleLight = new THREE.PointLight(0xffb45e, 0, 9, 1.6);
  scene.add(muzzleLight);
  muzzleQuad = new THREE.Mesh(
    new THREE.PlaneGeometry(0.35, 0.35),
    new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }),
  );
  scene.add(muzzleQuad);

  // Tracer pool (10 lines), impact pool (8 sparks), smoke pool (6 spheres).
  const tracerMat = new THREE.LineBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.9 });
  for (let i = 0; i < 10; i++) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(g, tracerMat.clone());
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }
  for (let i = 0; i < 8; i++) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffc46a, transparent: true, opacity: 0 }),
    );
    m.visible = false;
    scene.add(m);
    impacts.push({ mesh: m, life: 0 });
  }
  for (let i = 0; i < 6; i++) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(1, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0x8a8f94, transparent: true, opacity: 0.5, depthWrite: false }),
    );
    m.visible = false;
    scene.add(m);
    smokeMeshes.push({ mesh: m, cloud: null });
  }

  input.attach(renderer.domElement);
  wireUi();
  placeRound();
  // Debug/testing handle: lets automated play-tests read the sim state.
  window.__game = state;
  if (SHOT) setupShot(SHOT);

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  let last = performance.now();
  let acc = 0;
  function frame(now) {
    const elapsed = Math.min(0.25, (now - last) / 1000);
    last = now;
    if (!state.shotDone) {
      acc += elapsed;
      let steps = 0;
      while (acc >= DT && steps < 5) {
        stepSim(DT);
        acc -= DT;
        steps++;
      }
      if (steps === 5) acc = 0; // drop backlog, never spiral
    }
    syncRender(now / 1000);
    renderer.render(scene, camera);
    if (SHOT && !state.shotDone) {
      // Shot mode: freeze on this frame — no more renders, so the muzzle
      // flash and tracer stay exactly as captured. The canvas keeps its
      // last presented frame for the screenshot.
      state.shotDone = true;
      window.__shotReady = true;
      return;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// Place everyone for the current round (positions, routes, economy reset).
function placeRound() {
  const { player, bots, match } = state;
  const spawn = SPAWNS.ember[1];
  resetPlayer(player, spawn[0], spawn[1], -Math.PI / 2);
  placeBots(bots, world, state.rng, match.round);
  startRound(match, player);
  state.buyOpen = match.phase === 'buy';
  if (state.buyOpen) document.exitPointerLock?.(); // the buy menu needs a free pointer
  // No pointer lock here: lock is only ever requested from a user gesture
  // (the Play button when the buy menu is closed, or clicking the game canvas).
}

function wireUi() {
  const playBtn = document.getElementById('play');
  playBtn.addEventListener('click', () => {
    audio.ensure();
    document.getElementById('overlay').hidden = true;
    // Only capture the mouse when the buy menu is closed: during the buy
    // phase the menu is open and the player needs a free pointer to buy.
    if (!state.buyOpen) input.requestLock(renderer.domElement);
    state.paused = false;
    if (state.match.phase === 'matchEnd') restartMatch();
  });
  document.getElementById('play-again')?.addEventListener('click', () => {
    restartMatch();
    document.getElementById('overlay').hidden = true;
    input.requestLock(renderer.domElement);
  });
  // Buy menu clicks (delegated).
  document.getElementById('buy-grid').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-buy]');
    if (!btn) return;
    const [kind, id] = btn.dataset.buy.split(':');
    const res = buy(state.player, kind, id || 'armour');
    if (res.ok) { audio.buy(); hud.renderBuy(state); }
    else audio.denied();
  });
  document.getElementById('buy-close').addEventListener('click', () => closeBuy());
  document.getElementById('resume')?.addEventListener('click', () => {
    document.getElementById('overlay').hidden = true;
    input.requestLock(renderer.domElement);
  });
  // Clicking the game canvas re-engages the mouse (the standard FPS
  // pattern): this is the only place the live game asks for the lock, and
  // it is always a user gesture.
  renderer.domElement.addEventListener('click', () => {
    if (!document.getElementById('overlay').hidden) return;
    if (state.buyOpen) return;
    if (state.match.phase === 'matchEnd') return;
    input.requestLock(renderer.domElement);
  });
  document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement != null;
    if (!locked && !state.buyOpen && state.match.phase !== 'matchEnd' && !SHOT) {
      // Pause overlay when the pointer is released mid-game.
      state.paused = true;
      const ov = document.getElementById('overlay');
      ov.hidden = false;
      document.getElementById('overlay-title').textContent = 'Paused';
      document.getElementById('overlay-copy').textContent = 'Pointer released. Click to resume.';
      playBtn.textContent = 'Click to resume';
    }
  });
}

function restartMatch() {
  state.match = makeMatch();
  state.player.money = 800;
  state.player.weapons = { p9: state.player.weapons.p9 };
  state.player.grenades = { frag: 0, smoke: 0 };
  state.player.kills = 0;
  state.player.deaths = 0;
  for (const b of state.bots) { b.kills = 0; b.deaths = 0; }
  placeRound();
}

function openBuy() {
  if (state.match.phase !== 'buy') return;
  state.buyOpen = true;
  document.exitPointerLock?.();
  hud.renderBuy(state);
}
function closeBuy() {
  state.buyOpen = false;
  // No lock request here either (no user gesture): the canvas click handler
  // re-engages the mouse when the player clicks back into the game.
}

// ---- Simulation (fixed 60 Hz) ----
function stepSim(dt) {
  const { player, bots, match } = state;
  state.time += dt;
  const now = state.time;
  const inp = input.state;

  // Look is applied once per sim step from the accumulated mouse delta.
  if (!state.paused && player.alive) {
    const { dx, dy } = input.takeLook();
    applyLook(player, dx, dy, 0.0021);
  } else {
    input.takeLook();
  }
  player.ads = inp.ads;
  if (inp.mutePressed) audio.toggleMute();

  // Phase timers.
  if (match.phase === 'buy') {
    match.phaseT -= dt;
    if (match.phaseT <= 0) {
      match.phase = 'live';
      match.phaseT = ROUND_TIME;
      state.buyOpen = false;
      audio.horn();
      // Lock is NOT requested here (no user gesture at this point): the
      // player clicks the game to re-engage the mouse; the HUD shows a hint.
    }
  } else if (match.phase === 'live') {
    match.phaseT -= dt;
    if (match.bomb.state === 'planted') {
      match.bomb.fuseT -= dt;
      // Plant beep every second — defenders hear it.
      if (Math.floor(match.bomb.fuseT) !== Math.floor(match.bomb.fuseT + dt)) {
        audio.beep();
        for (const b of bots) if (b.alive && b.team === 'anvil') hearNoise(b, world, match.bomb.x, match.bomb.z, now);
      }
      if (match.bomb.fuseT <= 0) {
        match.bomb.state = 'exploded';
        audio.explosion();
        explodeAt(match.bomb.x, 1, match.bomb.z);
        endRound(match, player, bots, 'ember', `Device detonated at Site ${match.bomb.site}`);
      }
    } else if (match.phaseT <= 0) {
      endRound(match, player, bots, 'anvil', 'Time expired — device never planted');
    }
  } else if (match.phase === 'roundEnd') {
    match.phaseT -= dt;
    if (match.phaseT <= 0) {
      if (match.matchWinner) {
        match.phase = 'matchEnd';
      } else {
        nextRound(match, player);
        placeRound();
      }
    }
  }

  const frozen = match.phase === 'buy' || match.phase === 'roundEnd' || match.phase === 'matchEnd' || state.paused;
  const simInput = {
    f: inp.f && !frozen, b: inp.b && !frozen, l: inp.l && !frozen, r: inp.r && !frozen,
    crouch: inp.crouch, jump: inp.jump && !frozen, walk: inp.walk,
  };
  stepPlayer(player, simInput, world, dt);
  tickPlayerWeapon(player, dt);

  // Weapon slots 1-5.
  if (inp.slot >= 1 && inp.slot <= 4) {
    const ids = ['p9', 'kestrel', 'vk7', 'halberd'];
    const id = ids[inp.slot - 1];
    if (player.weapons[id] && player.current !== id) { player.current = id; audio.reload(); }
  }
  if (inp.slot === 5) {
    player.grenadeSel = player.grenadeSel === 'frag' ? 'smoke' : 'frag';
  }
  if (inp.reloadPressed) { if (tryReload(player)) audio.reload(); }
  if (inp.buyTogglePressed) { state.buyOpen ? closeBuy() : openBuy(); }

  // Firing (hold for auto, edge for semi-auto).
  if (match.phase === 'live' && player.alive && !frozen) {
    const def = playerWeaponDef(player);
    const wantFire = def.auto ? inp.fire : inp.firePressed;
    if (wantFire) {
      const res = tryFire(player);
      if (res === 'shot') firePlayerShot();
      else if (res === 'dry') { audio.dry(); tryReload(player); }
    }
  }

  // Grenade throw.
  if (inp.grenadePressed && player.alive && match.phase === 'live' && !frozen) {
    throwGrenade();
  }

  // Plant / defuse channels (hold E).
  if (match.phase === 'live' && player.alive) {
    const site = canPlant(match, player);
    if (inp.plant && site) {
      player.plantT += dt;
      if (Math.floor(player.plantT * 2) !== Math.floor((player.plantT - dt) * 2)) audio.beep();
      if (player.plantT >= PLANT_TIME) {
        plantBomb(match, player, site);
        audio.horn();
        for (const b of bots) {
          if (!b.alive) continue;
          if (b.team === 'anvil') {
            b.state = 'defuse';
            b.route = world.route(world.nearestNode(b.x, b.z), world.nearestNode(match.bomb.x, match.bomb.z));
            b.routeIdx = 0;
            b.defuseT = 0;
          } else {
            b.state = 'defend';
          }
        }
        hud.pushFeed(`You planted the device at Site ${site}`);
      }
    } else {
      player.plantT = 0;
    }
  }

  // Bots.
  botCtx = {
    world, player, bots, smokes: state.smokes, now, rng: state.rng, bomb: match.bomb,
    onShoot: onBotShoot,
    onPlant: (bot) => {
      match.bomb = { state: 'planted', site: bot.site, x: SITES[bot.site].plantX, z: SITES[bot.site].plantZ, fuseT: FUSE_TIME, carrier: null };
      bot.hasBomb = false;
      bot.plantT = 0;
      audio.horn();
      hud.pushFeed(`${bot.name} planted the device at Site ${bot.site}`);
      for (const b of bots) {
        if (!b.alive) continue;
        if (b.team === 'anvil') {
          b.state = 'defuse';
          b.route = world.route(world.nearestNode(b.x, b.z), world.nearestNode(match.bomb.x, match.bomb.z));
          b.routeIdx = 0;
          b.defuseT = 0;
        } else if (b !== bot) {
          b.state = 'defend';
        }
      }
    },
    onDefuse: (bot) => {
      match.bomb.state = 'defused';
      audio.horn();
      hud.pushFeed(`${bot.name} defused the device`);
      endRound(match, player, bots, 'anvil', 'Device defused');
    },
  };
  if (!frozen) {
    for (const b of bots) stepBot(b, botCtx, dt);
  }

  // Grenades in flight.
  for (let i = state.grenades.length - 1; i >= 0; i--) {
    const g = state.grenades[i];
    g.vy -= 12 * dt;
    g.x += g.vx * dt; g.y += g.vy * dt; g.z += g.vz * dt;
    if (g.y < 0.1) { g.y = 0.1; g.vy *= -0.35; g.vx *= 0.6; g.vz *= 0.6; }
    g.fuse -= dt;
    if (g.fuse <= 0) {
      detonateGrenade(g);
      state.grenades.splice(i, 1);
    }
  }

  // Smoke expiry.
  for (let i = state.smokes.length - 1; i >= 0; i--) {
    if (now > state.smokes[i].until) state.smokes.splice(i, 1);
  }

  // Win checks (elimination only — plant/timer handled above).
  if (match.phase === 'live') {
    const win = checkWin(match, player, bots);
    if (win) endRound(match, player, bots, win.winner, win.reason);
  }

  // Player death: the bomb drops to the nearest living Ember bot.
  if (!player.alive && match.bomb.state === 'carried' && match.bomb.carrier === 'player' && match.phase === 'live') {
    let best = null, bd = Infinity;
    for (const b of bots) {
      if (!b.alive || b.team !== 'ember') continue;
      const d = Math.hypot(b.x - player.x, b.z - player.z);
      if (d < bd) { bd = d; best = b; }
    }
    if (best) {
      match.bomb.carrier = best.id;
      best.hasBomb = true;
      best.state = 'plant';
      best.route = world.route(world.nearestNode(best.x, best.z), best.site === 'A' ? 6 : 8);
      best.routeIdx = 0;
      hud.pushFeed(`${best.name} picked up the device`);
    } else {
      match.bomb.state = 'dropped';
      match.bomb.x = player.x; match.bomb.z = player.z;
    }
  }

  input.endStep();
  hud.decay(dt);
  hud.update(state, now);
}

// ---- Player shooting: hitscan against bots, then the world ----
function firePlayerShot() {
  const { player, bots, rng } = state;
  const def = playerWeaponDef(player);
  audio.shot(def.id);
  // Muzzle flash at the barrel tip.
  camera.getWorldPosition(_v1);
  _v2.set(0.28, -0.2, -0.9).applyQuaternion(camera.quaternion).add(_v1);
  muzzleLight.position.copy(_v2);
  muzzleLight.intensity = 26;
  muzzleQuad.position.copy(_v2);
  muzzleQuad.lookAt(camera.getWorldPosition(_v3));
  muzzleQuad.material.opacity = 0.9;

  // Shot direction: camera forward + seeded spread.
  camera.getWorldDirection(_rayDir);
  const spread = currentSpread(def, player.speed, player.crouched, player.ads, player.spreadBloom * 100);
  state.spreadPx = spread * 468;
  const sx = (rng() - 0.5) * 2 * spread;
  const sy = (rng() - 0.5) * 2 * spread;
  _v3.set(1, 0, 0).applyQuaternion(camera.quaternion);
  _rayDir.addScaledVector(_v3, sx);
  _v3.set(0, 1, 0).applyQuaternion(camera.quaternion);
  _rayDir.addScaledVector(_v3, sy);
  _rayDir.normalize();
  const ox = camera.position.x, oy = camera.position.y, oz = camera.position.z;
  const range = def.range + 20;
  const ex = ox + _rayDir.x * range, ey = oy + _rayDir.y * range, ez = oz + _rayDir.z * range;

  // Nearest bot part hit (head box, then torso box).
  let bestT = Infinity, bestBot = null, bestHead = false;
  for (const b of bots) {
    if (!b.alive || b.team === 'ember') continue;
    const head = { minX: b.x - 0.17, maxX: b.x + 0.17, minY: 1.51, maxY: 1.85, minZ: b.z - 0.17, maxZ: b.z + 0.17 };
    const torso = { minX: b.x - 0.31, maxX: b.x + 0.31, minY: 0.62, maxY: 1.51, minZ: b.z - 0.18, maxZ: b.z + 0.18 };
    const th = segBox({ x: ox, y: oy, z: oz }, { x: ex, y: ey, z: ez }, head);
    const tt = segBox({ x: ox, y: oy, z: oz }, { x: ex, y: ey, z: ez }, torso);
    if (th >= 0 && th < bestT) { bestT = th; bestBot = b; bestHead = true; }
    if (tt >= 0 && tt < bestT) { bestT = tt; bestBot = b; bestHead = false; }
  }
  // World hit (nearest collider).
  const wt = world.firstHit(ox, oy, oz, ex, ey, ez);
  const worldDist = wt >= 0 ? wt * range : Infinity;
  const botDist = bestBot ? bestT * range : Infinity;

  if (bestBot && botDist < worldDist) {
    const dist = botDist;
    const dmg = damageAtRange(def, dist, bestHead);
    bestBot.hp -= dmg;
    const hx = ox + _rayDir.x * dist, hy = oy + _rayDir.y * dist, hz = oz + _rayDir.z * dist;
    spawnTracer(ox, oy, oz, hx, hy, hz);
    spawnImpact(hx, hy, hz);
    hud.hitmarker(false, state.time);
    audio.hit();
    if (bestBot.hp <= 0) {
      bestBot.hp = 0;
      bestBot.alive = false;
      bestBot.deaths += 1;
      player.kills += 1;
      player.money += 300;
      hud.pushFeed(`You ▸ ${bestBot.name}${bestHead ? ' (headshot)' : ''}`);
      hud.hitmarker(true, state.time);
      audio.kill();
      if (bestBot.hasBomb) transferBomb(bestBot);
    }
  } else if (wt >= 0) {
    const hx = ox + _rayDir.x * worldDist, hy = oy + _rayDir.y * worldDist, hz = oz + _rayDir.z * worldDist;
    spawnTracer(ox, oy, oz, hx, hy, hz);
    spawnImpact(hx, hy, hz);
  } else {
    spawnTracer(ox, oy, oz, ex, ey, ez);
  }

  // Gunshots are heard: nearby defenders rotate toward the sound.
  for (const b of bots) {
    if (b.alive && b.team === 'anvil') hearNoise(b, world, player.x, player.z, state.time);
  }
}

// The bomb's carrier died: hand it to the nearest living Ember bot.
function transferBomb(dead) {
  const { bots, match } = state;
  dead.hasBomb = false;
  let best = null, bd = Infinity;
  for (const b of bots) {
    if (!b.alive || b.team !== 'ember' || b === dead) continue;
    const d = Math.hypot(b.x - dead.x, b.z - dead.z);
    if (d < bd) { bd = d; best = b; }
  }
  if (best) {
    match.bomb.carrier = best.id;
    best.hasBomb = true;
    best.state = 'plant';
    best.route = world.route(world.nearestNode(best.x, best.z), best.site === 'A' ? 6 : 8);
    best.routeIdx = 0;
  }
}

// ---- Bot shooting resolution ----
function onBotShoot(bot, ev) {
  const res = resolveBotShot(bot, ev, state.player, state.rng);
  const sx = bot.x - Math.sin(bot.yaw) * 0.5;
  const sy = BOT_EYE;
  const sz = bot.z - Math.cos(bot.yaw) * 0.5;
  audio.shot(bot.weaponId, true);
  if (res.hit) {
    spawnTracer(sx, sy, sz, res.target.x, res.target.y, res.target.z);
    if (res.target.kind === 'player') {
      const p = state.player;
      const before = p.hp;
      damagePlayer(p, res.dmg, bot.name, state.time);
      // Damage direction for the vignette arc.
      const ang = Math.atan2(bot.x - p.x, bot.z - p.z) - (p.yaw + Math.PI);
      hud.damageFlash(ang, state.time);
      audio.hurt();
      if (!p.alive && before > 0) {
        p.deaths += 1;
        bot.kills += 1;
        hud.pushFeed(`${bot.name} ▸ You${res.head ? ' (headshot)' : ''}`);
      }
    } else {
      const t = res.target.ref;
      t.hp -= res.dmg;
      spawnImpact(res.target.x, res.target.y, res.target.z);
      if (t.hp <= 0) {
        t.hp = 0;
        t.alive = false;
        t.deaths += 1;
        bot.kills += 1;
        hud.pushFeed(`${bot.name} ▸ ${t.name}${res.head ? ' (headshot)' : ''}`);
        if (t.hasBomb) transferBomb(t);
      }
    }
  } else {
    spawnTracer(sx, sy, sz, res.ex, res.ey, res.ez);
  }
}

// ---- Grenades ----
function throwGrenade() {
  const p = state.player;
  const kind = p.grenadeSel;
  if (p.grenades[kind] <= 0) { audio.denied(); return; }
  p.grenades[kind] -= 1;
  camera.getWorldDirection(_rayDir);
  const ox = camera.position.x, oy = camera.position.y, oz = camera.position.z;
  state.grenades.push({
    x: ox, y: oy, z: oz,
    vx: _rayDir.x * 14, vy: _rayDir.y * 14 + 3.5, vz: _rayDir.z * 14,
    fuse: GRENADES[kind].fuse, kind,
  });
  audio.tone(500, 0.06, 0.15, 'square');
}

function detonateGrenade(g) {
  if (g.kind === 'frag') {
    audio.explosion();
    explodeAt(g.x, Math.max(0.5, g.y), g.z);
    const def = GRENADES.frag;
    const victims = [state.player, ...state.bots];
    for (const v of victims) {
      const isPlayer = v === state.player;
      if (!v.alive) continue;
      const d = Math.hypot(v.x - g.x, v.z - g.z);
      if (d > def.radius) continue;
      if (world.losBlocked(g.x, g.y, g.z, v.x, 1.2, v.z)) continue;
      const dmg = def.damage * (1 - d / def.radius) * 0.8 + 10;
      if (isPlayer) {
        damagePlayer(v, dmg, 'frag', state.time);
        hud.damageFlash(0, state.time);
      } else {
        v.hp -= dmg;
        if (v.hp <= 0) {
          v.hp = 0; v.alive = false; v.deaths += 1;
          hud.pushFeed(`Frag ▸ ${v.name}`);
          if (v.team === 'anvil') { state.player.kills += 1; state.player.money += 300; }
          if (v.hasBomb) transferBomb(v);
        }
      }
    }
    for (const b of state.bots) if (b.alive) hearNoise(b, world, g.x, g.z, state.time);
  } else {
    state.smokes.push({ x: g.x, y: 1.2, z: g.z, r: GRENADES.smoke.radius, until: state.time + GRENADES.smoke.duration });
    audio.burst(0.5, 800, 0.25);
  }
}

function explodeAt(x, y, z) {
  muzzleLight.position.set(x, y + 1, z);
  muzzleLight.intensity = 60;
  spawnImpact(x, y + 0.5, z);
}

// ---- Effects pools ----
function spawnTracer(x0, y0, z0, x1, y1, z1) {
  let t = tracers.find((o) => o.life <= 0) || tracers[0];
  const pos = t.line.geometry.attributes.position;
  pos.setXYZ(0, x0, y0, z0);
  pos.setXYZ(1, x1, y1, z1);
  pos.needsUpdate = true;
  t.line.visible = true;
  t.life = 0.07;
}
function spawnImpact(x, y, z) {
  let s = impacts.find((o) => o.life <= 0) || impacts[0];
  s.mesh.position.set(x, y, z);
  s.mesh.visible = true;
  s.mesh.material.opacity = 0.95;
  s.mesh.scale.setScalar(1);
  s.life = 0.25;
}

// ---- Render sync (once per rendered frame, not per sim tick) ----
function syncCamera() {
  const { player } = state;
  camera.position.set(player.x, player.eyeY + player.y, player.z);
  camera.rotation.y = player.yaw;
  camera.rotation.x = player.pitch + player.recoilPitch;
  camera.rotation.z = 0;
}

function syncRender(nowSec) {
  const { player } = state;
  // Camera follows the player: position + look, recoil as a decaying offset.
  syncCamera();
  // Halberd scope: narrow the FOV while aiming down sights.
  const wantFov = player.ads && player.current === 'halberd' ? 32 : 75;
  if (Math.abs(camera.fov - wantFov) > 0.5) {
    camera.fov += (wantFov - camera.fov) * 0.25;
    camera.updateProjectionMatrix();
  }
  // View-model bob + recoil kick + reload dip.
  const w = playerWeapon(player);
  const bob = Math.min(1, player.speed / 5) * 0.014 * Math.sin(nowSec * 9);
  const reloadDip = w.reloadT > 0 ? 0.12 : 0;
  viewGun.position.set(
    0.28 + (player.ads ? -0.14 : 0),
    -0.24 + bob - reloadDip,
    -0.5 + player.recoilPitch * 1.2,
  );
  viewGun.visible = player.alive;
  // Muzzle flash decay.
  muzzleLight.intensity = Math.max(0, muzzleLight.intensity - 400 * (1 / 60));
  if (muzzleLight.intensity <= 0.5) muzzleLight.intensity = 0;
  muzzleQuad.material.opacity = Math.max(0, muzzleQuad.material.opacity - 0.12);
  // Tracers + impacts decay.
  for (const t of tracers) {
    if (t.life > 0) {
      t.life -= 1 / 60;
      t.line.material.opacity = Math.max(0, t.life / 0.07) * 0.9;
      if (t.life <= 0) t.line.visible = false;
    }
  }
  for (const s of impacts) {
    if (s.life > 0) {
      s.life -= 1 / 60;
      s.mesh.material.opacity = Math.max(0, s.life / 0.25);
      s.mesh.scale.setScalar(1 + (0.25 - s.life) * 6);
      if (s.life <= 0) s.mesh.visible = false;
    }
  }
  // Smoke clouds: sync the pooled spheres to the live clouds.
  for (let i = 0; i < smokeMeshes.length; i++) {
    const cloud = state.smokes[i];
    const m = smokeMeshes[i];
    if (cloud) {
      m.mesh.visible = true;
      m.mesh.position.set(cloud.x, cloud.y, cloud.z);
      m.mesh.scale.setScalar(cloud.r);
      m.mesh.material.opacity = 0.42;
    } else {
      m.mesh.visible = false;
    }
  }
  // Bot meshes.
  for (const b of state.bots) syncBotMesh(b, 1 / 60);
  // Bomb glow when planted.
  if (state.match.bomb.state === 'planted') {
    const pulse = 0.6 + 0.4 * Math.sin(nowSec * 6);
    muzzleLight.position.set(state.match.bomb.x, 1.2, state.match.bomb.z);
    muzzleLight.intensity = 8 * pulse;
    muzzleLight.color.setHex(0xff5a1a);
  } else {
    muzzleLight.color.setHex(0xffb45e);
  }
}

// ---- Deterministic shot modes (?shot=buy|fight|plant|win&seed=N) ----
// Each mode builds a fixed scene from the seed, steps the sim a fixed number
// of ticks, and freezes — the same seed always gives the same pixels.
function setupShot(mode) {
  const m = { start: 'buy', play: 'fight', end: 'win' }[mode] || mode;
  const { player, bots, match } = state;
  state.paused = false;
  // Hide the start overlay in shot mode; the HUD stays visible.
  document.getElementById('overlay').hidden = true;

  if (m === 'buy') {
    // Buy phase: menu open over the spawn view, map readable behind it.
    placeRound();
    player.yaw = -Math.PI / 2;
    player.money = 3650;
    state.buyOpen = true;
    hud.renderBuy(state);
    stepSimTimes(30);
  } else if (m === 'fight') {
    // Mid-round firefight: player mid-map, a defender in the crosshair,
    // muzzle flash + tracer from a shot fired on the last tick.
    match.phase = 'live';
    match.phaseT = 74;
    state.buyOpen = false;
    player.money = 2450;
    player.weapons.vk7 = { id: 'vk7', mag: 30, reserve: 90, reloadT: 0, cooldown: 0, shotsFired: 0 };
    player.current = 'vk7';
    player.x = -4; player.z = 2; player.yaw = -Math.PI / 2; player.pitch = 0;
    const foe = bots.find((b) => b.team === 'anvil');
    foe.x = 8; foe.z = 2; foe.yaw = Math.PI / 2; foe.alive = true; foe.hp = 100;
    foe.seen = { kind: 'player', ref: player, x: player.x, y: player.eyeY, z: player.z, at: 0, dist: 12 };
    foe.reactionT = 0;
    const mate = bots.find((b) => b.team === 'ember' && b.id !== 0);
    mate.x = -8; mate.z = 4; mate.yaw = -Math.PI / 2; mate.alive = true;
    stepSimTimes(30);
    // The setup ticks are live combat: restore the staged state.
    player.hp = 100; player.alive = true; player.armour = 0;
    foe.hp = 100; foe.alive = true;
    foe.seen = { kind: 'player', ref: player, x: player.x, y: player.eyeY, z: player.z, at: state.time, dist: 12 };
    hud.feed = [];
    // One aimed shot at the defender, frozen mid-flash. The camera must be
    // synced to the player first — setup runs before the first frame.
    syncCamera();
    if (tryFire(player) === 'shot') firePlayerShot();
  } else if (m === 'plant') {
    // Device planted at Site A: bomb glow, fuse bar, a defender rotating in.
    match.phase = 'live';
    match.phaseT = 61;
    state.buyOpen = false;
    player.money = 1850;
    player.weapons.vk7 = { id: 'vk7', mag: 22, reserve: 60, reloadT: 0, cooldown: 0, shotsFired: 0 };
    player.current = 'vk7';
    player.x = 9; player.z = -3; player.yaw = -0.55; player.pitch = -0.02;
    match.bomb = { state: 'planted', site: 'A', x: SITES.A.plantX, z: SITES.A.plantZ, fuseT: 27, carrier: null };
    const rot = bots.find((b) => b.team === 'anvil');
    rot.x = 16; rot.z = 2; rot.yaw = -2.2; rot.alive = true; rot.hp = 100;
    rot.state = 'defuse';
    rot.route = world.route(world.nearestNode(rot.x, rot.z), world.nearestNode(match.bomb.x, match.bomb.z));
    rot.routeIdx = 0;
    const mate = bots.find((b) => b.team === 'ember' && b.id !== 0);
    mate.x = 14; mate.z = -16; mate.yaw = -Math.PI / 2; mate.alive = true;
    stepSimTimes(60);
    player.hp = 100; player.alive = true; player.armour = 0;
    rot.hp = 100; rot.alive = true;
    hud.feed = [];
  } else if (m === 'win') {
    // Round won: banner over the site, score updated.
    match.phase = 'roundEnd';
    match.phaseT = 3.2;
    match.scoreEmber = 1;
    match.scoreAnvil = 0;
    match.lastResult = { winner: 'ember', reason: 'Device detonated at Site A' };
    match.bomb = { state: 'exploded', site: 'A', x: SITES.A.plantX, z: SITES.A.plantZ, fuseT: 0, carrier: null };
    state.buyOpen = false;
    player.x = 10; player.z = -6; player.yaw = -0.6; player.pitch = 0;
    player.money = 3250 + 800;
    stepSimTimes(30);
  }
  hud.update(state, state.time);
  // Two clean renders, then freeze: the frame loop sets __shotReady.
  renderer.render(scene, camera);
  renderer.render(scene, camera);
}

function stepSimTimes(n) {
  for (let i = 0; i < n; i++) stepSim(DT);
}

init();
