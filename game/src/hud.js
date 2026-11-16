// HUD: a thin DOM layer over the sim state. Updates are cheap — text is
// only rewritten when it changed — and every element is named in index.html.
// The buy menu is real DOM (pointer released while it is open); the rest of
// the HUD is pointer-events: none.
import { WEAPONS, GRENADES } from './weapons.js';
import { BUY_TIME } from './rounds.js';

function el(id) { return document.getElementById(id); }
function setText(id, v) {
  const n = el(id);
  if (n && n._v !== v) { n._v = v; n.textContent = v; }
}
function show(id, on) {
  const n = el(id);
  if (n) n.hidden = !on;
}

export function makeHud() {
  const hud = {
    feed: [],
    hitT: 0,
    hitKill: false,
    dmgFlash: 0,
    dmgDir: 0, // radians, relative to view, where the damage came from
    lastMoney: -1,
    update(state, now) {
      const { player, match, bots } = state;
      // Crosshair gap follows current spread.
      const spread = state.spreadPx || 0;
      const ch = el('crosshair');
      if (ch) ch.style.setProperty('--gap', `${(4 + spread).toFixed(1)}px`);
      show('crosshair', player.alive && match.phase === 'live' && !state.buyOpen);
      // Health / armour / ammo / money.
      setText('hp-num', String(Math.ceil(player.hp)));
      const hpBar = el('hp-bar');
      if (hpBar) hpBar.style.width = `${Math.max(0, player.hp)}%`;
      setText('armour-num', String(Math.round(player.armour)));
      const w = player.weapons[player.current];
      const def = WEAPONS[player.current];
      setText('ammo-mag', String(w ? w.mag : 0));
      setText('ammo-reserve', `/ ${w ? w.reserve : 0}`);
      el('ammo')?.classList.toggle('empty', !w || w.mag === 0);
      setText('money', `$${player.money}`);
      setText('weapon-name', def ? def.name : '');
      // Timer + score + alive counts.
      const t = Math.max(0, Math.ceil(match.phaseT));
      setText('timer', match.phase === 'buy' ? `BUY ${t}` : match.phase === 'live' ? `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}` : '');
      setText('score-ember', String(match.scoreEmber));
      setText('score-anvil', String(match.scoreAnvil));
      setText('round-num', `ROUND ${match.round}`);
      let e = player.alive ? 1 : 0, a = 0;
      for (const b of bots) { if (b.alive) { if (b.team === 'ember') e++; else a++; } }
      setText('alive-ember', '●'.repeat(e) + '○'.repeat(Math.max(0, 5 - e)));
      setText('alive-anvil', '●'.repeat(a) + '○'.repeat(Math.max(0, 5 - a)));
      // Bomb status.
      const bomb = match.bomb;
      const bs = el('bomb-status');
      if (bs) {
        let txt = '';
        if (bomb.state === 'carried') txt = player.bombCarrier ? 'DEVICE: YOU CARRY IT' : 'DEVICE: TEAMMATE CARRIES IT';
        else if (bomb.state === 'planted') txt = `DEVICE PLANTED — SITE ${bomb.site} — ${Math.ceil(bomb.fuseT)}s`;
        else if (bomb.state === 'exploded') txt = 'DEVICE DETONATED';
        else if (bomb.state === 'defused') txt = 'DEVICE DEFUSED';
        setText('bomb-status', txt);
      }
      const fuseBar = el('fuse-bar');
      if (fuseBar) fuseBar.style.width = bomb.state === 'planted' ? `${(bomb.fuseT / 35) * 100}%` : '0%';
      show('fuse-wrap', bomb.state === 'planted');
      // Plant / defuse progress.
      const pp = el('plant-progress');
      if (pp) {
        const prog = player.plantT > 0 ? player.plantT / 3 : player.defuseT > 0 ? player.defuseT / 5 : 0;
        pp.style.width = `${prog * 100}%`;
        show('plant-wrap', prog > 0);
        setText('plant-label', player.plantT > 0 ? 'PLANTING…' : 'DEFUSING…');
      }
      // Hitmarker.
      const hm = el('hitmarker');
      if (hm) {
        hm.classList.toggle('on', now - this.hitT < 0.12);
        hm.classList.toggle('kill', this.hitKill);
      }
      // Damage vignette + direction arc.
      const vg = el('vignette');
      if (vg) {
        vg.style.opacity = String(Math.min(1, this.dmgFlash + (player.hp < 30 && player.alive ? 0.35 : 0)));
        vg.style.setProperty('--dir', `${this.dmgDir}rad`);
      }
      // Round banner.
      const banner = el('banner');
      if (banner) {
        if (match.phase === 'roundEnd' && match.lastResult) {
          const won = match.lastResult.winner === 'ember';
          setText('banner-title', won ? 'ROUND WON' : 'ROUND LOST');
          setText('banner-sub', match.lastResult.reason);
          banner.className = won ? 'banner win' : 'banner lose';
          show('banner', true);
        } else if (match.phase === 'matchEnd') {
          const w = match.matchWinner;
          setText('banner-title', w === 'ember' ? 'MATCH WON' : w === 'anvil' ? 'MATCH LOST' : 'MATCH DRAW');
          setText('banner-sub', `${match.scoreEmber} — ${match.scoreAnvil} · Click Play Again to restart`);
          banner.className = 'banner win';
          show('banner', true);
        } else {
          show('banner', false);
        }
      }
      // "Click to aim" hint: live round, mouse not captured, no menu open.
      const overlayHidden = document.getElementById('overlay')?.hidden;
      show('lock-hint', match.phase === 'live' && player.alive && !state.buyOpen
        && overlayHidden && !document.pointerLockElement);
      if (state.buyOpen) this.renderBuy(state);
      show('buy-menu', state.buyOpen);
      // Kill feed.
      const feedEl = el('feed');
      if (feedEl) {
        const html = this.feed.slice(-5).map((f) => `<div>${f}</div>`).join('');
        if (feedEl._v !== html) { feedEl._v = html; feedEl.innerHTML = html; }
      }
    },
    renderBuy(state) {
      const { player } = state;
      if (this.lastMoney === player.money && this._buyRendered) return;
      this.lastMoney = player.money;
      this._buyRendered = true;
      const grid = el('buy-grid');
      if (!grid) return;
      let html = '';
      for (const def of Object.values(WEAPONS)) {
        const owned = !!player.weapons[def.id];
        const afford = player.money >= def.price;
        html += `<button class="buy-card ${owned ? 'owned' : ''} ${afford ? '' : 'poor'}" data-buy="weapon:${def.id}">
          <b>[${def.slot}] ${def.name}</b><span>$${def.price}</span>
          <i>DMG ${def.damage} · ${def.mag} rnd · ${def.auto ? 'AUTO' : 'SEMI'}</i>
          ${owned ? '<em>OWNED</em>' : ''}</button>`;
      }
      for (const def of Object.values(GRENADES)) {
        const n = player.grenades[def.id];
        html += `<button class="buy-card ${player.money >= def.price ? '' : 'poor'}" data-buy="grenade:${def.id}">
          <b>[G] ${def.name}</b><span>$${def.price}</span><i>OWNED ×${n}</i></button>`;
      }
      html += `<button class="buy-card ${player.armour >= 100 ? 'owned' : player.money >= 650 ? '' : 'poor'}" data-buy="armour">
        <b>Armour vest</b><span>$650</span><i>${player.armour >= 100 ? 'EQUIPPED' : 'Absorbs 60% damage'}</i></button>`;
      grid.innerHTML = html;
      setText('buy-money', `$${player.money}`);
      setText('buy-timer', `Buy phase ends in ${Math.max(0, Math.ceil(state.match.phaseT))}s`);
    },
    pushFeed(text) {
      this.feed.push(text);
      if (this.feed.length > 8) this.feed.shift();
    },
    hitmarker(kill, now) {
      this.hitT = now;
      this.hitKill = kill;
    },
    damageFlash(dirRad, now) {
      this.dmgFlash = 0.85;
      this.dmgDir = dirRad;
    },
    decay(dt) {
      this.dmgFlash = Math.max(0, this.dmgFlash - dt * 1.6);
    },
  };
  return hud;
}
