// Procedural Port Meridian: a road grid with building blocks, parks, palms, lamps and
// spawn points, all generated from one seeded rng so the same seed builds the same city.
//
// Layout: roads run along x = k*spacing and z = k*spacing for k in [-10..10] (spacing 60,
// halfExtent 300). Blocks sit between the roads; the sea is past the north edge (z < seaZ).
// Coordinates are world units, x east, z south. Heading 0 = +Z, counter-clockwise from
// above (see config.js).
import { CITY, PALETTE } from './config.js';
import { int, pick, range } from './random.js';

const { spacing, roadWidth, halfExtent } = CITY;
const halfRoad = roadWidth / 2;
/** Number of road lines per axis: -300, -240, ..., 300. */
const LINE_COUNT = Math.round((halfExtent * 2) / spacing) + 1;
/** Usable block interior: road spacing minus road width minus two sidewalks. */
const BLOCK_SIZE = spacing - roadWidth - CITY.sidewalk * 2;

/** Road centreline coordinate for line index i (0..LINE_COUNT-1). */
function lineCoord(i) {
  return -halfExtent + i * spacing;
}

/** Nearest road centreline coordinate to v (clamped to the grid). */
function nearestLine(v) {
  const k = Math.round(v / spacing);
  const clamped = Math.max(-LINE_COUNT / 2 + 0.5, Math.min(LINE_COUNT / 2 - 0.5, k));
  return clamped * spacing;
}

