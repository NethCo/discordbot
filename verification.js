const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const https = require("https");
const PendingCharacter = require("./models/PendingCharacter");
const User = require("./models/User");
const { ADMIN_CHANNEL_ID } = require("./config");
const { isDiscordSnowflake, resolveDiscordUserIdFromRequest } = require("./utils/discordIdentity");

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

async function sendVerificationDM(client, req) {
  const discordUserId = await resolveDiscordUserIdFromRequest(req, User);
  if (req.dmSent || !isDiscordSnowflake(discordUserId)) {
    if (!req.dmSent) {
      console.warn(`⚠️ Skipping DM for ${req._id}: no valid Discord ID found`, {
        uid: req.uid,
      });
    }
    return;
  }
  try {
    const discordUser = await client.users.fetch(discordUserId);
    const embed = new EmbedBuilder()
      .setColor(0xd4a96a)
      .setTitle("🎮 אימות דמות — MSC Israel")
      .setDescription(
        `קיבלנו בקשה לרשום את הדמות **${req.name}** (${req.world}) תחת חשבונך.\n\n` +
        `כדי לאמת שהדמות שייכת לך:\n` +
        `**1)** היכנס למשחק עם הדמות **${req.name}**\n` +
        `**2)** שלח הודעת צ'אט עם הקוד:\n\n` +
        `\`\`\`${req.code}\`\`\`\n` +
        `**3)** שלח לי **צילום מסך** של ההודעה בדיסקורד הזה 📸\n\n` +
        `⏰ תוקף: 48 שעות`
      )
      .setFooter({ text: `מזהה בקשה: ${req._id}` })
      .setTimestamp();
    await discordUser.send({ embeds: [embed] });
    await PendingCharacter.findByIdAndUpdate(req._id, { dmSent: true });
    console.log(`✅ DM נשלח ל-${discordUserId} עבור ${req.name}`);
  } catch (err) {
    console.error(`❌ שליחת DM נכשלה עבור ${req._id}:`, err.message);
  }
}

function watchPendingCharacters(client) {
  console.log("🚀 Starting watcher");

  const stream = PendingCharacter.watch();

  stream.on("change", async (change) => {
    try {
      if (change.operationType !== "insert") return;

      const doc = change.fullDocument;

      if (!doc || doc.approved || doc.dmSent) return;

      await sendVerificationDM(client, doc);

      await PendingCharacter.updateOne(
        { _id: doc._id },
        { $set: { dmSent: true } }
      );

    } catch (err) {
      console.error("ChangeStream error:", err);
    }
  });

  console.log("✅ watchPendingCharacters called");

  stream.on("error", (err) => {
    console.error("Stream crashed:", err);
    setTimeout(() => watchPendingCharacters(client), 5000);
  });

  console.log("✅ Watching PendingCharacter collection");
}

function watchDMScreenshots(client) {
  client.on("messageCreate", async (message) => {
    if (message.author.bot) return;
    if (message.channel.type !== 1) return;
    if (!message.attachments.size) return;

    const discordId = message.author.id;
    const user = await User.findOne({
      $or: [
        { discordId },
        { "auth.discord.id": discordId },
      ],
    }).lean();
    const req = user ? await PendingCharacter.findOne({ uid: user._id, approved: false }) : null;

    if (!req) {
      await message.reply("לא נמצאה בקשה פעילה. אם שלחת בקשה באתר, נסה שוב.");
      return;
    }

    if (!req.dmSent) {
      await message.reply("הבקשה נמצאה, אבל עדיין לא נשלח לך קוד אימות ב-DM.");
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
      const ext = attachment.contentType === "image/png" ? "png" : attachment.contentType === "image/webp" ? "webp" : "jpg";

      if (!ADMIN_CHANNEL_ID) {
        await message.reply("❌ שגיאה: ערוץ האדמין לא מוגדר.");
        return;
      }

      const adminChannel = await client.channels.fetch(ADMIN_CHANNEL_ID);

      const adminEmbed = new EmbedBuilder()
        .setColor(0xf59e0b)
        .setTitle("📋 בקשת דמות חדשה לאישור")
        .addFields(
          { name: "דמות",      value: req.name,                  inline: true },
          { name: "עולם",      value: req.world,                 inline: true },
          { name: "משתמש",     value: `<@${discordId}>`,         inline: true },
          { name: "קוד אימות", value: `\`${req.code}\``, inline: true },
        )
        .setTimestamp();

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`approve_${req._id}`).setLabel("✅ אשר").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`reject_${req._id}`).setLabel("❌ דחה").setStyle(ButtonStyle.Danger),
      );

      const adminMsg = await adminChannel.send({
        embeds: [adminEmbed],
        components: [row],
        files: [{ attachment: imgBuffer, name: `screenshot.${ext}` }],
      });

      await PendingCharacter.findByIdAndUpdate(req._id, {
        prtsc: adminMsg.attachments.first()?.url || null,
        screenshotUploadedAt: new Date(),
      });

      await message.reply(`✅ התמונה התקבלה! הבקשה לדמות **${req.name}** ממתינה לאישור מנהל.`);
    } catch (err) {
      console.error("❌ שגיאה בהעלאת Screenshot:", err.message);
      await message.reply("❌ שגיאה בהעלאת התמונה. נסה שוב.");
    }
  });
}

function watchHandledRequests(client) {
  const seenIds = new Map();
  const MAX_AGE_MS = 10 * 60 * 1000;

  setInterval(async () => {
    try {
      const now = Date.now();
      for (const [id, ts] of seenIds) {
        if (now - ts > MAX_AGE_MS) seenIds.delete(id);
      }

      const docs = await PendingCharacter.find({
        approved: { $ne: false },
      }).lean();

      for (const doc of docs) {
        const idStr = doc._id.toString();
        if (seenIds.has(idStr)) continue;
        if (!ADMIN_CHANNEL_ID) continue;

        const adminChannel = await client.channels.fetch(ADMIN_CHANNEL_ID);
        const messages = await adminChannel.messages.fetch({ limit: 50 });
        const msg = messages.find(m =>
          m.components?.[0]?.components?.some(btn =>
            btn.customId === `approve_${idStr}` || btn.customId === `reject_${idStr}`
          )
        );

        if (!msg) {
          seenIds.set(idStr, Date.now());
          continue;
        }

        if (doc.approved === true) {
          const updatedEmbed = EmbedBuilder.from(msg.embeds[0])
            .setColor(0x22c55e)
            .setTitle("✅ בקשת דמות — אושרה")
            .addFields({ name: "אושר על ידי", value: "אתר האדמין" });
          await msg.edit({ embeds: [updatedEmbed], components: [] });
        } else {
          await msg.delete();
        }

        seenIds.set(idStr, Date.now());
        console.log("✅ הודעת אדמין עודכנה עבור", idStr);
      }
    } catch (err) {
      console.error("❌ שגיאה ב-watchHandledRequests:", err.message);
    }
  }, 10_000);
}

module.exports = { watchPendingCharacters, watchDMScreenshots, watchHandledRequests };
