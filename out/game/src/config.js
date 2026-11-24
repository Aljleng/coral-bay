// Vice Harbor — all tuning in one place. Game: "Vice Harbor", city "Port Meridian",
// protagonist Mara Quinn. Fictional coastal city at golden hour + neon. No Rockstar
// names or assets anywhere.
//
// HEADING CONVENTION (used by world, city and render — do not change):
// heading is in radians, 0 = facing +Z, and it grows COUNTER-CLOCKWISE when viewed
// from above (+X east, +Z south on the map). Direction vector for a heading h is
// (sin h, 0, cos h). So h=0 -> +Z, h=PI/2 -> +X, h=PI -> -Z, h=-PI/2 -> -X.
// In three.js this maps straight onto mesh.rotation.y = heading (forward = +Z).

export const GAME = {
  title: 'Vice Harbor',
  city: 'Port Meridian',
  protagonist: 'Mara Quinn',
};

/** The simulation's fixed step, in seconds: 60 updates a second whatever the display's rate. */
export const STEP = 1 / 60;

/** Default world seed; ?seed=N in the URL overrides it. */
export const DEFAULT_SEED = 1337;

export const CITY = {
  /** Distance between parallel road centrelines, in world units. */
  spacing: 60,
  /** Width of the asphalt strip of each road. */
  roadWidth: 14,
  /** Roads run from -halfExtent to +halfExtent on both axes. */
  halfExtent: 300,
  /** City bounds (roads + sidewalk margin); the sea starts just past minZ. */
  bounds: { minX: -330, maxX: 330, minZ: -330, maxZ: 330 },
  /** Where the sea plane begins (north edge, past the last road). */
  seaZ: -330,
  /** Hard cap on generated buildings (renderer pools for this many). */
  maxBuildings: 180,
  /** Fraction of blocks that become a park/plaza instead of buildings. */
  parkChance: 0.12,
  /** Building height range; downtown blocks (near centre) get the tall end. */
  minHeight: 6,
  maxHeight: 38,
  /** Sidewalk strip width on each side of a road. */
  sidewalk: 4,
};

/** On-foot movement, in world units per second. */
export const PLAYER = {
  walkSpeed: 6,
  runSpeed: 10,
  /** Seconds of sprint before Mara is winded (sprint recharges when not sprinting). */
  sprintSeconds: 4,
  radius: 0.9,
  healthMax: 100,
  /** Health regained per second while wanted is 0 and no damage was taken recently. */
  regenPerSecond: 2,
  regenDelay: 5,
};

/** Driving. Speeds are world units per second; 1 unit ~= 1 metre. */
export const CAR = {
  accel: 22,
  brake: 34,
  reverseMax: 10,
  /** Top speed per kind. */
  maxSpeed: { sedan: 26, sport: 38, taxi: 26, police: 33 },
  /** How fast a car turns at full steer, radians per second (scaled down at speed). */
  turnRate: 2.4,
  /** Radius used for collisions with buildings, peds and other cars. */
  radius: 1.6,
  /** How close Mara must be to a car to enter it. */
  enterDistance: 3.2,
  /** Damage to a ped hit at speed (scales with speed, see world). */
  hitDamage: 100,
};

/** Traffic (non-player cars) and pedestrians. */
export const TRAFFIC = {
  cars: 14,
  maxCars: 24,
  /** Traffic cruise speed range. */
  cruiseMin: 8,
  cruiseMax: 14,
  peds: 16,
  maxPeds: 28,
  walkMin: 1.2,
  walkMax: 2.2,
  /** A ped hit by a car at speed above this flees instead of just falling. */
  fleeSpeed: 6,
};

/** Police and the wanted system. */
export const POLICE = {
  maxCops: 4,
  /** Distance from the player at which a cop car spawns, on a road. */
  spawnDistance: 55,
  /** Seconds between cop spawns while wanted > 0 (shorter at higher wanted). */
  spawnInterval: 9,
  /** How long a cop keeps ramming before it backs off and re-approaches. */
  ramTime: 2.5,
  /** Wanted level at which cops start shooting (health damage per second in range). */
  shootWanted: 3,
  shootRange: 18,
  shootDps: 8,
};

