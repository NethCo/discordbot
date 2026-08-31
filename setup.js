const {
  EmbedBuilder,
  PermissionFlagsBits,
  ChannelType,
  SlashCommandBuilder,
} = require("discord.js");
const GuildConfig = require("./models/GuildConfig");
const {
  upsertGuildConfig,
  normalizeWorldsInput,
  worldsLabel,
} = require("./lib/guildConfig");
const { ALL_WORLDS } = require("./lib/nexonCharacter");
const { updateLeaderboard } = require("./leaderboard");
const { updateLivesMessage } = require("./lives");

const setupCommands = [
  new SlashCommandBuilder()
    .setName("setup")
    .setDescription("הגדרת ערוצי הבוט לשרת הזה")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName("worlds")
        .setDescription("בחר אילו עולמות השרת הזה מכסה")
        .addStringOption((opt) =>
          opt
            .setName("worlds")
            .setDescription('עולמות מופרדים בפסיק, או "all" לכל העולמות')
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("leaderboard")
        .setDescription("ערוץ לדירוגים (טופ 10 + כפתורים)")
        .addChannelOption((opt) =>
          opt
            .setName("channel")
            .setDescription("ערוץ טקסט")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("lives")
        .setDescription("ערוץ לשידורים חיים")
        .addChannelOption((opt) =>
          opt
            .setName("channel")
            .setDescription("ערוץ טקסט")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("admin")
        .setDescription("ערוץ לאישור דמויות (לפי העולמות שהוגדרו)")
        .addChannelOption((opt) =>
          opt
            .setName("channel")
            .setDescription("ערוץ טקסט")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("clear")
        .setDescription("הסר הגדרת ערוץ")
        .addStringOption((opt) =>
          opt
            .setName("feature")
            .setDescription("מה להסיר")
            .setRequired(true)
            .addChoices(
              { name: "leaderboard", value: "leaderboard" },
              { name: "lives", value: "lives" },
              { name: "admin", value: "admin" },
            ),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("show")
        .setDescription("הצג את ההגדרות הנוכחיות"),
    )
    .addSubcommand((sub) =>
      sub
        .setName("refresh")
        .setDescription("רענן מיד את הדירוגים והלייבים בשרת"),
    ),
].map((cmd) => cmd.toJSON());

function formatChannel(channelId) {
  return channelId ? `<#${channelId}>` : "לא מוגדר";
}

async function handleSetupCommand(interaction, client) {
  if (!interaction.isChatInputCommand() || interaction.commandName !== "setup") return false;

  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({ content: "פקודה זו זמינה רק בשרת.", ephemeral: true });
    return true;
  }

  const sub = interaction.options.getSubcommand();

  try {
    if (sub === "worlds") {
      const worlds = normalizeWorldsInput(interaction.options.getString("worlds"));
      await upsertGuildConfig(guildId, { enabled: true, worlds });
      await interaction.reply({
        content: `✅ עולמות לשרת: **${worldsLabel({ worlds })}**\nעולמות אפשריים: ${ALL_WORLDS.join(", ")}`,
        ephemeral: true,
      });
      return true;
    }

    if (sub === "leaderboard") {
      const channel = interaction.options.getChannel("channel");
      await upsertGuildConfig(guildId, {
        enabled: true,
        leaderboardChannelId: channel.id,
        leaderboardMessageId: null,
      });
      await interaction.reply({ content: `✅ ערוץ דירוגים: ${channel}`, ephemeral: true });
      await updateLeaderboard(client);
      return true;
    }

    if (sub === "lives") {
      const channel = interaction.options.getChannel("channel");
      await upsertGuildConfig(guildId, {
        enabled: true,
        livesChannelId: channel.id,
        livesMessageId: null,
      });
      await interaction.reply({ content: `✅ ערוץ לייבים: ${channel}`, ephemeral: true });
      await updateLivesMessage(client);
      return true;
    }

    if (sub === "admin") {
      const channel = interaction.options.getChannel("channel");
      await upsertGuildConfig(guildId, { enabled: true, adminChannelId: channel.id });
      await interaction.reply({ content: `✅ ערוץ אישור דמויות: ${channel}`, ephemeral: true });
      return true;
    }

    if (sub === "clear") {
      const feature = interaction.options.getString("feature");
      const patch = { enabled: true };
      if (feature === "leaderboard") {
        patch.leaderboardChannelId = null;
        patch.leaderboardMessageId = null;
      } else if (feature === "lives") {
        patch.livesChannelId = null;
        patch.livesMessageId = null;
      } else if (feature === "admin") {
        patch.adminChannelId = null;
      }
      await upsertGuildConfig(guildId, patch);
      await interaction.reply({ content: `✅ הוסר: **${feature}**`, ephemeral: true });
      return true;
    }

    if (sub === "show") {
      const cfg = await GuildConfig.findOne({ guildId }).lean();
      if (!cfg) {
        await interaction.reply({
          content: "אין הגדרות לשרת הזה. התחל עם `/setup worlds` ואז הגדר ערוצים.",
          ephemeral: true,
        });
        return true;
      }

      const embed = new EmbedBuilder()
        .setColor(0xff6600)
        .setTitle("הגדרות הבוט לשרת")
        .addFields(
          { name: "עולמות", value: worldsLabel(cfg), inline: false },
          { name: "דירוגים", value: formatChannel(cfg.leaderboardChannelId), inline: true },
          { name: "לייבים", value: formatChannel(cfg.livesChannelId), inline: true },
          { name: "אישור דמויות", value: formatChannel(cfg.adminChannelId), inline: true },
        );

      await interaction.reply({ embeds: [embed], ephemeral: true });
      return true;
    }

    if (sub === "refresh") {
      await interaction.deferReply({ ephemeral: true });
      await updateLeaderboard(client);
      await updateLivesMessage(client);
      await interaction.editReply({ content: "✅ הדירוגים והלייבים רועננו." });
      return true;
    }
  } catch (err) {
    const message = err.message?.includes("עולמות לא תקינים")
      ? err.message
      : "❌ שגיאה בשמירת ההגדרות.";
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: message }).catch(() => {});
    } else {
      await interaction.reply({ content: message, ephemeral: true }).catch(() => {});
    }
    return true;
  }

  return false;
}

module.exports = { setupCommands, handleSetupCommand };
