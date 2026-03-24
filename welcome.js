const { EmbedBuilder } = require("discord.js");
const { WELCOME_CHANNEL_ID, MEMBER_COUNT_CHANNEL_ID, WEBSITE_RANKINGS_URL } = require("./config");
const { getCurrentHoliday } = require("./holidays");

async function updateMemberCountChannel(client) {
  try {
    if (!MEMBER_COUNT_CHANNEL_ID) return;
    const channel = await client.channels.fetch(MEMBER_COUNT_CHANNEL_ID);
    if (!channel) return;
    await channel.guild.members.fetch();
    const count   = channel.guild.members.cache.filter(m => !m.user.bot).size;
    const newName = `👪 ${count} משתמשים`;
    if (channel.name !== newName) {
      await channel.setName(newName);
      console.log(`✅ ערוץ חברים עודכן: ${newName}`);
    }
  } catch (err) {
    console.error("❌ שגיאה בעדכון ערוץ חברים:", err.message);
  }
}

function setupWelcome(client) {
  client.on("guildMemberAdd", async (member) => {
    try {
      if (!WELCOME_CHANNEL_ID) return;
      const channel = await client.channels.fetch(WELCOME_CHANNEL_ID);
      if (!channel) return;

      await member.guild.members.fetch();
      const memberNumber = member.guild.members.cache.filter(m => !m.user.bot).size;
      const holiday      = getCurrentHoliday();
      const holidayLine  = holiday ? `\n${holiday.emoji} ומאחלים לך ${holiday.name} שמח!` : "";

      const embed = new EmbedBuilder()
        .setColor(0xff6600)
        .setTitle("🍁 ברוך הבא לקהילת MapleStory Israel!")
        .setDescription(
          `שלום <@${member.id}>! 👋\n\n` +
          `אתה החבר מספר **${memberNumber}** בשרת!${holidayLine}\n\n` +
          `כדי להירשם לקהילה היכנס לאתר שלנו 🌐\n${WEBSITE_RANKINGS_URL}`
        )
        .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
        .setTimestamp()
        .setFooter({ text: "MapleStory Community Israel" });

      await channel.send({ embeds: [embed] });
      await updateMemberCountChannel(client);
    } catch (err) {
      console.error("❌ שגיאה בהודעת ברוך הבא:", err.message);
    }
  });

  client.on("guildMemberRemove", async () => {
    await updateMemberCountChannel(client);
  });
}

module.exports = { updateMemberCountChannel, setupWelcome };
