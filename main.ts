// IRONWORKS — a three.js tactical FPS entry for make.fun threejs-fps-01.
// Node 22, standard library only. The game is the game/ folder beside this
// file: plain static files the browser loads as ES modules, three.js from an
// import map, no build step, no network at runtime. This program copies
// game/ and screenshots/ to /output and writes /output/dossier.json, the
// summary the judge reads, with the vendored make.fun library.
//
// Serve it locally with `node serve.ts`, then open http://localhost:8080.
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   MAKEFUN_OUTPUT_DIR=out node main.ts
// The output is deterministic: two runs produce byte-identical trees.
// Pre-flight checks fail fast with a plain message when a screenshot is
// missing or over the cap, instead of letting the dossier step fail obscurely.

import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const MAX_SHOTS = 4;
const MAX_SHOT_BYTES = 262144;

// Pre-flight: the entry needs 3–4 screenshots, each a JPEG under the cap.
const shotsDir = join(here, 'screenshots');
const shots = existsSync(shotsDir)
  ? readdirSync(shotsDir).filter((f) => /\.jpe?g$/i.test(f)).sort()
  : [];
if (shots.length < 3 || shots.length > MAX_SHOTS) {
  throw new Error(`expected 3–${MAX_SHOTS} screenshots in screenshots/, found ${shots.length}`);
}
for (const shot of shots) {
  const size = statSync(join(shotsDir, shot)).size;
  if (size > MAX_SHOT_BYTES) {
    throw new Error(`screenshot ${shot} is ${size} bytes, over the ${MAX_SHOT_BYTES} cap`);
  }
}

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
cpSync(shotsDir, join(out, 'screenshots'), { recursive: true });

// The scorer's own caps (reference/gate.json): only text_max_bytes shapes the
// bytes; the others refuse an entry the scorer would refuse (more than 4
// screenshots or one over 256 KiB; more than 993 files in game/ or 48 MiB of
// game files, in all: game/ counts beside /output's own 1000-entry cap, its
// screenshots/ and dossier.json).
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: MAX_SHOTS, max_bytes: MAX_SHOT_BYTES },
    game_max_files: 993,
    game_max_bytes: 50331648,
  }),
);

console.log(`IRONWORKS: wrote ${out} (game/ + ${shots.length} screenshots + dossier.json)`);
