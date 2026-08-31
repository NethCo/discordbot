const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const https = require("https");
const PendingCharacter = require("./models/PendingCharacter");
const User = require("./models/User");
const { ADMIN_CHANNEL_ID } = require("./config");
const { getGuildsForAdminWorld } = require("./lib/guildConfig");
const { isDiscordSnowflake, resolveDiscordUserIdFromRequest, resolveHandlerMention } = require("./utils/discordIdentity");

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

function buildAdminEmbed(req, discordId) {
  return new EmbedBuilder()
    .setColor(0xf59e0b)
    .setTitle("📋 בקשת דמות חדשה לאישור")
    .addFields(
      { name: "דמות", value: req.name, inline: true },
      { name: "עולם", value: req.world, inline: true },
      { name: "משתמש", value: `<@${discordId}>`, inline: true },
      { name: "קוד אימות", value: `\`${req.code}\``, inline: true },
    )
    .setTimestamp();
}

function buildAdminButtons(reqId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`approve_${reqId}`).setLabel("✅ אשר").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`reject_${reqId}`).setLabel("❌ דחה").setStyle(ButtonStyle.Danger),
  );
}

async function sendVerificationDM(client, req) {
  const discordUserId = await resolveDiscordUserIdFromRequest(req, User);
  if (req.dmSent || !isDiscordSnowflake(discordUserId)) {
    if (!req.dmSent) {
      console.warn(`⚠️ Skipping DM for ${req._id}: no valid Discord ID found`, {
        uid: req.uid,
      });
    }
    return false;
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
    await PendingCharacter.findByIdAndUpdate(req._id, {
      $set: { dmSent: true },
      $unset: { dmResendAt: 1 },
    });
    console.log(`✅ DM נשלח ל-${discordUserId} עבור ${req.name}`);
    return true;
  } catch (err) {
    console.error(`❌ שליחת DM נכשלה עבור ${req._id}:`, err.message);
    return false;
  }
}

