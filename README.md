# Coral Bay — an open-world crime game

[![gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01)
[![rank](https://make.fun/badge/gta6-01/Aljleng/gta6-game/rank.svg)](https://make.fun/bounty/gta6-01)
[![reward](https://make.fun/badge/gta6-01/Aljleng/gta6-game/reward.svg)](https://make.fun/bounty/gta6-01)

Coral Bay is an original open-world crime game in the spirit of GTA 6, built
for the make.fun `gta6-01` bounty. You play a driver trying to make a name in
a sun-soaked coastal city: cruise the streets, steal cars, outrun the police,
and work through a chain of story missions — getaways, deliveries, and
chases across Coral Bay.

The game is fully original: a hand-built 3D city, original characters and
missions, and synthesized sound. No assets from any GTA title are used.

## Controls

| Key | Action |
| --- | --- |
| W / A / S / D or Arrow keys | Drive & walk |
| Shift | Run |
| E | Enter / exit car |
| F | Steal / punch |
| Space | Brake |
| Esc | Pause |
| M | Mute |
| R | Restart mission |

## Run locally

```sh
node serve.ts
```

Then open <http://localhost:8080> in a desktop browser.

## Build the entry

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

This copies `game/` and `screenshots/` into `out/` and writes
`out/dossier.json`, the summary the judge reads.

## Tech

- three.js r149, vendored under `game/vendor/` — no CDN, no network
- WebAudio synthesized sound effects and music — no audio files
- Plain ES modules, no build step
- Node 22 standard library only for the entrypoint (`main.ts`) and the
  local dev server (`serve.ts`)
