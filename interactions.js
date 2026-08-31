const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const PendingCharacter = require("./models/PendingCharacter");
const Character = require("./models/Character");
const User = require("./models/User");
const { WEBSITE_RANKINGS_URL } = require("./config");
const { applyUpdatedLine, parseUpdatedAtFromLine } = require("./lib/embedUpdatedLine");
const {
  getUserCharacters,
  getCharactersAroundRank,
  attachProfileUrls,
  resolveCharacterAvatar,
  formatLvJobWorldLine,
  ensureLeaderboardFooter,
  buildRankNeighborFields,
  LEADERBOARD_UPDATE_INTERVAL_TEXT,
} = require("./leaderboard");
const { updateAllAdminRequestMessages } = require("./verification");
const { ALLOWED_WORLDS, fetchOverall, fetchFame } = require("./lib/nexonCharacter");

const rankSelectionCache = new Map();

function saveUserRankCache(discordId, characters) {
  rankSelectionCache.set(discordId, {
    expiresAt: Date.now() + 2 * 60 * 1000,
    byId: new Map(characters.map((c) => [c.id, c])),
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

async function buildPersonalRankEmbed({ charData, neighbors, avatarUrl, client }) {
  const name = String(charData.name || "Character");
  const statsLine = formatLvJobWorldLine(charData);
  const updatedLine = await ensureLeaderboardFooter(client);
  const updatedAt = parseUpdatedAtFromLine(updatedLine) || Date.now();

  let embed = new EmbedBuilder()
    .setColor(0xff6600)
    .setTitle(name)
    .setAuthor({
      name: "MSIsrael.gg",
      url: WEBSITE_RANKINGS_URL,
    })
    .setDescription(`\u200E${statsLine}`)
    .addFields(...buildRankNeighborFields(neighbors));

  embed = applyUpdatedLine(embed, updatedAt, LEADERBOARD_UPDATE_INTERVAL_TEXT);

  if (avatarUrl) {
    embed.setThumbnail(avatarUrl);
  }

  return embed;
}

async function replyWithPersonalRank(interaction, charData) {
  const [neighbors, avatarUrl] = await Promise.all([
    getCharactersAroundRank(charData),
    resolveCharacterAvatar(charData),
  ]);
  const embed = await buildPersonalRankEmbed({
    charData,
    neighbors,
    avatarUrl,
    client: interaction.client,
  });

  await interaction.editReply({ content: null, embeds: [embed], components: [] });
  setTimeout(async () => { try { await interaction.deleteReply(); } catch {} }, 60_000);
}

async function handleMyRankRequest(interaction, discordUserId) {
  const result = await getUserCharacters(discordUserId);
  if (result.status === "no_account") {
    await interaction.editReply({
      content: `No linked account found. Sign in at **${WEBSITE_RANKINGS_URL}**`,
    });
    return;
  }
  if (result.status === "no_characters") {
    await interaction.editReply({ content: "Your account has no registered characters yet." });
    return;
  }

  const [characters] = await Promise.all([attachProfileUrls(result.characters)]);
  saveUserRankCache(discordUserId, characters);

  if (characters.length === 1) {
    await replyWithPersonalRank(interaction, characters[0]);
    return;
  }

  const row = new ActionRowBuilder().addComponents(
    characters.map((c) =>
      new ButtonBuilder()
        .setCustomId(`rank_char_${c.id}`)
        .setLabel(`${c.name} (${c.lvl})`)
        .setStyle(ButtonStyle.Secondary),
    ),
  );
  await interaction.editReply({
    content: "Select a character to view your rank:",
    components: [row],
  });
  setTimeout(async () => { try { await interaction.deleteReply(); } catch {} }, 60_000);
}

async function handleInteractions(client) {
  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isButton()) return;

    if (interaction.customId === "my_rank") {
      try { await interaction.deferReply({ flags: 64 }); } catch { return; }
      try {
        await handleMyRankRequest(interaction, interaction.user.id);
      } catch (err) {
        console.error("my_rank error:", err);
        await interaction.editReply({ content: "Something went wrong. Please try again later." });
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
            return interaction.editReply({ content: "No linked characters found on your account." });
          }
          const [characters] = await Promise.all([
            attachProfileUrls(result.characters),
          ]);
          saveUserRankCache(interaction.user.id, characters);
          charData = characters.find((c) => c.id === charId) || null;
        }

        if (!charData) return interaction.editReply({ content: "Character not found." });

        await replyWithPersonalRank(interaction, charData);
      } catch (err) {
        console.error("rank_char error:", err);
        await interaction.editReply({ content: "Something went wrong. Please try again later." });
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
        if (req.approved !== false || req.rejected) return interaction.followUp({ content: "הבקשה כבר טופלה.", ephemeral: true });

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
            fetchOverall(safeCharName, safeWorld),
            fetchFame(safeCharName, safeWorld),
          ]);

          if (!overall) {
            throw new Error("character not found on world");
          }

          const character = new Character({
            name: safeCharName,
            world: safeWorld,
            lvl: overall?.lvl ?? 0,
            exp: overall?.exp ?? 0,
            fame: fameData?.fame ?? 0,
            img: overall?.img ?? null,
            job: overall?.job ?? "",
            uid: req.uid,
          });
          await character.save();

          if (req.uid) {
            const user = await User.findById(req.uid);
            if (user) {
              const charId = character._id;
              const currentIds = user.charIds || [];
              if (!currentIds.some(id => String(id) === String(charId))) {
                user.charIds = [...currentIds, charId];
                await user.save();
              }
            }
          }
        }

        const handlerMention = `<@${interaction.user.id}>`;

        if (isApprove) {
          req.approved = true;
          req.handledBy = interaction.user.id;
          req.handledAt = new Date();
          req.discordHandled = true;
          await req.save();
          await updateAllAdminRequestMessages(client, req, true, handlerMention);
        } else {
          await updateAllAdminRequestMessages(client, req, false, handlerMention);
          await PendingCharacter.findByIdAndDelete(req._id);
        }

        if (interaction.message?.embeds?.[0]) {
          const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
            .setColor(isApprove ? 0x22c55e : 0xef4444)
            .setTitle(isApprove ? "✅ בקשת דמות — אושרה" : "❌ בקשת דמות — נדחתה")
            .addFields({ name: isApprove ? "אושר על ידי" : "נדחה על ידי", value: handlerMention });
          await interaction.editReply({ embeds: [updatedEmbed], components: [] });
        }
      } catch (err) {
        console.error("שגיאה ב-approve/reject:", err);
        await interaction.followUp({ content: "❌ לא הצלחתי לטפל בבקשה כרגע.", ephemeral: true }).catch(() => {});
      }
      return;
    }
  });
}

module.exports = { handleInteractions };
