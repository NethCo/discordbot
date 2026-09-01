const { extractCharacterImg } = require("./avatars");
const NA_WORLDS = ["Scania", "Bera", "Kronos", "Hyperion"];
const EU_WORLDS = ["Luna", "Solis"];
const ALLOWED_WORLDS = new Set([...NA_WORLDS, ...EU_WORLDS]);

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

const NEXON_BASE = {
  na: "https://www.nexon.com/api/maplestory/no-auth/ranking/v2/na",
  eu: "https://www.nexon.com/api/maplestory/no-auth/ranking/v2/eu",
};

const NEXON_REFERER_REGION = {
  na: "north-america",
  eu: "europe",
};

function getRegion(world) {
  return WORLD_REGION[world] ?? "na";
}

function nexonHeaders(world) {
  const region = getRegion(world);
  const refererRegion = NEXON_REFERER_REGION[region];
  return {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    Referer: `https://www.nexon.com/maplestory/rankings/${refererRegion}/world-ranking/legendary`,
    Accept: "application/json",
  };
}

async function fetchOverall(characterName, world) {
  const worldId = WORLD_NEXON_ID[world];
  if (worldId == null) return null;

  const region = getRegion(world);
  const url = `${NEXON_BASE[region]}?type=world&id=${worldId}&reboot_index=0&page_index=1&character_name=${encodeURIComponent(characterName)}`;
  try {
    const res = await fetch(url, { headers: nexonHeaders(world), signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const json = await res.json();
    const match = json?.ranks?.[0];
    if (!match) return null;
    return {
      lvl: match.level ?? 0,
      exp: match.exp ?? 0,
      img: extractCharacterImg(match.characterImgURL ?? null),
      job: match.jobName ?? "",
    };
  } catch {}
  return null;
}

async function fetchFame(characterName, world) {
  const region = getRegion(world);
  const url = `${NEXON_BASE[region]}?type=fame&id=legendary&reboot_index=0&page_index=1&character_name=${encodeURIComponent(characterName)}`;
  try {
    const res = await fetch(url, { headers: nexonHeaders(world), signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const json = await res.json();
    const match = json?.ranks?.[0];
    if (match) return { fame: match.exp ?? 0 };
  } catch {}
  return null;
}

const ALL_WORLDS = [...NA_WORLDS, ...EU_WORLDS];

module.exports = { ALLOWED_WORLDS, ALL_WORLDS, fetchOverall, fetchFame };
