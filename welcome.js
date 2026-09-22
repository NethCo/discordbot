const { EmbedBuilder } = require("discord.js");
const { WELCOME_CHANNEL_ID, MEMBER_COUNT_CHANNEL_ID, WEBSITE_URL } = require("./config");

const MEMBER_COUNT_INTERVAL_MS = 10 * 60 * 1000;

let membersFetched = false;
let memberCountDirty = false;
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
  return guild.members.cache.filter(m => !m.user.bot).size;
}

async function ensureMembersCached(guild) {
  if (membersFetched && guild.members.cache.size > 0) return;
  await guild.members.fetch();
  membersFetched = true;
}

async function updateMemberCountChannel(client, { force = false } = {}) {
  try {
    if (!MEMBER_COUNT_CHANNEL_ID) return;
    if (!force && !memberCountDirty) return;

    const channel = await client.channels.fetch(MEMBER_COUNT_CHANNEL_ID);
    if (!channel?.guildId) return;

    await ensureMembersCached(channel.guild);
    const count = humanMemberCount(channel.guild);
    const newName = `👪 ${count} משתמשים`;

    memberCountDirty = false;
    if (channel.name === newName) return;

    await channel.setName(newName);
    console.log(`✅ ערוץ חברים עודכן: ${newName}`);
  } catch (err) {
    memberCountDirty = true;
    console.error("❌ שגיאה בעדכון ערוץ חברים:", err.message);
  }
}

function markMemberCountDirty() {
  memberCountDirty = true;
}

function setupWelcome(client) {
  if (!intervalStarted && MEMBER_COUNT_CHANNEL_ID) {
    intervalStarted = true;
    setInterval(() => {
      updateMemberCountChannel(client).catch((err) => {
        console.error("❌ שגיאה בעדכון ערוץ חברים:", err.message);
      });
    }, MEMBER_COUNT_INTERVAL_MS);
  }

  client.on("guildMemberAdd", async (member) => {
    markMemberCountDirty();

    try {
      if (!WELCOME_CHANNEL_ID) return;
      const channel = await client.channels.fetch(WELCOME_CHANNEL_ID);
      if (!channel) return;

      await ensureMembersCached(member.guild);
      const memberNumber = humanMemberCount(member.guild);
      const botName = client.user?.username || "MSIsrael.gg";
      const botIcon = client.user?.displayAvatarURL({ dynamic: true });
      const footerDate = formatFooterDate();

      const embed = new EmbedBuilder()
        .setColor(0xff6600)
        .setTitle("🍁 ברוך הבא לקהילת MapleStory Israel!")
        .setDescription(
          `שלום <@${member.id}>! 👋\n\n` +
          `אתה החבר מספר **${memberNumber}** בשרת!\n\n` +
          `כדי להירשם לקהילה היכנס לאתר שלנו 🌐\n${WEBSITE_URL}`
        )
        .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
        .setFooter({ text: `${botName} • ${footerDate}`, iconURL: botIcon });

      await channel.send({ embeds: [embed] });
    } catch (err) {
      console.error("❌ שגיאה בהודעת ברוך הבא:", err.message);
    }
  });

  client.on("guildMemberRemove", () => {
    markMemberCountDirty();
  });
}

module.exports = { updateMemberCountChannel, setupWelcome };
