const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const https = require("https");
const PendingCharacter = require("./models/PendingCharacter");
const Character = require("./models/Character");
const { ADMIN_CHANNEL_ID, WORLD_ROLES } = require("./config");

const processedPendingIds = new Set();
const processedCharIds = new Set();

function downloadBuffer(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    }).on("error", reject);
  });
}

function getWorldRoleId(world) {
  const key = String(world || "").trim();
  if (!key) return null;
  if (WORLD_ROLES[key]) return WORLD_ROLES[key];

  const lower = key.toLowerCase();
  if (lower === "kronis") return WORLD_ROLES.Kronos || null;
  if (lower === "kronos") return WORLD_ROLES.Kronos || null;
  if (lower === "hyperion") return WORLD_ROLES.Hyperion || null;
  if (lower === "scania") return WORLD_ROLES.Scania || null;
  if (lower === "bera") return WORLD_ROLES.Bera || null;
  return null;
}

async function sendVerificationDM(client, req) {
  if (req.dmSent || !req.discordId) return;
  try {
    const discordUser = await client.users.fetch(req.discordId);
    const embed = new EmbedBuilder()
      .setColor(0xd4a96a)
      .setTitle("🎮 אימות דמות — MSC Israel")
      .setDescription(
        `קיבלנו בקשה לרשום את הדמות **${req.charName}** (${req.world}) תחת חשבונך.\n\n` +
        `כדי לאמת שהדמות שייכת לך:\n` +
        `**1)** היכנס למשחק עם הדמות **${req.charName}**\n` +
        `**2)** שלח הודעת צ'אט עם הקוד:\n\n` +
        `\`\`\`${req.verificationCode}\`\`\`\n` +
        `**3)** שלח לי **צילום מסך** של ההודעה בדיסקורד הזה 📸\n\n` +
        `⏰ תוקף: 48 שעות`
      )
      .setFooter({ text: `מזהה בקשה: ${req._id}` })
      .setTimestamp();
    await discordUser.send({ embeds: [embed] });
    await PendingCharacter.findByIdAndUpdate(req._id, { dmSent: true });
    console.log(`✅ DM נשלח ל-${req.discordId} עבור ${req.charName}`);
  } catch (err) {
    console.error(`❌ שליחת DM נכשלה עבור ${req._id}:`, err.message);
  }
}

function watchPendingCharacters(client) {
  setInterval(async () => {
    try {
      const docs = await PendingCharacter.find({
        status: "pending_verification",
        dmSent: { $ne: true },
      }).lean();

      for (const doc of docs) {
        const idStr = doc._id.toString();
        if (processedPendingIds.has(idStr)) continue;
        processedPendingIds.add(idStr);
        await sendVerificationDM(client, doc);
      }
    } catch (err) {
      console.error("❌ שגיאה ב-watchPendingCharacters:", err.message);
    }
  }, 15_000);
}

function watchDMScreenshots(client) {
  client.on("messageCreate", async (message) => {
    if (message.author.bot) return;
    if (message.channel.type !== 1) return;
    if (!message.attachments.size) return;

    const discordId = message.author.id;
    const req = await PendingCharacter.findOne({
      discordId,
      status: "pending_verification",
      dmSent: true,
    });

    if (!req) {
      await message.reply("לא נמצאה בקשה פעילה. אם שלחת בקשה באתר, נסה שוב.");
      return;
    }

    const attachment = [...message.attachments.values()].find(a =>
      ["image/png", "image/jpeg", "image/webp"].includes(a.contentType)
    );
    if (!attachment) { await message.reply("⚠️ לא נמצאה תמונה. שלח PNG, JPG או WEBP."); return; }
    if (attachment.size > 8 * 1024 * 1024) { await message.reply("⚠️ הקובץ גדול מדי (מקסימום 8MB)."); return; }

    try {
      await message.reply("⏳ מעלה את התמונה לבדיקה...");
      const imgBuffer = await downloadBuffer(attachment.url);

      if (!ADMIN_CHANNEL_ID) {
        await message.reply("❌ שגיאה: ערוץ האדמין לא מוגדר.");
        return;
      }

      const adminChannel = await client.channels.fetch(ADMIN_CHANNEL_ID);
      const adminMsg = await adminChannel.send({
        content: `📸 **${req.charName}** (${req.world}) — <@${discordId}>`,
        files: [{ attachment: imgBuffer, name: `screenshot.${attachment.contentType === "image/png" ? "png" : attachment.contentType === "image/webp" ? "webp" : "jpg"}` }],
      });

      const discordImageUrl = adminMsg.attachments.first()?.url;

      await PendingCharacter.findByIdAndUpdate(req._id, {
        status: "pending",
        screenshotFileId: adminMsg.id,
        screenshotUrl: discordImageUrl || null,
        screenshotUploadedAt: new Date(),
        adminMessageId: adminMsg.id,
      });

      await message.reply(`✅ התמונה התקבלה! הבקשה לדמות **${req.charName}** ממתינה לאישור מנהל.`);

      if (discordImageUrl) {
        const adminEmbed = new EmbedBuilder()
          .setColor(0xf59e0b)
          .setTitle("📋 בקשת דמות חדשה לאישור")
          .addFields(
            { name: "דמות",      value: req.charName,                  inline: true },
            { name: "עולם",      value: req.world,                     inline: true },
            { name: "משתמש",     value: `<@${discordId}>`,             inline: true },
            { name: "קוד אימות", value: `\`${req.verificationCode}\``, inline: true },
          )
          .setImage(discordImageUrl)
          .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`approve_${req._id}`).setLabel("✅ אשר").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`reject_${req._id}`).setLabel("❌ דחה").setStyle(ButtonStyle.Danger),
        );

        const followUpMsg = await adminChannel.send({ embeds: [adminEmbed], components: [row] });
        await adminMsg.edit({ content: `📸 **${req.charName}** (${req.world}) — <@${discordId}>\n[אישור/דחייה]`, components: [row] });
      }
    } catch (err) {
      console.error("❌ שגיאה בהעלאת Screenshot:", err.message);
      await message.reply("❌ שגיאה בהעלאת התמונה. נסה שוב.");
    }
  });
}

