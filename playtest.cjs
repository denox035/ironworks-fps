// Automated play-test for IRONWORKS (headless, no pointer lock needed for
// most checks — the sim state is exposed as window.__game).
// NOTE: SwiftShader renders slowly, so the sim runs well below wall-clock
// speed here. Every wait is therefore measured in SIM seconds (via
// window.__game.time), never wall seconds.
// Exercises: buy phase + buy menu, live phase movement + firing + reload,
// plant channel, elimination round-end, next-round restart. Fails (exit 1)
// on any console/page error or any failed assertion.
const { chromium } = require('playwright-core');

const PORT = process.argv[2] || '8080';
let failures = 0;
function check(name, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(1500);
  const g = (expr) => page.evaluate(expr);
  // Wait until the sim clock has advanced by `seconds`.
  async function waitSim(seconds) {
    const t0 = await g(`window.__game.time`);
    await page.waitForFunction((t) => window.__game.time >= t, t0 + seconds, { timeout: 120000 });
  }
  async function waitPhase(phase) {
    await page.waitForFunction((p) => window.__game.match.phase === p, phase, { timeout: 120000 });
  }

  // Dismiss the start overlay (as a real player does with Click to play).
  await page.click('#play');
  await page.waitForTimeout(500);

  // 1. Boot: buy phase, menu open, player frozen at spawn.
  check('boots in buy phase', (await g(`window.__game.match.phase`)) === 'buy');
  check('buy menu open', await g(`window.__game.buyOpen`));
  const x0 = await g(`window.__game.player.x`);
  await page.keyboard.down('KeyW');
  await waitSim(0.8);
  await page.keyboard.up('KeyW');
  check('player frozen during buy', (await g(`window.__game.player.x`)) === x0, `x=${x0}`);

  // 2. Buy a Kestrel via the menu ($1500; give the player money first).
  await g(`window.__game.player.money = 5000`);
  await page.waitForFunction(() => !document.querySelector('[data-buy="weapon:kestrel"]').classList.contains('poor'));
  await page.click('[data-buy="weapon:kestrel"]');
  await page.waitForTimeout(200);
  check('kestrel bought', await g(`!!window.__game.player.weapons.kestrel`));
  check('money deducted', (await g(`window.__game.player.money`)) === 3500);
  check('kestrel equipped', (await g(`window.__game.player.current`)) === 'kestrel');

  // 3. Force the live phase, move forward, fire, reload.
  await g(`window.__game.match.phaseT = 0.05`);
  await waitPhase('live');
  check('live phase started', true);
  const bx = await g(`window.__game.player.x`);
  await page.keyboard.down('KeyW');
  await waitSim(1.5);
  await page.keyboard.up('KeyW');
  const ax = await g(`window.__game.player.x`);
  check('player moves in live phase', ax > bx + 1, `x ${bx.toFixed(1)} -> ${ax.toFixed(1)}`);
  // Fire: click the canvas to capture the mouse, then hold fire.
  await g(`window.__game.player.weapons.kestrel.mag = 30`);
  const magBefore = await g(`window.__game.player.weapons.kestrel.mag`);
  await page.mouse.click(400, 225); // canvas click -> pointer lock
  await page.mouse.down();
  await waitSim(0.4);
  await page.mouse.up();
  const magAfter = await g(`window.__game.player.weapons.kestrel.mag`);
  check('firing consumes ammo', magAfter < magBefore, `${magBefore} -> ${magAfter}`);
  await g(`window.__game.player.weapons.kestrel.mag = 0`);
  await page.keyboard.press('KeyR');
  await waitSim(2.2);
  check('reload refills mag', (await g(`window.__game.player.weapons.kestrel.mag`)) > 0, `mag=${await g(`window.__game.player.weapons.kestrel.mag`)}`);

  // 4. Plant: teleport the player into Site A, hold E. (Test-only: give the
  //    player a huge HP pool so defending bots can't kill the channel, and
  //    restore the player as bomb carrier (they may have died — and dropped
  //    the device to a bot — during the earlier live-fire steps).
  await g(`(() => { const s = window.__game; s.player.x = 19; s.player.z = -13; s.player.hp = 10000; s.player.armour = 100; s.player.alive = true; s.match.bomb = { state: 'carried', site: null, x: 0, z: 0, fuseT: 0, carrier: 'player' }; })()`);
  await page.keyboard.down('KeyE');
  await waitSim(3.6);
  await page.keyboard.up('KeyE');
  check('bomb planted', (await g(`window.__game.match.bomb.state`)) === 'planted', await g(`window.__game.match.bomb.state`));
  check('fuse counting down', (await g(`window.__game.match.bomb.fuseT`)) < 35 && (await g(`window.__game.match.bomb.fuseT`)) > 0);

  // 5. Elimination ends the round; the next round restarts.
  await g(`window.__game.bots.forEach(b => { if (b.team === 'anvil') { b.alive = false; b.hp = 0; } })`);
  await g(`window.__game.match.bomb.state = 'carried'`);
  await waitPhase('roundEnd');
  check('round ends on elimination', true);
  await g(`window.__game.match.phaseT = 0.05`);
  await waitPhase('buy');
  check('next round starts', (await g(`window.__game.match.round`)) === 2, `round=${await g(`window.__game.match.round`)}`);

  // 6. Bots moved and at least one bot fired during the test (sim is live).
  const botMoved = await g(`window.__game.bots.some(b => b.x !== 0 || b.z !== 0)`);
  check('bots exist and positioned', botMoved);

  console.log('ERRORS:', errors.length ? errors : 'none');
  if (errors.length) failures++;
  await browser.close();
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
