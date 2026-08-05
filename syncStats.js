const Character = require("./models/Character");
const BotSync = require("./models/BotSync");

const NEXON_BASE = "https://www.nexon.com/api/maplestory/no-auth/ranking/v2/na";
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  "Referer": "https://www.nexon.com/maplestory/rankings/north-america/overall-ranking/legendary",
  "Accept": "application/json",
};

async function fetchOverall(characterName) {
  for (const rebootIndex of [0, 1]) {
    const url = `${NEXON_BASE}?type=overall&id=legendary&reboot_index=${rebootIndex}&page_index=1&character_name=${encodeURIComponent(characterName)}`;
    try {
      const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(10_000) });
      if (!res.ok) continue;
      const json = await res.json();
      const match = json?.ranks?.[0];
      if (match) return {
        lvl: match.level ?? 0,
        exp: match.exp ?? 0,
        img: match.characterImgURL ?? null,
        job: match.jobName ?? "",
      };
    } catch {}
  }
  return null;
}

async function fetchFame(characterName) {
  for (const rebootIndex of [0, 1]) {
    const url = `${NEXON_BASE}?type=fame&id=legendary&reboot_index=${rebootIndex}&page_index=1&character_name=${encodeURIComponent(characterName)}`;
    try {
      const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(10_000) });
      if (!res.ok) continue;
      const json = await res.json();
      const match = json?.ranks?.[0];
      if (match) return { fame: match.exp ?? 0 };
    } catch {}
  }
  return null;
}

async function writeSyncStatus(status, extra = {}) {
  const update = {
    rankingsLastSyncSource: "discordbot.syncStats",
    rankingsLastSyncResult: status,
    rankingsLastSyncAt: status === "ok" ? new Date() : undefined,
    rankingsLastAttemptAt: new Date(),
    ...extra,
  };
  await BotSync.findByIdAndUpdate("syncStatus", update, { upsert: true });
}

async function syncCharacterStats() {
  const startedAt = new Date();
  try {
    const chars = await Character.find().lean();
    if (!chars.length) {
      await writeSyncStatus("no-characters", { totalCharacters: 0, updatedCharacters: 0, startedAt, finishedAt: new Date() });
      console.log("🔄 סינכרון סטטיסטיקות: אין דמויות בדירוג");
      return;
    }

    let updated = 0;
    let missing = 0;
    for (const char of chars) {
      if (!char.name) continue;

      const [overall, fameData] = await Promise.all([
        fetchOverall(char.name),
        fetchFame(char.name),
      ]);

      if (!overall && !fameData) { missing++; continue; }

      const updates = {};
      if (overall) { updates.lvl = overall.lvl; updates.exp = overall.exp; updates.img = overall.img; updates.job = overall.job; }
      if (fameData) { updates.fame = fameData.fame; }

      await Character.updateOne({ _id: char._id }, { $set: updates });
      updated++;
    }

    await writeSyncStatus("ok", {
      totalCharacters: chars.length,
      updatedCharacters: updated,
      missingCharacters: missing,
      startedAt,
      finishedAt: new Date(),
    });
    console.log(`🔄 סינכרון סטטיסטיקות הושלם: עודכן ${updated}/${chars.length} (לא נמצאו: ${missing})`);
  } catch (err) {
    console.error("❌ שגיאה בסינכרון סטטיסטיקות:", err);
    try {
      await writeSyncStatus("error", { rankingsLastSyncError: String(err?.message || err), startedAt, finishedAt: new Date() });
    } catch {}
  }
}

module.exports = { syncCharacterStats };
