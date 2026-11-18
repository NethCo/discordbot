/** Mirrored from MSIsraelnext `src/constants/index.ts`. */

const NA_WORLDS = ["Scania", "Bera", "Kronos", "Hyperion"];
const EU_WORLDS = ["Luna", "Solis"];
const GMS_WORLDS = [...NA_WORLDS, ...EU_WORLDS];
const CLASSIC_WORLDS = ["Windia", "Zenith"];
const ALL_WORLDS = [...GMS_WORLDS, ...CLASSIC_WORLDS];

const CLASSICRANK_URL = "https://classicrank.com/";
const CLASSICRANK_HOST = new URL(CLASSICRANK_URL).hostname;

const WORLD_REGION = {
  Scania: "na",
  Bera: "na",
  Kronos: "na",
  Hyperion: "na",
  Luna: "eu",
  Solis: "eu",
};

const WORLD_NEXON_ID = {
  Scania: 19,
  Bera: 1,
  Hyperion: 70,
  Kronos: 45,
  Luna: 30,
  Solis: 46,
};

/** Classic class → jobs (advancement order). */
const CLASSIC_CLASSES = {
  Warrior: ["Fighter", "Page", "Spearman", "Crusader", "White Knight", "Dragon Knight"],
  Magician: ["F/P Wizard", "I/L Wizard", "Cleric", "F/P Mage", "I/L Mage", "Priest"],
  Bowman: ["Hunter", "Crossbowman", "Ranger", "Sniper"],
  Thief: ["Bandit", "Assassin", "Hermit", "Chief Bandit"],
};

/** ClassicRank display names → our CLASSIC_CLASSES labels. */
const CLASSIC_JOB_ALIASES = {
  "Wizard (Fire/Poison)": "F/P Wizard",
  "Wizard (Ice/Lightning)": "I/L Wizard",
  "Wizard (F/P)": "F/P Wizard",
  "Wizard (I/L)": "I/L Wizard",
  "Mage (Fire/Poison)": "F/P Mage",
  "Mage (Ice/Lightning)": "I/L Mage",
  "Mage (F/P)": "F/P Mage",
  "Mage (I/L)": "I/L Mage",
};

function isClassicWorld(world) {
  return CLASSIC_WORLDS.includes(String(world || "").trim());
}

function normalizeMode(mode) {
  const m = String(mode || "global").toLowerCase();
  if (m === "classic") return "classic";
  if (m === "all") return "all";
  return "global";
}

/** Infer mode from stored mode or world (website chars may omit mode). */
function resolveCharacterMode(charOrMode, world) {
  if (charOrMode && typeof charOrMode === "object") {
    const explicit = normalizeMode(charOrMode.mode);
    if (charOrMode.mode === "classic" || charOrMode.mode === "global") return explicit;
    return isClassicWorld(charOrMode.world) ? "classic" : "global";
  }
  if (modeLooksSet(charOrMode)) return normalizeMode(charOrMode);
  return isClassicWorld(world) ? "classic" : "global";
}

function modeLooksSet(mode) {
  const m = String(mode || "").toLowerCase();
  return m === "classic" || m === "global";
}

module.exports = {
  NA_WORLDS,
  EU_WORLDS,
  GMS_WORLDS,
  CLASSIC_WORLDS,
  ALL_WORLDS,
  CLASSICRANK_URL,
  CLASSICRANK_HOST,
  WORLD_REGION,
  WORLD_NEXON_ID,
  CLASSIC_CLASSES,
  CLASSIC_JOB_ALIASES,
  isClassicWorld,
  normalizeMode,
  resolveCharacterMode,
};
