const { EmbedBuilder } = require("discord.js");
const { WEBSITE_URL } = require("./config");
const {
  getGuildConfig,
  getGuildsWithMemberCount,
  getGuildsWithWelcome,
} = require("./lib/guildConfig");

const MEMBER_COUNT_INTERVAL_MS = 10 * 60 * 1000;

/** guildId → members already fetched into cache */
const membersFetchedByGuild = new Set();
/** guildIds that need a member-count channel rename */
const dirtyGuildIds = new Set();
let intervalStarted = false;

function formatFooterDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jerusalem",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date).replace(",", "");
}

function humanMemberCount(guild) {
  const humans = guild.members.cache.filter(m => !m.user.bot).size;
  // Cache may be incomplete before a full fetch — fall back to Discord's total.
  if (humans > 0) return humans;
  return guild.memberCount || 0;
}

async function ensureMembersCached(guild) {
  if (membersFetchedByGuild.has(guild.id) && guild.members.cache.size > 0) return;
  await guild.members.fetch();
  membersFetchedByGuild.add(guild.id);
}

async function updateOneMemberCountChannel(client, cfg, { force = false } = {}) {
  const guildId = cfg.guildId;
  if (!force && !dirtyGuildIds.has(guildId)) return;

  const channel = await client.channels.fetch(cfg.memberCountChannelId);
  if (!channel?.guildId || channel.guildId !== guildId) {
    console.error(`❌ ערוץ חברים לא תקין: ${cfg.memberCountChannelId} (guild ${guildId})`);
    return;
  }

  await ensureMembersCached(channel.guild);
  const count = humanMemberCount(channel.guild);
  const newName = `👪 ${count} משתמשים`;

  dirtyGuildIds.delete(guildId);
  if (channel.name === newName) return;

  await channel.setName(newName);
  console.log(`✅ ערוץ חברים עודכן (${guildId}): ${newName}`);
}

async function updateMemberCountChannel(client, { force = false } = {}) {
  try {
    const guilds = await getGuildsWithMemberCount();
    if (!guilds.length) {
      if (force) console.warn("⚠️ אין memberCountChannelId ב-GuildConfig — דילוג על עדכון ערוץ חברים");
      return;
    }

    for (const cfg of guilds) {
      try {
        await updateOneMemberCountChannel(client, cfg, { force });
      } catch (err) {
        dirtyGuildIds.add(cfg.guildId);
        console.error(`❌ שגיאה בעדכון ערוץ חברים (${cfg.guildId}):`, err.message);
      }
    }
  } catch (err) {
    console.error("❌ שגיאה בעדכון ערוצי חברים:", err.message);
  }
}

function markMemberCountDirty(guildId) {
  if (guildId) dirtyGuildIds.add(guildId);
}

async function logMemberChannelTargets() {
  try {
    const [welcomeGuilds, memberGuilds] = await Promise.all([
      getGuildsWithWelcome(),
      getGuildsWithMemberCount(),
    ]);

    if (!welcomeGuilds.length) {
      console.warn("⚠️ אין שרתים עם welcomeChannelId — הודעות ברוך הבא לא יישלחו");
    } else {
      for (const cfg of welcomeGuilds) {
        console.log(`👋 welcome (DB): guild=${cfg.guildId} channel=${cfg.welcomeChannelId}`);
      }
    }

    if (!memberGuilds.length) {
      console.warn("⚠️ אין שרתים עם memberCountChannelId — ערוץ חברים לא יעודכן");
    } else {
      for (const cfg of memberGuilds) {
        console.log(`👪 members (DB): guild=${cfg.guildId} channel=${cfg.memberCountChannelId}`);
      }
    }
  } catch (err) {
    console.error("❌ לא ניתן לטעון הגדרות welcome/members:", err.message);
  }
}

function setupWelcome(client) {
  if (!intervalStarted) {
    intervalStarted = true;
    setInterval(() => {
      updateMemberCountChannel(client).catch((err) => {
        console.error("❌ שגיאה בעדכון ערוץ חברים:", err.message);
      });
    }, MEMBER_COUNT_INTERVAL_MS);
  }

  logMemberChannelTargets().catch(() => {});

  client.on("guildMemberAdd", async (member) => {
    console.log(`👤 guildMemberAdd: ${member.user.tag} → guild ${member.guild.id}`);
    markMemberCountDirty(member.guild.id);

    try {
      const cfg = await getGuildConfig(member.guild.id);
      if (!cfg?.welcomeChannelId) {
        console.warn(`⚠️ אין welcomeChannelId לשרת ${member.guild.id} — דילוג על הודעת ברוך הבא`);
        return;
      }

      const channel = await client.channels.fetch(cfg.welcomeChannelId).catch(() => null);
      if (!channel?.isTextBased?.() || channel.guildId !== member.guild.id) {
        console.error(
          `❌ ערוץ ברוך הבא לא תקין: ${cfg.welcomeChannelId} (guild ${member.guild.id})`,
        );
        return;
      }

      // Best-effort cache fill — never block/fail the welcome on this.
      try {
        await ensureMembersCached(member.guild);
      } catch (err) {
        console.warn(`⚠️ לא ניתן לשלוף חברים לשרת ${member.guild.id}:`, err.message);
      }

      const memberNumber = humanMemberCount(member.guild);
      const botName = client.user?.username || "MSIsrael.gg";
      const botIcon = client.user?.displayAvatarURL();
      const footerDate = formatFooterDate();

      const embed = new EmbedBuilder()
        .setColor(0xff6600)
        .setTitle("🍁 ברוך הבא לקהילת MapleStory Israel!")
        .setDescription(
          `שלום <@${member.id}>! 👋\n\n` +
          `אתה החבר מספר **${memberNumber}** בשרת!\n\n` +
          `כדי להירשם לקהילה היכנס לאתר שלנו 🌐\n${WEBSITE_URL}`
        )
        .setThumbnail(member.user.displayAvatarURL())
        .setFooter({ text: `${botName} • ${footerDate}`, iconURL: botIcon });

      await channel.send({ embeds: [embed] });
      console.log(`✅ נשלחה הודעת ברוך הבא ל-${member.user.tag} בשרת ${member.guild.id}`);
    } catch (err) {
      console.error("❌ שגיאה בהודעת ברוך הבא:", err.message);
    }
  });

  client.on("guildMemberRemove", (member) => {
    markMemberCountDirty(member.guild.id);
  });
}

module.exports = { updateMemberCountChannel, setupWelcome };
