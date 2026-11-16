// Take the 4 deterministic screenshots for the IRONWORKS entry.
// Serves game/ on localhost:8080 (expects `node serve.ts` running from the
// repo root), loads each ?shot= mode with seed=1, waits for
// window.__shotReady, and saves a 1280x720 JPEG (quality 80).
// Usage: node shots.cjs [port]
const { chromium } = require('playwright-core');
const path = require('node:path');

const PORT = process.argv[2] || '8080';
const OUT = path.join(__dirname, 'screenshots');
const SHOTS = [
  ['buy', '1-buy.jpg'],
  ['fight', '2-fight.jpg'],
  ['plant', '3-plant.jpg'],
  ['win', '4-win.jpg'],
];

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--disable-gpu-sandbox',
    ],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  const webgl2 = await page.evaluate(() => {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    return gl ? gl.getParameter(gl.VERSION) : null;
  });
  console.log('WEBGL2:', webgl2);
  for (const [mode, file] of SHOTS) {
    await page.goto(`http://localhost:${PORT}/?shot=${mode}&seed=1`, { waitUntil: 'load', timeout: 60000 });
    try {
      await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 30000 });
      console.log(`SHOT ${mode}: ready`);
    } catch (e) {
      console.log(`SHOT ${mode}: NOT READY (${String(e.message).split('\n')[0]})`);
    }
    await page.screenshot({ path: path.join(OUT, file), type: 'jpeg', quality: 80 });
    console.log(`SAVED ${file}`);
  }
  console.log('ERRORS:', errors.length ? errors : 'none');
  await browser.close();
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