export function createCity(rng) {
  const buildings = [];
  const parks = [];
  const palms = [];
  const lamps = [];
  const roads = [];

  // Road segments for the minimap: one segment per road line, both axes.
  for (let i = 0; i < LINE_COUNT; i += 1) {
    const c = lineCoord(i);
    roads.push({ x1: c, z1: -halfExtent, x2: c, z2: halfExtent });
    roads.push({ x1: -halfExtent, z1: c, x2: halfExtent, z2: c });
  }

  // Buildings, one block at a time. Block (i, j) sits between road lines i/i+1 and j/j+1.
  for (let i = 0; i < LINE_COUNT - 1; i += 1) {
    for (let j = 0; j < LINE_COUNT - 1; j += 1) {
      const cx = lineCoord(i) + spacing / 2;
      const cz = lineCoord(j) + spacing / 2;
      // Distance from the centre drives height: downtown towers, low suburbs at the edge.
      const dist = Math.max(Math.abs(cx), Math.abs(cz)) / halfExtent;
      const tall = 1 - dist;

      if (rng() < CITY.parkChance) {
        parks.push({ x: cx, z: cz, size: BLOCK_SIZE });
        const palmCount = int(rng, 2, 5);
        for (let p = 0; p < palmCount; p += 1) {
          palms.push({
            x: cx + range(rng, -BLOCK_SIZE / 2 + 3, BLOCK_SIZE / 2 - 3),
            z: cz + range(rng, -BLOCK_SIZE / 2 + 3, BLOCK_SIZE / 2 - 3),
            h: range(rng, 4, 7),
          });
        }
        continue;
      }

      const count = rng() < 0.55 ? 1 : 2;
      for (let b = 0; b < count; b += 1) {
        if (buildings.length >= CITY.maxBuildings) break;
        // Two buildings split the block along its longer random axis.
        let bx = cx;
        let bz = cz;
        let w = BLOCK_SIZE;
        let d = BLOCK_SIZE;
        if (count === 2) {
          if (rng() < 0.5) {
            w = BLOCK_SIZE / 2 - 2;
            bx = cx + (b === 0 ? -w / 2 - 1 : w / 2 + 1);
          } else {
            d = BLOCK_SIZE / 2 - 2;
            bz = cz + (b === 0 ? -d / 2 - 1 : d / 2 + 1);
          }
        } else {
          w = range(rng, BLOCK_SIZE * 0.6, BLOCK_SIZE);
          d = range(rng, BLOCK_SIZE * 0.6, BLOCK_SIZE);
        }
        const h = Math.round(
          CITY.minHeight + (CITY.maxHeight - CITY.minHeight) * (0.15 + 0.85 * tall) * (0.35 + rng() * 0.65),
        );
        buildings.push({ x: bx, z: bz, w, d, h, color: pick(rng, PALETTE.buildings) });
      }
    }
  }

  // Palms along the seafront promenade (z = -halfExtent road, north edge).
  for (let x = -halfExtent + 15; x <= halfExtent - 15; x += 30) {
    palms.push({ x: x + range(rng, -4, 4), z: -halfExtent - halfRoad - 3, h: range(rng, 5, 8) });
  }
  // A few palms scattered on random sidewalks.
  for (let p = 0; p < 14; p += 1) {
    const pt = randomSidewalkPoint(rng);
    palms.push({ x: pt.x, z: pt.z, h: range(rng, 4, 7) });
  }

  // Street lamps at every other intersection, offset to the corner.
  for (let i = 0; i < LINE_COUNT; i += 2) {
    for (let j = 0; j < LINE_COUNT; j += 2) {
      lamps.push({ x: lineCoord(i) + halfRoad + 1.5, z: lineCoord(j) + halfRoad + 1.5 });
    }
  }

  /** True when (x, z) is on asphalt (within the road strip), inside the city bounds. */
  function isRoad(x, z) {
    if (x < -halfExtent - halfRoad || x > halfExtent + halfRoad) return false;
    if (z < -halfExtent - halfRoad || z > halfExtent + halfRoad) return false;
    const dx = Math.abs(x - nearestLine(x));
    const dz = Math.abs(z - nearestLine(z));
    return dx <= halfRoad || dz <= halfRoad;
  }

  /** True when the circle (x, z, radius r) touches any building (walls expanded by r). */
  function isBlocked(x, z, r) {
    for (let i = 0; i < buildings.length; i += 1) {
      const b = buildings[i];
      if (Math.abs(x - b.x) < b.w / 2 + r && Math.abs(z - b.z) < b.d / 2 + r) return true;
    }
    return false;
  }

  /** Closest point on a road centreline to (x, z), snapped to the nearer axis. */
  function nearestRoadPoint(x, z) {
    const nx = nearestLine(x);
    const nz = nearestLine(z);
    if (Math.abs(x - nx) <= Math.abs(z - nz)) return { x: nx, z };
    return { x, z: nz };
  }

  /** A random point on a random road, with a heading that runs along that road. */
  function randomRoadPoint(rngFn) {
    const alongZ = rngFn() < 0.5;
    const line = lineCoord(int(rngFn, 0, LINE_COUNT - 1));
    const along = range(rngFn, -halfExtent + 10, halfExtent - 10);
    if (alongZ) {
      return { x: line, z: along, heading: rngFn() < 0.5 ? 0 : Math.PI };
    }
    return { x: along, z: line, heading: rngFn() < 0.5 ? Math.PI / 2 : -Math.PI / 2 };
  }

  /** A random point on a sidewalk: just off a road edge, facing along the road.
   * The point sits mid-block (never near an intersection) so the sideways offset
   * cannot land it on the crossing road. */
  function randomSidewalkPoint(rngFn) {
    const alongZ = rngFn() < 0.5;
    const line = lineCoord(int(rngFn, 0, LINE_COUNT - 1));
    const blockCentre = lineCoord(int(rngFn, 0, LINE_COUNT - 2)) + spacing / 2;
    const along = blockCentre + range(rngFn, -12, 12);
    const off = halfRoad + CITY.sidewalk / 2 + 1;
    const side = rngFn() < 0.5 ? off : -off;
    if (alongZ) return { x: line + side, z: along, heading: rngFn() < 0.5 ? 0 : Math.PI };
    return { x: along, z: line + side, heading: rngFn() < 0.5 ? Math.PI / 2 : -Math.PI / 2 };
  }

  const playerSpawn = { x: 0, z: 60, heading: 0 };

  return {
    buildings,
    parks,
    palms,
    lamps,
    roads,
    bounds: { ...CITY.bounds },
    grid: { spacing, roadWidth },
    playerSpawn,
    isRoad,
    isBlocked,
    nearestRoadPoint,
    randomRoadPoint,
    randomSidewalkPoint,
  };
}
