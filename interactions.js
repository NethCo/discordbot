const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const PendingCharacter = require("./models/PendingCharacter");
const Character = require("./models/Character");
const User = require("./models/User");
const { WEBSITE_RANKINGS_URL } = require("./config");
const { getUserCharacters, getCharacterRank } = require("./leaderboard");
const { isDiscordSnowflake, resolveDiscordUserIdFromRequest } = require("./utils/discordIdentity");

const rankSelectionCache = new Map();

const ALLOWED_WORLDS = new Set(["Scania", "Bera", "Kronos", "Hyperion"]);
const NEXON_BASE = "https://www.nexon.com/api/maplestory/no-auth/ranking/v2/na";
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  "Referer": "https://www.nexon.com/maplestory/rankings/north-america/overall-ranking/legendary",
  "Accept": "application/json",
};

function saveUserRankCache(discordId, characters) {
  rankSelectionCache.set(discordId, {
    expiresAt: Date.now() + 2 * 60 * 1000,
    byId: new Map(characters.map(c => [c.id, c])),
  });
}

function getUserRankCache(discordId, charId) {
  const cache = rankSelectionCache.get(discordId);
  if (!cache) return null;
  if (Date.now() > cache.expiresAt) {
    rankSelectionCache.delete(discordId);
    return null;
  }
  return cache.byId.get(charId) || null;
}

async function fetchOverall(characterName) {
  for (const rebootIndex of [0, 1]) {
    const url = `${NEXON_BASE}?type=overall&id=legendary&reboot_index=${rebootIndex}&page_index=1&character_name=${encodeURIComponent(characterName)}`;
    try {
      const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(10_000) });
      if (!res.ok) continue;
      const json = await res.json();
      const match = json?.ranks?.[0];
      if (match) return {
        level: match.level ?? 0,
        exp: match.exp ?? 0,
        imageUrl: match.characterImgURL ?? null,
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

async function handleInteractions(client) {
  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isButton()) return;

    if (interaction.customId === "my_rank") {
      try { await interaction.deferReply({ flags: 64 }); } catch { return; }
      try {
        const result = await getUserCharacters(interaction.user.id);
        if (result.status === "no_account") {
          return interaction.editReply({ content: `❌ לא מצאתי חשבון מקושר. היכנס לאתר: **${WEBSITE_RANKINGS_URL}**` });
        }
        if (result.status === "no_characters") {
          return interaction.editReply({ content: "❌ נמצא חשבון מקושר, אך אין בו דמויות עדיין." });
        }
        const characters = result.characters;
        saveUserRankCache(interaction.user.id, characters);
        const row = new ActionRowBuilder().addComponents(
          characters.map(c =>
            new ButtonBuilder()
              .setCustomId(`rank_char_${c.id}`)
              .setLabel(`${c.name} (${c.level})`)
              .setStyle(ButtonStyle.Secondary)
          )
        );
        await interaction.editReply({ content: "בחר דמות להצגת הדירוג:", components: [row] });
        setTimeout(async () => { try { await interaction.deleteReply(); } catch {} }, 60_000);
      } catch (err) {
        console.error("שגיאה ב-my_rank:", err);
        await interaction.editReply({ content: "❌ אירעה שגיאה, נסה שוב מאוחר יותר." });
      }
      return;
    }

    if (interaction.customId.startsWith("rank_char_")) {
      try { await interaction.deferReply({ flags: 64 }); } catch { return; }
      try {
        const charId = interaction.customId.replace("rank_char_", "");
        let charData = getUserRankCache(interaction.user.id, charId);

        if (!charData) {
          const result = await getUserCharacters(interaction.user.id);
          if (result.status !== "ok") {
            return interaction.editReply({ content: "❌ לא מצאתי דמויות מקושרות לחשבון שלך." });
          }
          saveUserRankCache(interaction.user.id, result.characters);
          charData = result.characters.find(c => c.id === charId) || null;
        }

        if (!charData) return interaction.editReply({ content: "❌ דמות לא נמצאה." });

        const rank = await getCharacterRank(charData);
        const embed = new EmbedBuilder()
          .setColor(0x00ccff)
          .setTitle("📊 הדירוג שלך")
          .setDescription(
            `🍁 **${charData.name}**\n\n` +
            `🏆 מיקום כללי: **#${rank}**\n` +
            `⭐ רמה: **${charData.level}**\n` +
            `עולם: **${charData.world || "—"}**\n` +
            `עבודה: **${charData.job || "—"}**`
          )
          .setFooter({ text: "MapleStory Community Israel" });
        await interaction.editReply({ embeds: [embed], components: [] });
        setTimeout(async () => { try { await interaction.deleteReply(); } catch {} }, 60_000);
      } catch (err) {
        console.error("שגיאה ב-rank_char:", err);
        await interaction.editReply({ content: "❌ אירעה שגיאה, נסה שוב מאוחר יותר." });
      }
      return;
    }

    if (interaction.customId.startsWith("approve_") || interaction.customId.startsWith("reject_")) {
      const isApprove = interaction.customId.startsWith("approve_");
      const reqId     = interaction.customId.replace(isApprove ? "approve_" : "reject_", "");

      try { await interaction.deferUpdate(); } catch { return; }

      try {
        const req = await PendingCharacter.findById(reqId);
        if (!req) return interaction.followUp({ content: "❌ הבקשה לא נמצאה.", ephemeral: true });
        if (req.approved !== false) return interaction.followUp({ content: "הבקשה כבר טופלה.", ephemeral: true });

        if (isApprove) {
          const safeCharName = String(req.name || "").trim();
          const safeWorld = String(req.world || "").trim();
          if (!safeCharName || safeCharName.length > 12) {
            throw new Error("invalid character name length");
          }
          if (!ALLOWED_WORLDS.has(safeWorld)) {
            throw new Error("invalid world");
          }

          const [overall, fameData] = await Promise.all([
            fetchOverall(safeCharName),
            fetchFame(safeCharName),
          ]);

          const character = new Character({
            name: safeCharName,
            world: safeWorld,
            level: overall?.level ?? 0,
            exp: overall?.exp ?? 0,
            fame: fameData?.fame ?? 0,
            imageUrl: overall?.imageUrl ?? null,
            job: overall?.job ?? "",
            uid: req.uid,
            createdAt: new Date(),
          });
          await character.save();

          if (req.uid) {
            const user = await User.findById(req.uid);
            if (user) {
              const charIdStr = character._id.toString();
              const currentIds = user.characterIds || [];
              if (!currentIds.includes(charIdStr)) {
                user.characterIds = [...currentIds, charIdStr];
                await user.save();
              }
            }
          }
        }

        if (isApprove) {
          req.approved = true;
          req.handledBy = interaction.user.id;
          req.handledAt = new Date();
          await req.save();
        } else {
          await PendingCharacter.findByIdAndDelete(req._id);
        }

        const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
          .setColor(isApprove ? 0x22c55e : 0xef4444)
          .setTitle(isApprove ? "✅ בקשת דמות — אושרה" : "❌ בקשת דמות — נדחתה")
          .addFields({ name: isApprove ? "אושר על ידי" : "נדחה על ידי", value: `<@${interaction.user.id}>` });
        await interaction.editReply({ embeds: [updatedEmbed], components: [] });
      } catch (err) {
        console.error("שגיאה ב-approve/reject:", err);
        await interaction.followUp({ content: "❌ לא הצלחתי לטפל בבקשה כרגע.", ephemeral: true }).catch(() => {});
      }
      return;
    }
  });
}

module.exports = { handleInteractions };
