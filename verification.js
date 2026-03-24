const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const https = require("https");
const { db, bucket } = require("./firebase");
const { ADMIN_CHANNEL_ID, WORLD_ROLES } = require("./config");

// ─── Download buffer from URL ──────────────────────────────────────────────────
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

// ─── Watch for new pending_verification requests → send DM ───────────────────
function watchPendingCharacters(client) {
  db.collection("pendingCharacters")
    .where("status", "==", "pending_verification")
    .onSnapshot(async (snap) => {
      for (const change of snap.docChanges()) {
        if (change.type !== "added") continue;
        const req   = change.doc.data();
        const reqId = change.doc.id;
        if (req.dmSent || !req.discordId) continue;
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
            .setFooter({ text: `מזהה בקשה: ${reqId}` })
            .setTimestamp();
          await discordUser.send({ embeds: [embed] });
          await change.doc.ref.update({ dmSent: true });
          console.log(`✅ DM נשלח ל-${req.discordId} עבור ${req.charName}`);
        } catch (err) {
          console.error(`❌ שליחת DM נכשלה עבור ${reqId}:`, err.message);
        }
      }
    });
}

// ─── Handle incoming DM screenshot ────────────────────────────────────────────
function watchDMScreenshots(client) {
  client.on("messageCreate", async (message) => {
    if (message.author.bot) return;
    if (message.channel.type !== 1) return;
    if (!message.attachments.size) return;

    const discordId = message.author.id;
    const snap = await db.collection("pendingCharacters")
      .where("discordId", "==", discordId)
      .where("status", "==", "pending_verification")
      .where("dmSent", "==", true)
      .limit(1)
      .get();

    if (snap.empty) {
      await message.reply("לא נמצאה בקשה פעילה. אם שלחת בקשה באתר, נסה שוב.");
      return;
    }

    const reqDoc = snap.docs[0];
    const req    = reqDoc.data();

    const attachment = [...message.attachments.values()].find(a =>
      ["image/png", "image/jpeg", "image/webp"].includes(a.contentType)
    );
    if (!attachment) { await message.reply("⚠️ לא נמצאה תמונה. שלח PNG, JPG או WEBP."); return; }
    if (attachment.size > 8 * 1024 * 1024) { await message.reply("⚠️ הקובץ גדול מדי (מקסימום 8MB)."); return; }

    try {
      await message.reply("⏳ מעלה את התמונה לבדיקה...");
      const imgBuffer   = await downloadBuffer(attachment.url);
      const ext         = attachment.contentType === "image/png" ? "png" : attachment.contentType === "image/webp" ? "webp" : "jpg";
      const storagePath = `verifications/${reqDoc.id}.${ext}`;
      const fileRef     = bucket.file(storagePath);

      await fileRef.save(imgBuffer, {
        metadata: { contentType: attachment.contentType,
          metadata: { uploadedBy: discordId, requestId: reqDoc.id, charName: req.charName } },
      });

      const [signedUrl] = await fileRef.getSignedUrl({
        action: "read", expires: Date.now() + 7 * 24 * 60 * 60 * 1000,
      });

      await reqDoc.ref.update({
        status: "pending", screenshotPath: storagePath,
        screenshotUrl: signedUrl, screenshotUploadedAt: new Date(),
      });

      await message.reply(`✅ התמונה התקבלה! הבקשה לדמות **${req.charName}** ממתינה לאישור מנהל.`);

      if (ADMIN_CHANNEL_ID) {
        const adminChannel = await client.channels.fetch(ADMIN_CHANNEL_ID);
        const adminEmbed = new EmbedBuilder()
          .setColor(0xf59e0b)
          .setTitle("📋 בקשת דמות חדשה לאישור")
          .addFields(
            { name: "דמות",      value: req.charName,                   inline: true },
            { name: "עולם",      value: req.world,                      inline: true },
            { name: "משתמש",     value: `<@${discordId}>`,              inline: true },
            { name: "קוד אימות", value: `\`${req.verificationCode}\``,  inline: true },
          )
          .setImage(signedUrl)
          .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`approve_${reqDoc.id}`).setLabel("✅ אשר").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`reject_${reqDoc.id}`).setLabel("❌ דחה").setStyle(ButtonStyle.Danger),
        );

        const adminMsg = await adminChannel.send({ embeds: [adminEmbed], components: [row] });
        await reqDoc.ref.update({ adminMessageId: adminMsg.id });
      }
    } catch (err) {
      console.error("❌ שגיאה בהעלאת Screenshot:", err.message);
      await message.reply("❌ שגיאה בהעלאת התמונה. נסה שוב.");
    }
  });
}

