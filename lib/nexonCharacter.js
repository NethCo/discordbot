const { extractCharacterImg } = require("./avatars");
const {
  NA_WORLDS,
  EU_WORLDS,
  GMS_WORLDS,
  CLASSIC_WORLDS,
  ALL_WORLDS,
  WORLD_REGION,
  WORLD_NEXON_ID,
  isClassicWorld,
} = require("./constants");
const { fetchClassicRankCharacter } = require("./classicRankCharacter");

const ALLOWED_WORLDS = new Set(ALL_WORLDS);
const ALLOWED_GMS_WORLDS = new Set(GMS_WORLDS);
const ALLOWED_CLASSIC_WORLDS = new Set(CLASSIC_WORLDS);

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
  if (isClassicWorld(world)) {
    try {
      return await fetchClassicRankCharacter(characterName, world);
    } catch (err) {
      console.error(`[ClassicRank] fetchOverall ${characterName}:`, err.message);
      return null;
    }
  }

  const worldId = WORLD_NEXON_ID[world];
  if (worldId == null) return null;

  const region = getRegion(world);
  const url =
    `${NEXON_BASE[region]}` +
    `?type=world` +
    `&id=${worldId}` +
    `&reboot_index=0` +
    `&page_index=1` +
    `&character_name=${encodeURIComponent(characterName)}` +
    `&_=${Date.now()}`;

  try {
    const res = await fetch(url, {
      headers: {
        ...nexonHeaders(world),
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      },
      signal: AbortSignal.timeout(10_000),
    });

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
  } catch (err) {
    console.error(`[NEXON] fetchOverall ${characterName}:`, err.message);
    return null;
  }
}

async function fetchFame(characterName, world) {
  if (isClassicWorld(world)) {
    // Fame is included in the ClassicRank profile scrape.
    try {
      const data = await fetchClassicRankCharacter(characterName, world);
      return data ? { fame: data.fame ?? 0 } : null;
    } catch (err) {
      console.error(`[ClassicRank] fetchFame ${characterName}:`, err.message);
      return null;
    }
  }

  const region = getRegion(world);
  const url =
    `${NEXON_BASE[region]}` +
    `?type=fame` +
    `&id=legendary` +
    `&reboot_index=0` +
    `&page_index=1` +
    `&character_name=${encodeURIComponent(characterName)}` +
    `&_=${Date.now()}`;

  try {
    const res = await fetch(url, {
      headers: {
        ...nexonHeaders(world),
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) return null;

    const json = await res.json();
    const match = json?.ranks?.[0];

    if (match) return { fame: match.exp ?? 0 };
  } catch (err) {
    console.error(`[NEXON] fetchFame ${characterName}:`, err.message);
  }
  return null;
}

/**
 * One lookup for approve/sync: ClassicRank for classic worlds, Nexon otherwise.
 * Classic returns fame on the same scrape (no second request).
 */
async function fetchCharacterStats(characterName, world) {
  if (isClassicWorld(world)) {
    try {
      const data = await fetchClassicRankCharacter(characterName, world);
      if (!data) return null;
      return {
        overall: data,
        fameData: { fame: data.fame ?? 0 },
      };
    } catch (err) {
      console.error(`[ClassicRank] fetchCharacterStats ${characterName}:`, err.message);
      return null;
    }
  }

  const [overall, fameData] = await Promise.all([
    fetchOverall(characterName, world),
    fetchFame(characterName, world),
  ]);
  if (!overall) return null;
  return { overall, fameData };
}

module.exports = {
  ALLOWED_WORLDS,
  ALLOWED_GMS_WORLDS,
  ALLOWED_CLASSIC_WORLDS,
  ALL_WORLDS,
  NA_WORLDS,
  EU_WORLDS,
  GMS_WORLDS,
  CLASSIC_WORLDS,
  isClassicWorld,
  fetchOverall,
  fetchFame,
  fetchCharacterStats,
};
