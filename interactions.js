const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { db } = require("./firebase");
const { WEBSITE_RANKINGS_URL, FIREBASE_FUNCTIONS_URL, worldIcon, jobIcon } = require("./config");
const { getUserCharacters, getCharacterRank } = require("./leaderboard");

async function handleInteractions(client) {
  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isButton()) return;

    // ── הדירוג שלי ───────────────────────────────────────────────────────────
    if (interaction.customId === "my_rank") {
      try { await interaction.deferReply({ flags: 64 }); } catch { return; }
      try {
        const characters = await getUserCharacters(interaction.user.id);
        if (!characters) {
          return interaction.editReply({ content: `❌ לא מצאתי חשבון מקושר. היכנס לאתר: **${WEBSITE_RANKINGS_URL}**` });
        }
        const row = new ActionRowBuilder().addComponents(
          characters.map(c =>
            new ButtonBuilder()
              .setCustomId(`rank_char_${c.id}`)
              .setLabel(`${jobIcon(c.job)} ${c.name} (${c.level})`)
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

    // ── בחירת דמות לדירוג ────────────────────────────────────────────────────
    if (interaction.customId.startsWith("rank_char_")) {
      try { await interaction.deferReply({ flags: 64 }); } catch { return; }
      try {
        const charId  = interaction.customId.replace("rank_char_", "");
        const charDoc = await db.collection("characters").doc(charId).get();
        if (!charDoc.exists) return interaction.editReply({ content: "❌ דמות לא נמצאה." });
        const charData = charDoc.data();
        const rank     = await getCharacterRank(charData);
        const embed = new EmbedBuilder()
          .setColor(0x00ccff)
          .setTitle("📊 הדירוג שלך")
          .setDescription(
            `🍁 **${charData.name}**\n\n` +
            `🏆 מיקום כללי: **#${rank}**\n` +
            `⭐ רמה: **${charData.level}**\n` +
            `${worldIcon(charData.world)} עולם: **${charData.world || "—"}**\n` +
            `${jobIcon(charData.job)} עבודה: **${charData.job || "—"}**`
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

    // ── אשר / דחה בקשת דמות ─────────────────────────────────────────────────
    if (interaction.customId.startsWith("approve_") || interaction.customId.startsWith("reject_")) {
      const isApprove = interaction.customId.startsWith("approve_");
      const reqId     = interaction.customId.replace(isApprove ? "approve_" : "reject_", "");

      try { await interaction.deferUpdate(); } catch { return; }

      const reqSnap = await db.collection("pendingCharacters").doc(reqId).get();
      if (!reqSnap.exists) return interaction.followUp({ content: "❌ הבקשה לא נמצאה.", ephemeral: true });
      if (reqSnap.data().status !== "pending") return interaction.followUp({ content: "הבקשה כבר טופלה.", ephemeral: true });

      const fnName = isApprove ? "approveCharacter" : "rejectCharacter";
      const fnUrl  = `${FIREBASE_FUNCTIONS_URL}/${fnName}`;

      const result = await fetch(fnUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: { reqId, handledBy: interaction.user.id } }),
      });

      if (!result.ok) {
        const err = await result.json();
        if (err?.error?.message === "already handled") return interaction.followUp({ content: "הבקשה כבר טופלה.", ephemeral: true });
        throw new Error(err?.error?.message || "unknown error");
      }

      const req = reqSnap.data();
      const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
        .setColor(isApprove ? 0x22c55e : 0xef4444)
        .setTitle(isApprove ? "✅ בקשת דמות — אושרה" : "❌ בקשת דמות — נדחתה")
        .addFields({ name: isApprove ? "אושר על ידי" : "נדחה על ידי", value: `<@${interaction.user.id}>` });
      await interaction.editReply({ embeds: [updatedEmbed], components: [] });
      await db.collection("pendingCharacters").doc(reqId).update({ botHandled: true });

      try {
        const u = await client.users.fetch(req.discordId);
        await u.send(isApprove
          ? `✅ הדמות **${req.charName}** אושרה ונוספה לחשבון שלך באתר MSC Israel!`
          : `❌ הבקשה לדמות **${req.charName}** נדחתה. פנה למנהל לפרטים נוספים.`
        );
      } catch {}
      return;
    }
  });
}

module.exports = { handleInteractions };
