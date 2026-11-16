// Match flow: buy phase (15 s) -> live round (100 s) -> round end (4 s) ->
// next round. First to 7 wins the match (max 13 rounds). The bomb can be
// planted at A or B (3 s hold), burns a 35 s fuse, and takes 5 s to defuse.
// Economy: kill +$300, win +$3,250, loss +$1,900 + loss-streak bonus.
import { SITES } from './world.js';
import { WEAPONS, GRENADES, makeWeaponState } from './weapons.js';

export const BUY_TIME = 15;
export const ROUND_TIME = 100;
export const PLANT_TIME = 3;
export const FUSE_TIME = 35;
export const DEFUSE_TIME = 5;
export const WIN_ROUNDS = 7;
export const MAX_ROUNDS = 13;
export const KILL_REWARD = 300;
export const WIN_REWARD = 3250;
export const LOSS_REWARD = 1900;
export const LOSS_STREAK_BONUS = 500;
export const LOSS_STREAK_CAP = 2900;

export function makeMatch() {
  return {
    round: 1,
    scoreEmber: 0,
    scoreAnvil: 0,
    phase: 'buy', // 'buy' | 'live' | 'roundEnd' | 'matchEnd'
    phaseT: BUY_TIME,
    bomb: {
      state: 'carried', // 'carried' | 'planted' | 'exploded' | 'defused' | 'dropped'
      site: null, x: 0, z: 0, fuseT: 0, carrier: 'player', // 'player' | bot id
    },
    lossStreakEmber: 0,
    lossStreakAnvil: 0,
    lastResult: null, // {winner, reason} for the banner
    matchWinner: null,
    roundKills: 0,
  };
}

// Start a round: reset positions via the caller's place functions, reset the
// bomb to the player, open the buy phase.
export function startRound(match, player) {
  match.phase = 'buy';
  match.phaseT = BUY_TIME;
  match.bomb = { state: 'carried', site: null, x: 0, z: 0, fuseT: 0, carrier: 'player' };
  match.lastResult = null;
  player.bombCarrier = true;
  player.plantT = 0;
  player.defuseT = 0;
}

// Can the player plant right now? Standing inside a site, alive, carrying.
export function canPlant(match, player) {
  if (match.phase !== 'live' || !player.alive) return null;
  if (match.bomb.state !== 'carried' || match.bomb.carrier !== 'player') return null;
  for (const key of ['A', 'B']) {
    const s = SITES[key];
    const d = Math.hypot(s.x - player.x, s.z - player.z);
    if (d <= s.r) return key;
  }
  return null;
}

// Can the player defuse right now? (Only relevant if the roles ever swap;
// kept for completeness — the player is always Ember here, so this is
// normally unused, but the HUD reads it.)
export function canDefuse(match, player) {
  if (match.phase !== 'live' || !player.alive) return false;
  if (match.bomb.state !== 'planted') return false;
  const d = Math.hypot(match.bomb.x - player.x, match.bomb.z - player.z);
  return d <= 2.2;
}

export function plantBomb(match, player, site) {
  match.bomb = { state: 'planted', site, x: SITES[site].plantX, z: SITES[site].plantZ, fuseT: FUSE_TIME, carrier: null };
  player.bombCarrier = false;
  player.plantT = 0;
}

// Economy: pay out a round result and set up the next round or the match end.
export function endRound(match, player, bots, winner, reason) {
  match.lastResult = { winner, reason };
  const emberWon = winner === 'ember';
  if (emberWon) {
    match.scoreEmber += 1;
    match.lossStreakEmber = 0;
    match.lossStreakAnvil += 1;
  } else {
    match.scoreAnvil += 1;
    match.lossStreakAnvil = 0;
    match.lossStreakEmber += 1;
  }
  const emberBonus = emberWon
    ? WIN_REWARD
    : Math.min(LOSS_REWARD + (match.lossStreakEmber - 1) * LOSS_STREAK_BONUS, LOSS_STREAK_CAP);
  const anvilBonus = !emberWon
    ? WIN_REWARD
    : Math.min(LOSS_REWARD + (match.lossStreakAnvil - 1) * LOSS_STREAK_BONUS, LOSS_STREAK_CAP);
  player.money += emberBonus;
  for (const b of bots) {
    if (!b.alive) continue;
    // Bot money is tracked loosely: only the display matters for teammates.
    b.money = (b.money || 1500) + (b.team === 'ember' ? emberBonus : anvilBonus);
  }
  match.phase = 'roundEnd';
  match.phaseT = 4;
  if (match.scoreEmber >= WIN_ROUNDS || match.scoreAnvil >= WIN_ROUNDS || match.round >= MAX_ROUNDS) {
    match.matchWinner = match.scoreEmber > match.scoreAnvil ? 'ember'
      : match.scoreAnvil > match.scoreEmber ? 'anvil' : 'draw';
  }
  return { emberBonus, anvilBonus };
}

export function nextRound(match, player) {
  if (match.matchWinner) {
    match.phase = 'matchEnd';
    match.phaseT = 0;
    return;
  }
  match.round += 1;
  startRound(match, player);
}

// Buy a weapon / grenade / armour. Returns {ok, reason}.
export function buy(player, kind, id) {
  if (kind === 'weapon') {
    const def = WEAPONS[id];
    if (!def) return { ok: false, reason: 'unknown weapon' };
    if (player.weapons[id]) return { ok: false, reason: 'already owned' };
    if (player.money < def.price) return { ok: false, reason: 'not enough money' };
    player.money -= def.price;
    player.weapons[id] = makeWeaponState(id);
    player.current = id;
    return { ok: true };
  }
  if (kind === 'grenade') {
    const def = GRENADES[id];
    if (!def) return { ok: false, reason: 'unknown grenade' };
    if (player.money < def.price) return { ok: false, reason: 'not enough money' };
    player.money -= def.price;
    player.grenades[id] += 1;
    return { ok: true };
  }
  if (kind === 'armour') {
    if (player.armour >= 100) return { ok: false, reason: 'armour full' };
    if (player.money < 650) return { ok: false, reason: 'not enough money' };
    player.money -= 650;
    player.armour = 100;
    return { ok: true };
  }
  return { ok: false, reason: 'unknown item' };
}

// Alive counts per team (player counts for Ember).
export function aliveCounts(player, bots) {
  let ember = player.alive ? 1 : 0;
  let anvil = 0;
  for (const b of bots) {
    if (!b.alive) continue;
    if (b.team === 'ember') ember += 1; else anvil += 1;
  }
  return { ember, anvil };
}

// Check elimination / timer win conditions. Returns a winner + reason or null.
export function checkWin(match, player, bots) {
  if (match.phase !== 'live') return null;
  const { ember, anvil } = aliveCounts(player, bots);
  if (match.bomb.state === 'planted') {
    if (ember === 0) {
      // Defenders still have to defuse; the round only ends on the fuse or
      // the defuse. If Ember is wiped with the bomb planted, Anvil must still
      // defuse — but with nobody left to stop them, the fuse decides it.
      return null;
    }
    return null;
  }
  if (anvil === 0) return { winner: 'ember', reason: 'Anvil team eliminated' };
  if (ember === 0) return { winner: 'anvil', reason: 'Ember team eliminated' };
  return null;
}