export const WANTED = {
  max: 5,
  /** Seconds with no crime before wanted drops one star. */
  decaySeconds: 20,
  /** Heat added per crime. */
  carTheft: 1,
  pedHit: 1,
  copHit: 2,
};

/** Missions: cash rewards and timers, in seconds. */
export const MISSION = {
  /** Seconds of grace after a mission ends before the next one is offered. */
  cooldown: 8,
  taxiFare: 120,
  taxiTimer: 90,
  deliveryPay: 200,
  deliveryTimer: 75,
  chasePay: 350,
  chaseTimer: 60,
};

/** Third-person camera: distance/height behind the focus, lerp speed in 1/s. */
export const CAMERA = {
  followDistFoot: 11,
  followHeightFoot: 6.5,
  followDistCar: 15,
  followHeightCar: 8,
  lookAhead: 6,
  lookHeight: 1.6,
  lerpPlay: 6,
  lerpTitle: 1.2,
  overviewRadius: 230,
  overviewHeight: 120,
  overviewSpeed: 0.045,
  fov: 62,
  /** Fog that keeps the sunset haze without hiding the city in the title overview. */
  fogNear: 150,
  fogFar: 800,
};

/** In-game clock: starts at 18:30 (golden hour) and runs this many game-minutes per real second. */
export const CLOCK = {
  startMin: 18 * 60 + 30,
  minutesPerSecond: 1,
  /** The sun stays low for the whole session; clock only tints the sky slightly. */
  sunsetMin: 19 * 60 + 45,
};

/** Sunset palette: warm sky, neon signs, dark asphalt, lit windows. */
export const PALETTE = {
  skyTop: '#2b1d4e',
  skyHorizon: '#ff7a3c',
  skyBottom: '#3a1c40',
  fog: '#e8734a',
  sun: '#ffb347',
  sunGlow: '#ff5e3a',
  sea: '#0b2a4a',
  seaShore: '#123a5c',
  sand: '#c9a06a',
  ground: '#4a4450',
  sidewalk: '#6b6570',
  road: '#232028',
  roadLine: '#e8d27a',
  curb: '#8a8494',
  lampGlow: '#ffd28a',
  /** Building facade colours (sunset pastels + neon accents). */
  buildings: ['#e07856', '#e8a04c', '#c96f8e', '#7a6fb0', '#5aa3a0', '#d96a6a', '#8f7cc9', '#e0b45c', '#6fae7e', '#b0578d'],
  windowsLit: '#ffd166',
  windowsDark: '#2a2438',
  neon: ['#ff2e88', '#00e5ff', '#ffea00', '#7cff00', '#ff6b35'],
  carColors: ['#d94f3d', '#3d7ad9', '#e8c33d', '#7ad93d', '#c9c9c9', '#8a5fd9', '#e07ab0', '#2bb3a3'],
  taxi: '#f7c948',
  policeBody: '#e8e8e8',
  policeTrim: '#1c3fd9',
  pedShirts: ['#e84c4c', '#4c8ae8', '#e8c33d', '#7ae87a', '#e87ac9', '#ffffff', '#ff8c42', '#9b7ede'],
  pedSkin: ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac'],
  /** Mara Quinn: teal jacket, dark jeans — unmistakable in a crowd. */
  playerJacket: '#14b8a6',
  playerPants: '#1f2937',
  playerHair: '#1a1210',
  palmTrunk: '#6b4a2f',
  palmLeaves: '#2f7d4f',
  hudText: '#fff7ed',
  hudMuted: '#ffd9b3',
  hudDanger: '#ff4d4d',
  star: '#ffd166',
};

/** UI font stack (no webfont downloads — the game makes no network requests). */
export const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/** Where the best cash haul is kept between visits (this browser only). */
export const BEST_KEY = 'vice-harbor.best-cash';
