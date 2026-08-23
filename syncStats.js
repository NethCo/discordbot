const Character = require("./models/Character");
const BotSync = require("./models/BotSync");
const { fetchOverall, fetchFame } = require("./lib/nexonCharacter");

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

      const world = String(char.world || "").trim();
      const [overall, fameData] = await Promise.all([
        fetchOverall(char.name, world),
        fetchFame(char.name, world),
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