function watchHandledRequests(client) {
  let initialized = false;
  const adminMessageCache = new Map();

  setInterval(async () => {
    try {
      const docs = await PendingCharacter.find({
        status: { $in: ["approved", "rejected"] },
        botHandled: { $ne: true },
      }).lean();

      for (const doc of docs) {
        const idStr = doc._id.toString();
        if (!ADMIN_CHANNEL_ID) continue;

        const adminChannel = await client.channels.fetch(ADMIN_CHANNEL_ID);
        let msg;

        if (doc.adminMessageId) {
          msg = adminMessageCache.get(idStr);
          if (!msg) {
            try {
              msg = await adminChannel.messages.fetch(doc.adminMessageId);
              adminMessageCache.set(idStr, msg);
            } catch {
              const messages = await adminChannel.messages.fetch({ limit: 50 });
              msg = messages.find(m =>
                m.components?.[0]?.components?.some(btn =>
                  btn.customId === `approve_${idStr}` || btn.customId === `reject_${idStr}`
                )
              );
              if (msg) adminMessageCache.set(idStr, msg);
            }
          }
        }

        if (!msg) {
          console.log("❌ הודעה לא נמצאה עבור", idStr);
          continue;
        }

        const isApproved = doc.status === "approved";
        const updatedEmbed = EmbedBuilder.from(msg.embeds[0])
          .setColor(isApproved ? 0x22c55e : 0xef4444)
          .setTitle(isApproved ? "✅ בקשת דמות — אושרה" : "❌ בקשת דמות — נדחתה")
          .addFields({ name: isApproved ? "אושר על ידי" : "נדחה על ידי", value: "אתר האדמין" });

        await msg.edit({ embeds: [updatedEmbed], components: [] });
        await PendingCharacter.findByIdAndUpdate(idStr, { botHandled: true });
        console.log("✅ הודעת אדמין עודכנה עבור", idStr);
      }

      initialized = true;
    } catch (err) {
      console.error("❌ שגיאה ב-watchHandledRequests:", err.message);
    }
  }, 10_000);
}

async function assignWorldRole(client, char) {
  const charId = char._id.toString();

  if (!char.world || !char.userDiscordId) return;
  if (processedCharIds.has(charId)) return;

  const roleId = getWorldRoleId(char.world);
  if (!roleId) return;

  try {
    const guild = client.guilds.cache.first();
    if (!guild) return;

    let member;
    try {
      member = await guild.members.fetch(char.userDiscordId);
    } catch {
      return;
    }

    const role = guild.roles.cache.get(roleId);
    if (!role) return;

    if (member.roles.cache.has(roleId)) {
      processedCharIds.add(charId);
      return;
    }

    await member.roles.add(role);
    processedCharIds.add(charId);
    console.log(`✅ הוסף role ${char.world} ל-${member.user.tag}`);
  } catch (err) {
    console.error(`❌ שגיאה בהוספת role:`, err.message);
  }
}

function watchNewCharacters(client) {
  setInterval(async () => {
    try {
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
      const docs = await Character.find({
        createdAt: { $gte: fiveMinAgo },
      }).lean();

      for (const doc of docs) {
        const idStr = doc._id.toString();
        if (processedCharIds.has(idStr)) continue;
        processedCharIds.add(idStr);
        await assignWorldRole(client, doc);
      }
    } catch (err) {
      console.error("❌ שגיאה ב-watchNewCharacters:", err.message);
    }
  }, 30_000);
}

module.exports = { watchPendingCharacters, watchDMScreenshots, watchHandledRequests, watchNewCharacters };
