# ironworks-fps

[![make.fun · best-game-01](https://make.fun/badge/best-game-01.svg)](https://make.fun/bounty/best-game-01?utm_source=github&utm_medium=readme&utm_campaign=best-game-01)
[![rank](https://make.fun/badge/best-game-01/denox035/ironworks-fps/rank.svg)](https://make.fun/bounty/best-game-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=best-game-01)
[![reward](https://make.fun/badge/best-game-01/denox035/ironworks-fps/reward.svg)](https://make.fun/bounty/best-game-01?utm_source=github&utm_medium=readme&utm_campaign=best-game-01)

IRONWORKS is a round-based tactical FPS in the Counter-Strike style, built with three.js: a decommissioned iron foundry at dusk, two bomb sites (Furnace Hall and Crane Yard) joined by three lanes, a 5v5 match with bot teammates and defenders, a buy-phase economy, four weapons plus frag and smoke grenades, and a plant/defuse objective. First to 7 rounds takes the match.

## Run it

```sh
node serve.ts
```

Then open http://localhost:8080. No build step, no network at runtime — the game is plain static files under `game/`, loaded as ES modules with three.js 0.187.0 vendored in `game/vendor/three/`.

## How it plays

- **You are Ember** (orange trim) with 4 bot teammates, against 5 Anvil defenders (steel-blue trim).
- **Buy phase (15 s):** spend your money on weapons, grenades and armour (keys 1–4, 5, B for the menu).
- **Round (100 s):** plant the device at Site A or B (hold E, 3 s), defend the 35 s fuse — or eliminate the defenders. Defenders win by wiping Ember, defusing (5 s), or running the clock out.
- **Gunplay:** hitscan with headshots (4x), recoil and spread that punish firing on the move and reward stopping to aim, crouch / jump / ADS (Halberd scope on right-click), reloads, tracers, hitmarkers and a kill feed.
- **Bots:** waypoint routes, a ~100° vision cone with line-of-sight checks, hearing (gunshots and the plant beep draw defenders in), 250–450 ms reaction times, and states for holding, patrolling, advancing, planting, defending, rotating, retreating and defusing.
- **Deterministic screenshots:** `?shot=buy|fight|plant|win&seed=1` stages a fixed scene from the seed and freezes on `window.__shotReady`.

## Controls

WASD move · mouse look · click fire · right-click scope · R reload · 1–5 weapons/grenade · G throw grenade · E plant (hold) · B buy menu · Ctrl/C crouch · Space jump · Shift walk (quiet, steady) · M mute.

## Files

- `main.ts` — the entry program (Node 22 stdlib only): copies `game/` + `screenshots/` to `/output` and writes `dossier.json` via the vendored make.fun library. Deterministic: two runs are byte-identical.
- `game/` — the game: `index.html` + `src/*.js` modules (one job each) + vendored three.js.
- `screenshots/` — the four deterministic entry screenshots.
- `vendor/makefun-game.ts` — the kit's dossier library, copied unchanged.

---

<sub>Entered on [make.fun](https://make.fun/?ref=6qrh79v5&utm_source=github&utm_medium=readme&utm_campaign=best-game-01) · AI agents build software for cash rewards</sub>
