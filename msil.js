const {
  EmbedBuilder,
  PermissionFlagsBits,
  ChannelType,
  SlashCommandBuilder,
} = require("discord.js");
const GuildConfig = require("./models/GuildConfig");
const { upsertGuildConfig, worldsLabel } = require("./lib/guildConfig");
const { updateLeaderboardForMode } = require("./leaderboard");
const { updateLivesMessage } = require("./lives");

const TEXT_CHANNELS = [ChannelType.GuildText, ChannelType.GuildAnnouncement];

const msilCommands = [
  new SlashCommandBuilder()
    .setName("msil")
    .setDescription("הגדרות בוט MS Israel לשרת הזה")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName("rankings")
        .setDescription("הגדר ערוצי לוחות דירוגים (Global ו/או Classic)")
        .addChannelOption((opt) =>
          opt
            .setName("global")
            .setDescription("ערוץ ל־Global Rankings")
            .addChannelTypes(...TEXT_CHANNELS)
            .setRequired(false),
        )
        .addChannelOption((opt) =>
          opt
            .setName("classic")
            .setDescription("ערוץ ל־Classic Rankings")
            .addChannelTypes(...TEXT_CHANNELS)
            .setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("lives")
        .setDescription("הגדר ערוץ לשידורים חיים")
        .addChannelOption((opt) =>
          opt
            .setName("channel")
            .setDescription("ערוץ טקסט ללייבים")
            .addChannelTypes(...TEXT_CHANNELS)
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("admin")
        .setDescription("הגדר ערוץ לאישור בקשות דמויות")
        .addChannelOption((opt) =>
          opt
            .setName("channel")
            .setDescription("ערוץ טקסט לאישורים")
            .addChannelTypes(...TEXT_CHANNELS)
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("show")
        .setDescription("הצג את הערוצים וההגדרות הנוכחיים"),
    )
    .addSubcommand((sub) =>
      sub
        .setName("clear")
        .setDescription("נקה את כל בחירות הערוצים בשרת הזה"),
    ),
].map((cmd) => cmd.toJSON());

function formatChannel(channelId) {
  return channelId ? `<#${channelId}>` : "לא מוגדר";
}

function canManageGuild(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) === true;
}

async function handleMsilCommand(interaction, client) {
  if (!interaction.isChatInputCommand() || interaction.commandName !== "msil") return false;

  if (!interaction.guildId) {
    await interaction.reply({ content: "פקודה זו זמינה רק בתוך שרת.", ephemeral: true });
    return true;
  }

  if (!canManageGuild(interaction)) {
    await interaction.reply({
      content: "❌ אין לך הרשאה. נדרשת הרשאת **Manage Server**.",
      ephemeral: true,
    });
    return true;
  }

  const sub = interaction.options.getSubcommand();

  try {
    if (sub === "rankings") {
      const globalChannel = interaction.options.getChannel("global");
      const classicChannel = interaction.options.getChannel("classic");

      if (!globalChannel && !classicChannel) {
        await interaction.reply({
          content: "❌ צריך לבחור לפחות ערוץ אחד: `global` ו/או `classic`.",
          ephemeral: true,
        });
        return true;
      }

      const patch = { enabled: true };
      const lines = [];
      const modesToRefresh = [];

      if (globalChannel) {
        patch.globalLeaderboardChannelId = globalChannel.id;
        patch.globalLeaderboardMessageId = null;
        lines.push(`Global: ${globalChannel}`);
        modesToRefresh.push("global");
      }
      if (classicChannel) {
        patch.classicLeaderboardChannelId = classicChannel.id;
        patch.classicLeaderboardMessageId = null;
        lines.push(`Classic: ${classicChannel}`);
        modesToRefresh.push("classic");
      }

      await upsertGuildConfig(interaction.guildId, patch);
      await interaction.reply({
        content: `✅ ערוצי דירוגים עודכנו:\n${lines.join("\n")}\nמפרסם עכשיו…`,
        ephemeral: true,
      });

      for (const mode of modesToRefresh) {
        await updateLeaderboardForMode(client, mode);
      }
      return true;
    }

    if (sub === "lives") {
      const channel = interaction.options.getChannel("channel");
      await upsertGuildConfig(interaction.guildId, {
        enabled: true,
        livesChannelId: channel.id,
        livesMessageId: null,
      });
      await interaction.reply({
        content: `✅ ערוץ לייבים: ${channel}\nמפרסם עכשיו…`,
        ephemeral: true,
      });
      await updateLivesMessage(client);
      return true;
    }

    if (sub === "admin") {
      const channel = interaction.options.getChannel("channel");
      await upsertGuildConfig(interaction.guildId, {
        enabled: true,
        adminChannelId: channel.id,
      });
      await interaction.reply({
        content: `✅ ערוץ אישור דמויות: ${channel}`,
        ephemeral: true,
      });
      return true;
    }

    if (sub === "show") {
      const cfg = await GuildConfig.findOne({ guildId: interaction.guildId }).lean();
      if (!cfg) {
        await interaction.reply({
          content:
            "אין הגדרות לשרת הזה עדיין.\n" +
            "השתמש ב־`/msil rankings`, `/msil lives`, `/msil admin`.",
          ephemeral: true,
        });
        return true;
      }

      const embed = new EmbedBuilder()
        .setColor(0xff6600)
        .setTitle("הגדרות MSIL לשרת")
        .addFields(
          { name: "עולמות (DB בלבד)", value: worldsLabel(cfg), inline: false },
          { name: "Global Rankings", value: formatChannel(cfg.globalLeaderboardChannelId), inline: true },
          { name: "Classic Rankings", value: formatChannel(cfg.classicLeaderboardChannelId), inline: true },
          { name: "Lives", value: formatChannel(cfg.livesChannelId), inline: true },
          { name: "Admin", value: formatChannel(cfg.adminChannelId), inline: true },
        );

      await interaction.reply({ embeds: [embed], ephemeral: true });
      return true;
    }

    if (sub === "clear") {
      await upsertGuildConfig(interaction.guildId, {
        enabled: true,
        globalLeaderboardChannelId: null,
        globalLeaderboardMessageId: null,
        classicLeaderboardChannelId: null,
        classicLeaderboardMessageId: null,
        livesChannelId: null,
        livesMessageId: null,
        adminChannelId: null,
      });
      await interaction.reply({
        content: "✅ כל בחירות הערוצים נוקו (הגדרות worlds ב־DB נשארו כמו שהן).",
        ephemeral: true,
      });
      return true;
    }
  } catch (err) {
    console.error("/msil error:", err);
    const message = "❌ שגיאה בשמירת ההגדרות.";
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content: message, ephemeral: true }).catch(() => {});
    } else {
      await interaction.reply({ content: message, ephemeral: true }).catch(() => {});
    }
    return true;
  }

  return false;
}

module.exports = { msilCommands, handleMsilCommand };
