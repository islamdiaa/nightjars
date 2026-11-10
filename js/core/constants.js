// Shared constants for the simulation. Everything here is plain data so missions and saves can reference it by name.

export const TICK = 1 / 30;               // fixed simulation step, seconds
export const WAR_START = '1939-09-01';
export const WAR_DAYS = 2194;

// Per-tile flags (Grid.flags is a Uint32Array; bit 32768 is reserved for ropes, see grid.js).
export const F = {
  BLOCK: 1,        // nobody walks here (walls, buildings, deep cliffs)
  SIGHT: 2,        // blocks line of sight completely
  LOW: 4,          // low cover: blocks sight to prone targets and to shots at prone targets
  BUSH: 8,         // prone units inside are hidden beyond 1.5 tiles
  WATER: 16,       // shallow water: slows walkers, noisy
  DEEP: 32,        // deep water: swimmers only
  ROAD: 64,        // vehicles prefer it
  INDOOR: 128,     // inside a building footprint
  CLIMB: 256,      // cliff/ladder tile passable only by climbers (or once a rope is placed)
  NOISY: 512,      // gravel, debris: walking makes noise
  SNOW: 1024,      // leaves footprints; slows non-skiers
  FENCE: 2048,     // cuttable wire fence (also BLOCK while intact)
  DOOR: 4096,      // building entrance tile
  DARK: 8192,      // unlit area at night: halves vision range
  LIT: 16384,      // lit area: full vision range even at night
  TALL: 65536,     // tall crops, cane, elephant grass: hides anyone inside (standing too) beyond 1.5 tiles
};

// Ground types drive the painted terrain texture and footstep sounds.
export const T = {
  GRASS: 0, DIRT: 1, ROAD: 2, COBBLE: 3, SAND: 4, SNOW: 5, MUD: 6, ROCK: 7, FIELD: 8, FLOOR: 9,
  WATER: 10, DEEP: 11, DOCK: 12, CONCRETE: 13, GRAVEL: 14, ICE: 15, FOREST: 16, PADDY: 17, ASH: 18, DUNE: 19,
};
export const TERRAIN_NAMES = Object.fromEntries(Object.entries(T).map(([k, v]) => [v, k.toLowerCase()]));

export const DIFFICULTY = {
  easy: {
    label: 'Recruit', blurb: 'Slower guards, more health. Downed heroes can be revived for 60 seconds.',
    heroHp: 6, detect: 0.6, vision: 0.85, accuracy: 0.28, fireDelay: 1.5, reinforcements: 2, alarmTime: 45, bleedOut: 60, minRank: 0,
  },
  normal: {
    label: 'Veteran', blurb: 'The war as it was meant to be played. Downed heroes can be revived for 30 seconds.',
    heroHp: 4, detect: 1.0, vision: 1.0, accuracy: 0.45, fireDelay: 1.15, reinforcements: 4, alarmTime: 60, bleedOut: 30, minRank: 1,
  },
  hard: {
    label: 'Nightjar', blurb: 'Sharp-eyed guards, extra patrols, no second chances: a fallen hero ends the mission.',
    heroHp: 3, detect: 1.5, vision: 1.12, accuracy: 0.65, fireDelay: 0.9, reinforcements: 6, alarmTime: 90, bleedOut: 0, minRank: 2,
  },
};
export const DIFF_RANK = { easy: 0, normal: 1, hard: 2 };

// Movement speeds in tiles per second.
export const SPEED = { walk: 2.3, run: 4.4, prone: 0.95, carry: 1.6, swim: 1.5, patrol: 1.55, alert: 3.9, search: 2.6, ski: 3.6 };

// Enemy archetypes. Vision ranges are in tiles, fov in degrees; near is the fraction of range that also spots prone targets.
export const ENEMY_TYPES = {
  soldier:  { hp: 2, range: 9,  fov: 80, near: 0.5,  weapon: 'rifle',  label: 'Soldier' },
  sentry:   { hp: 2, range: 10, fov: 70, near: 0.5,  weapon: 'rifle',  label: 'Sentry' },
  officer:  { hp: 2, range: 10, fov: 90, near: 0.55, weapon: 'pistol', label: 'Officer', seesDisguise: true },
  gunner:   { hp: 3, range: 11, fov: 60, near: 0.45, weapon: 'mg',     label: 'Machine-gunner' },
  sniper:   { hp: 2, range: 16, fov: 36, near: 0.4,  weapon: 'rifle',  label: 'Sniper' },
  tower:    { hp: 2, range: 13, fov: 64, near: 0.35, weapon: 'mg',     label: 'Tower guard' },
  dog:      { hp: 1, range: 6,  fov: 140, near: 1.0, weapon: 'bite',   label: 'Guard dog', seesDisguise: true, nose: 4 },
  sailor:   { hp: 2, range: 8,  fov: 80, near: 0.5,  weapon: 'pistol', label: 'Sailor' },
  police:   { hp: 2, range: 9,  fov: 80, near: 0.5,  weapon: 'pistol', label: 'Policeman' },
};

// Factions also select uniforms, helmets and the language of shouts.
export const FACTIONS = {
  wehrmacht: { side: 'axis', uniform: 0x5d6550, helmet: 'stahlhelm', helmetColor: 0x4d5546, skin: 0xd9b38c },
  kriegsmarine: { side: 'axis', uniform: 0x2a3140, helmet: 'cap', helmetColor: 0x1e2430, skin: 0xd9b38c },
  luftwaffe: { side: 'axis', uniform: 0x5f6b78, helmet: 'stahlhelm', helmetColor: 0x56606b, skin: 0xd9b38c },
  ss: { side: 'axis', uniform: 0x3e4438, helmet: 'stahlhelm', helmetColor: 0x3a4036, skin: 0xd9b38c },
  italian: { side: 'axis', uniform: 0x8a7d5a, helmet: 'adrian', helmetColor: 0x6f6648, skin: 0xd2a77f },
  japanese: { side: 'axis', uniform: 0x8a7b4e, helmet: 'type90', helmetColor: 0x6e6a44, skin: 0xd6b07e },
  vichy: { side: 'axis', uniform: 0x7a6f52, helmet: 'adrian', helmetColor: 0x5d5a48, skin: 0xd9b38c },
  soviet: { side: 'axis', uniform: 0x6e6a48, helmet: 'ssh', helmetColor: 0x4f5a3a, skin: 0xd9b38c },
  neutral: { side: 'neutral', uniform: 0x4a4a58, helmet: 'cap', helmetColor: 0x2b2b35, skin: 0xd9b38c },
  // Occupied Netherlands: the dark blue of the Dutch police, peaked caps, Dutch shouts.
  dutch: { side: 'axis', uniform: 0x1d2640, helmet: 'peaked', helmetColor: 0x141a2c, skin: 0xd9b38c },
  civilian: { side: 'neutral', uniform: 0x6b5a48, helmet: 'none', helmetColor: 0x3b3028, skin: 0xd9b38c },
  allied: { side: 'allied', uniform: 0x6b6345, helmet: 'brodie', helmetColor: 0x5a5a40, skin: 0xd9b38c },
};

export const TIME_OF_DAY = ['dawn', 'morning', 'day', 'dusk', 'night'];