function watchPendingCharacters(client) {
  console.log("🚀 Starting watcher");

  const stream = PendingCharacter.watch([], { fullDocument: "updateLookup" });

  stream.on("change", async (change) => {
    try {
      const doc = change.fullDocument;
      if (!doc || doc.approved || doc.rejected || doc.dmSent) return;

      if (change.operationType === "insert") {
        await sendVerificationDM(client, doc);
        return;
      }

      if (change.operationType !== "update" && change.operationType !== "replace") return;

      const fields = change.updateDescription?.updatedFields || {};
      if (fields.dmResendAt || (change.operationType === "replace" && doc.dmResendAt)) {
        await sendVerificationDM(client, doc);
      }
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

async function resolveAdminTargets(world) {
  const guildConfigs = await getGuildsForAdminWorld(world);
  if (guildConfigs.length) {
    return guildConfigs.map((cfg) => ({
      guildId: cfg.guildId,
      channelId: cfg.adminChannelId,
    }));
  }

  if (ADMIN_CHANNEL_ID) {
    return [{ guildId: null, channelId: ADMIN_CHANNEL_ID }];
  }

  return [];
}

function watchDMScreenshots(client) {
  client.on("messageCreate", async (message) => {
    if (message.author.bot) return;
    if (message.channel.type !== 1) return;
    if (!message.attachments.size) return;

    const discordId = message.author.id;
    const user = await User.findOne({ "auth.discord.id": discordId }).lean();
    const req = user
      ? await PendingCharacter.findOne({ uid: user._id, approved: false, rejected: { $ne: true } })
      : null;

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

      const targets = await resolveAdminTargets(req.world);
      if (!targets.length) {
        await message.reply(`❌ אין ערוץ אדמין מוגדר לעולם **${req.world}**. פנה למנהל השרת.`);
        return;
      }

      const adminEmbed = buildAdminEmbed(req, discordId);
      const row = buildAdminButtons(req._id.toString());
      const adminMessages = [];

      for (const target of targets) {
        const adminChannel = await client.channels.fetch(target.channelId);
        const adminMsg = await adminChannel.send({
          embeds: [adminEmbed],
          components: [row],
          files: [{ attachment: imgBuffer, name: `screenshot.${ext}` }],
        });
        adminMessages.push({
          guildId: target.guildId,
          channelId: target.channelId,
          messageId: adminMsg.id,
        });
      }

      const firstAttachmentUrl = adminMessages.length
        ? (await client.channels.fetch(adminMessages[0].channelId)
          .then((ch) => ch.messages.fetch(adminMessages[0].messageId))
          .then((m) => m.attachments.first()?.url || null)
          .catch(() => null))
        : null;

      await PendingCharacter.findByIdAndUpdate(req._id, {
        prtsc: firstAttachmentUrl,
        screenshotUploadedAt: new Date(),
        adminMessages,
        adminMessageId: adminMessages[0]?.messageId || null,
      });

      await message.reply(`✅ התמונה התקבלה! הבקשה לדמות **${req.name}** ממתינה לאישור מנהל.`);
    } catch (err) {
      console.error("❌ שגיאה בהעלאת Screenshot:", err.message);
      await message.reply("❌ שגיאה בהעלאת התמונה. נסה שוב.");
    }
  });
}

function requestStillOpen(msg, idStr) {
  return msg?.components?.[0]?.components?.some(btn =>
    btn.customId === `approve_${idStr}` || btn.customId === `reject_${idStr}`
  );
}

async function findAdminRequestMessages(client, doc) {
  const idStr = doc._id.toString();
  const messages = [];

  if (doc.adminMessages?.length) {
    for (const entry of doc.adminMessages) {
      try {
        const channel = await client.channels.fetch(entry.channelId);
        const msg = await channel.messages.fetch(entry.messageId);
        if (msg) messages.push(msg);
      } catch {}
    }
    if (messages.length) return messages;
  }

  if (doc.adminMessageId && ADMIN_CHANNEL_ID) {
    try {
      const adminChannel = await client.channels.fetch(ADMIN_CHANNEL_ID);
      const msg = await adminChannel.messages.fetch(doc.adminMessageId);
      if (msg) return [msg];
    } catch {}
  }

  if (ADMIN_CHANNEL_ID) {
    try {
      const adminChannel = await client.channels.fetch(ADMIN_CHANNEL_ID);
      const recent = await adminChannel.messages.fetch({ limit: 50 });
      const legacy = recent.find((m) => requestStillOpen(m, idStr));
      if (legacy) return [legacy];
    } catch {}
  }

  return messages;
}

async function buildHandledEmbed(baseEmbed, isApprove, handlerMention) {
  return EmbedBuilder.from(baseEmbed)
    .setColor(isApprove ? 0x22c55e : 0xef4444)
    .setTitle(isApprove ? "✅ בקשת דמות — אושרה" : "❌ בקשת דמות — נדחתה")
    .addFields({ name: isApprove ? "אושר על ידי" : "נדחה על ידי", value: handlerMention });
}

async function updateAllAdminRequestMessages(client, doc, isApprove, handlerMention) {
  const messages = await findAdminRequestMessages(client, doc);
  const idStr = doc._id.toString();

  for (const msg of messages) {
    if (!requestStillOpen(msg, idStr) || !msg.embeds?.[0]) continue;
    const updatedEmbed = await buildHandledEmbed(msg.embeds[0], isApprove, handlerMention);
    await msg.edit({ embeds: [updatedEmbed], components: [] });
  }
}

async function syncAdminRequestMessage(client, doc) {
  const isApprove = doc.approved === true;
  const isReject = doc.rejected === true;
  if (!isApprove && !isReject) return false;

  const claimed = await PendingCharacter.findOneAndUpdate(
    {
      _id: doc._id,
      discordHandled: { $ne: true },
      $or: [{ approved: true }, { rejected: true }],
    },
    { $set: { discordHandled: true } },
  );
  if (!claimed) return false;

  try {
    const who = await resolveHandlerMention(doc.handledBy, User);
    await updateAllAdminRequestMessages(client, doc, isApprove, who);

    if (isReject) {
      await PendingCharacter.findByIdAndDelete(doc._id);
    }

    console.log("✅ הודעות אדמין עודכנו עבור", doc._id.toString());
    return true;
  } catch (err) {
    await PendingCharacter.findByIdAndUpdate(doc._id, { $unset: { discordHandled: 1 } }).catch(() => {});
    throw err;
  }
}

async function catchUpHandledRequests(client) {
  const docs = await PendingCharacter.find({
    discordHandled: { $ne: true },
    $or: [{ approved: true }, { rejected: true }],
  }).lean();

  for (const doc of docs) {
    try {
      await syncAdminRequestMessage(client, doc);
    } catch (err) {
      console.error("❌ שגיאה בעדכון הודעת אדמין:", doc._id.toString(), err.message);
    }
  }
}

function watchHandledRequests(client) {
  void catchUpHandledRequests(client);
  setInterval(() => void catchUpHandledRequests(client), 10_000);

  const startStream = () => {
    const stream = PendingCharacter.watch(
      [{ $match: { operationType: { $in: ["update", "replace"] } } }],
      { fullDocument: "updateLookup" },
    );

    stream.on("change", async (change) => {
      try {
        const doc = change.fullDocument;
        if (!doc || doc.discordHandled) return;
        if (doc.approved === true || doc.rejected === true) {
          await syncAdminRequestMessage(client, doc);
        }
      } catch (err) {
        console.error("❌ ChangeStream watchHandledRequests:", err.message);
      }
    });

    stream.on("error", (err) => {
      console.error("watchHandledRequests stream crashed:", err);
      setTimeout(startStream, 5000);
    });
  };

  startStream();
}

module.exports = {
  watchPendingCharacters,
  watchDMScreenshots,
  watchHandledRequests,
  updateAllAdminRequestMessages,
};
