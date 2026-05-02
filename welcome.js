const { EmbedBuilder } = require("discord.js");
const { WELCOME_CHANNEL_ID, MEMBER_COUNT_CHANNEL_ID, WEBSITE_URL } = require("./config");
const { getCurrentHoliday } = require("./holidays");
const User = require("./models/User");
const Character = require("./models/Character");
const PendingHebrewName = require("./models/PendingHebrewName");

const HEBREW_NAME_REGEX = /^[\u0590-\u05FF][\u0590-\u05FF\s'"׳״-]{1,19}$/;
const userNicknameState = new Map();

function normalizeHebrewName(value) {
  return value.trim().replace(/\s+/g, " ");
}

function isValidHebrewName(value) {
  if (!value) return false;
  const normalized = normalizeHebrewName(value);
  return HEBREW_NAME_REGEX.test(normalized);
}

function buildNickname(mainCharacterName, hebrewName) {
  const base = (mainCharacterName || "User").trim();
  const suffix = ` - ${hebrewName}`;
  const maxBaseLength = Math.max(0, 32 - suffix.length);
  const shortBase = base.slice(0, maxBaseLength);
  const nick = `${shortBase}${suffix}`;
  return nick.slice(0, 32);
}

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

async function getUserByDiscordId(discordId) {
  const user = await User.findOne({ discordId }).lean();
  if (!user) return null;
  return { id: user._id.toString(), data: user };
}

async function resolveHebrewName(discordId, userData) {
  if (isValidHebrewName(userData?.hebrewName || "")) {
    return normalizeHebrewName(userData.hebrewName);
  }
  const pending = await PendingHebrewName.findById(discordId).lean();
  if (!pending || pending.status !== "done") return null;
  if (!isValidHebrewName(pending?.hebrewName || "")) return null;
  return normalizeHebrewName(pending.hebrewName);
}

async function syncMemberNickname(client, userDocId, userData) {
  if (!userData?.discordId || !userData?.mainCharacterId) return false;

  const hebrewName = await resolveHebrewName(userData.discordId, userData);
  if (!hebrewName) return false;

  const mainChar = await Character.findById(userData.mainCharacterId).lean();
  if (!mainChar) return false;

  const mainCharName = (mainChar.name || "").trim();
  if (!mainCharName) return false;

  const guild = client.guilds.cache.first();
  if (!guild) return false;

  const member = await guild.members.fetch(userData.discordId).catch(() => null);
  if (!member) return false;

  const targetNickname = buildNickname(mainCharName, hebrewName);
  const currentNick = member.nickname || member.user.username;
  if (currentNick === targetNickname) return true;

  await member.setNickname(targetNickname, "Sync main character + Hebrew name");

  if (userDocId) {
    await User.findByIdAndUpdate(userDocId, { hebrewName });
  }
  return true;
}

async function startHebrewNameOnboarding(member) {
  if (member.user.bot) return;
  await PendingHebrewName.findByIdAndUpdate(
    member.id,
    { guildId: member.guild.id, status: "pending", createdAt: new Date() },
    { upsert: true }
  );

  try {
    await member.send(
      "ברוך הבא! כדי לסיים הרשמה, שלח לי את השם שלך בעברית בלבד (2-20 תווים).\n" +
      "דוגמה: נתנאל\n" +
      "הכינוי שלך יתעדכן אוטומטית ל- MainCharacter - עברית."
    );
  } catch (err) {
    console.log(`⚠️ לא ניתן לשלוח DM ל-${member.user.tag}: ${err.message}`);
  }
}

function watchNicknameSync(client) {
  let initialized = false;

  setInterval(async () => {
    try {
      const users = await User.find({ discordId: { $exists: true, $ne: null } }).lean();

      for (const user of users) {
        const userDocId = user._id.toString();
        const state = `${user.discordId || ""}|${user.mainCharacterId || ""}|${user.hebrewName || ""}`;
        const prev = userNicknameState.get(userDocId);
        userNicknameState.set(userDocId, state);

        if (!initialized) continue;
        if (prev === state) continue;

        try {
          await syncMemberNickname(client, userDocId, user);
        } catch (err) {
          console.error("❌ שגיאה בסנכרון כינוי:", err.message);
        }
      }
      initialized = true;
    } catch (err) {
      console.error("❌ שגיאה ב-watchNicknameSync:", err.message);
    }
  }, 30_000);
}

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
      const botName = client.user?.username || "MSIsrael.gg";
      const botIcon = client.user?.displayAvatarURL({ dynamic: true });
      const footerDate = formatFooterDate();

      const embed = new EmbedBuilder()
        .setColor(0xff6600)
        .setTitle("🍁 ברוך הבא לקהילת MapleStory Israel!")
        .setDescription(
          `שלום <@${member.id}>! 👋\n\n` +
          `אתה החבר מספר **${memberNumber}** בשרת!${holidayLine}\n\n` +
          `כדי להירשם לקהילה היכנס לאתר שלנו 🌐\n${WEBSITE_URL}`
        )
        .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
        .setFooter({ text: `${botName} • ${footerDate}`, iconURL: botIcon });

      await channel.send({ embeds: [embed] });
      await updateMemberCountChannel(client);
      await startHebrewNameOnboarding(member);
    } catch (err) {
      console.error("❌ שגיאה בהודעת ברוך הבא:", err.message);
    }
  });

  client.on("guildMemberRemove", async () => {
    await updateMemberCountChannel(client);
  });

  client.on("messageCreate", async (message) => {
    if (message.author.bot) return;
    if (message.channel.type !== 1) return;
    const content = message.content?.trim();
    if (!content) return;

    try {
      const pending = await PendingHebrewName.findById(message.author.id);
      if (!pending || pending.status === "done") return;

      if (!isValidHebrewName(content)) {
        await message.reply("❌ השם חייב להיות בעברית בלבד (2-20 תווים). נסה שוב, למשל: נתנאל");
        return;
      }

      const hebrewName = normalizeHebrewName(content);
      const guild = await client.guilds.fetch(pending.guildId).catch(() => null);
      if (!guild) {
        await message.reply("❌ לא הצלחתי למצוא את השרת. פנה למנהל.");
        return;
      }

      const member = await guild.members.fetch(message.author.id).catch(() => null);
      if (!member) {
        await message.reply("❌ לא הצלחתי למצוא אותך בשרת. פנה למנהל.");
        return;
      }

      const userRef = await getUserByDiscordId(message.author.id);
      if (!userRef) {
        await message.reply("✅ השם נשמר. חבר את חשבון הדיסקורד באתר כדי לעדכן כינוי אוטומטית.");
        await PendingHebrewName.findByIdAndUpdate(message.author.id, {
          status: "done",
          hebrewName,
          updatedAt: new Date(),
        });
        return;
      }

      await User.findByIdAndUpdate(userRef.id, { hebrewName });
      await syncMemberNickname(client, userRef.id, { ...userRef.data, hebrewName });

      const refreshedMember = await guild.members.fetch(message.author.id).catch(() => null);
      const nickname = refreshedMember?.nickname || member.nickname || member.user.username;

      await PendingHebrewName.findByIdAndUpdate(message.author.id, {
        status: "done",
        hebrewName,
        nickname,
        updatedAt: new Date(),
      });

      await message.reply(`✅ הושלם! הכינוי שלך עודכן ל: **${nickname}**`);
    } catch (err) {
      console.error("❌ שגיאה בתהליך שם עברי:", err.message);
      await message.reply("❌ לא הצלחתי לעדכן כינוי כרגע. ודא שלבוט יש Manage Nicknames ופנה למנהל.");
    }
  });

  watchNicknameSync(client);
}

module.exports = { updateMemberCountChannel, setupWelcome };