// ─── Watch for approvals/rejections from website ──────────────────────────────
function watchHandledRequests(client) {
  db.collection("pendingCharacters")
    .onSnapshot(async (snap) => {
      for (const change of snap.docChanges()) {
        try {
          if (change.type !== "modified") continue;
          const req = change.doc.data();
          if (req.botHandled) continue;
          if (req.status !== "approved" && req.status !== "rejected") continue;

          const adminChannel = await client.channels.fetch(ADMIN_CHANNEL_ID);
          const reqId = change.doc.id;
          const messages = await adminChannel.messages.fetch({ limit: 50 });
          const msg = messages.find(m =>
            m.components?.[0]?.components?.some(btn =>
              btn.customId === `approve_${reqId}` || btn.customId === `reject_${reqId}`
            )
          );
          if (!msg) { console.log("❌ הודעה לא נמצאה עבור", reqId); continue; }

          const isApproved = req.status === "approved";
          const updatedEmbed = EmbedBuilder.from(msg.embeds[0])
            .setColor(isApproved ? 0x22c55e : 0xef4444)
            .setTitle(isApproved ? "✅ בקשת דמות — אושרה" : "❌ בקשת דמות — נדחתה")
            .addFields({ name: isApproved ? "אושר על ידי" : "נדחה על ידי", value: "אתר האדמין" });

          await msg.edit({ embeds: [updatedEmbed], components: [] });
          await change.doc.ref.update({ botHandled: true });
          console.log("✅ הודעת אדמין עודכנה עבור", reqId);
        } catch (err) {
          console.error("❌ שגיאה:", err.message);
        }
      }
    });
}

// ─── Watch for new characters → assign world role ──────────────────────────────
const processedCharIds = new Set();

async function assignWorldRole(client, charDoc) {
  const char = charDoc.data();
  const charId = charDoc.id;
  
  console.log(`🔍 בודק דמות: ${char.name} (${char.world}) - ID: ${charId}`);
  
  if (!char.world || !char.user) {
    console.log(`❌ חסר world או user לדמות ${charId}`);
    return;
  }
  if (processedCharIds.has(charId)) {
    console.log(`⏭️ דמות ${charId} כבר עובדה`);
    return;
  }
  
  const roleId = WORLD_ROLES[char.world];
  if (!roleId) {
    console.log(`❌ אין role מוגדר לעולם ${char.world}`);
    return;
  }
  
  try {
    const userSnap = await db.collection("users").doc(char.user).get();
    if (!userSnap.exists) {
      console.log(`❌ לא נמצא משתמש ${char.user}`);
      return;
    }
    const discordId = userSnap.data()?.discordId;
    if (!discordId) {
      console.log(`❌ למשתמש ${char.user} אין discordId`);
      return;
    }
    
    console.log(`👤 נמצא discordId: ${discordId}`);
    
    const guild = client.guilds.cache.first();
    if (!guild) {
      console.log(`❌ לא נמצא guild`);
      return;
    }
    
    let member;
    try {
      member = await guild.members.fetch(discordId);
    } catch (e) {
      console.log(`❌ לא נמצא member ב-guild: ${discordId}`);
      return;
    }
    
    const role = guild.roles.cache.get(roleId);
    if (!role) { 
      console.error(`❌ Role not found for ${char.world} - roleId: ${roleId}`); 
      return; 
    }
    
    if (member.roles.cache.has(roleId)) {
      console.log(`ℹ️ ${member.user.tag} already has ${char.world} role`);
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
  db.collection("characters")
    .orderBy("createdAt", "desc")
    .limit(10)
    .onSnapshot((snap) => {
      if (!snap.metadata || (!snap.metadata.fromCache && snap.docChanges().length === 0)) return;
      for (const change of snap.docChanges()) {
        if (change.type !== "added") continue;
        const createdAt = change.doc.data().createdAt;
        if (createdAt && Date.now() - createdAt.toMillis() < 5 * 60 * 1000) {
          assignWorldRole(client, change.doc).catch(console.error);
        }
      }
    }, (error) => {
      console.error("❌ Firestore listener error:", error);
    });
}

module.exports = { watchPendingCharacters, watchDMScreenshots, watchHandledRequests, watchNewCharacters };
