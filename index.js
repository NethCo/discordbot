require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  Partials,
} = require("discord.js");
const admin = require("firebase-admin");
const https = require("https");

// ─── Firebase Init ─────────────────────────────────────────────────────────────
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
});
const db      = admin.firestore();
const bucket  = admin.storage().bucket();

// ─── Config ────────────────────────────────────────────────────────────────────
const DISCORD_TOKEN          = process.env.DISCORD_TOKEN;
const LEADERBOARD_CHANNEL_ID = process.env.LEADERBOARD_CHANNEL_ID;
const ADMIN_CHANNEL_ID       = process.env.ADMIN_CHANNEL_ID;
const WEBSITE_RANKINGS_URL   = process.env.WEBSITE_RANKINGS_URL || "https://your-site.com/rankings";
const UPDATE_INTERVAL_HOURS  = 3;

// ─── Discord Client ────────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel, Partials.Message],
});

// ─── Helpers ───────────────────────────────────────────────────────────────────
const WORLD_EMOJI = { Scania: "🌲", Bera: "🪨", Reboot: "🔁", Elysium: "✨", Kronos: "⏳" };
const JOB_EMOJI   = { Warrior: "⚔️", Mage: "🔮", Bowman: "🏹", Thief: "🗡️", Pirate: "🏴‍☠️" };
const worldIcon   = (w) => WORLD_EMOJI[w] || "🌍";
const jobIcon     = (j) => JOB_EMOJI[j]  || "🎮";

async function getTop10() {
  const snap = await db.collection("characters").orderBy("level", "desc").orderBy("exp", "desc").limit(10).get();
  return snap.docs.map((doc, i) => ({ rank: i + 1, ...doc.data() }));
}

async function getCharacterRank(charData) {
  const above    = await db.collection("characters").where("level", ">", charData.level || 0).get();
  const sameMore = await db.collection("characters").where("level", "==", charData.level || 0).where("exp", ">", charData.exp || 0).get();
  return above.size + sameMore.size + 1;
}

async function getUserCharacters(discordId) {
  const userSnap = await db.collection("users").where("discordId", "==", discordId).limit(1).get();
  if (userSnap.empty) return null;
  const characterIds = userSnap.docs[0].data().characterIds || [];
  if (!characterIds.length) return null;
  const charDocs = await Promise.all(characterIds.map(id => db.collection("characters").doc(id).get()));
  const chars = charDocs.filter(d => d.exists).map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => b.level !== a.level ? b.level - a.level : (b.exp || 0) - (a.exp || 0));
  return chars.length ? chars : null;
}

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

// ─── Leaderboard ──────────────────────────────────────────────────────────────
function buildLeaderboardEmbed(top10) {
  const medals = ["🥇", "🥈", "🥉"];
  const now = new Date().toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" });
  const rows = top10.map(c => {
    const pos = medals[c.rank - 1] ?? `**${c.rank}.**`;
    return `${pos} ${worldIcon(c.world)}${jobIcon(c.job)} **${c.name}** — רמה \`${c.level}\``;
  });
  return new EmbedBuilder()
    .setColor(0xff6600)
    .setTitle("🍁 טופ 10 — MapleStory Community Israel")
    .setDescription(rows.join("\n"))
    .setFooter({ text: `עודכן: ${now} • מתעדכן כל ${UPDATE_INTERVAL_HOURS} שעות` });
}

function buildLeaderboardButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("my_rank").setLabel("📊 הדירוג שלי").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setLabel("🌐 רשימה מלאה באתר").setStyle(ButtonStyle.Link).setURL(WEBSITE_RANKINGS_URL),
  );
}

async function getLeaderboardMessageId() {
  const doc = await db.collection("_bot").doc("leaderboard").get();
  return doc.exists ? doc.data().messageId : null;
}

async function saveLeaderboardMessageId(id) {
  await db.collection("_bot").doc("leaderboard").set({ messageId: id });
}

async function updateLeaderboard() {
  try {
    const channel = await client.channels.fetch(LEADERBOARD_CHANNEL_ID);
    if (!channel) return console.error("❌ ערוץ לוח הדירוגים לא נמצא");
    const top10 = await getTop10();
    const embed = buildLeaderboardEmbed(top10);
    const row   = buildLeaderboardButtons();
    const savedId = await getLeaderboardMessageId();
    if (savedId) {
      try {
        const msg = await channel.messages.fetch(savedId);
        await msg.edit({ embeds: [embed], components: [row] });
        console.log("✅ לוח הדירוגים עודכן");
        return;
      } catch {}
    }
    const msg = await channel.send({ embeds: [embed], components: [row] });
    await saveLeaderboardMessageId(msg.id);
    console.log("✅ נשלחה הודעת לוח דירוגים:", msg.id);
  } catch (err) {
    console.error("❌ שגיאה בעדכון לוח:", err);
  }
}

// ─── Verification DM Watcher ───────────────────────────────────────────────────
function watchPendingCharacters() {
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

// ─── Handle DM with screenshot ─────────────────────────────────────────────────
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (message.channel.type !== 1) return; // DM only
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
  if (!attachment) {
    await message.reply("⚠️ לא נמצאה תמונה. שלח PNG, JPG או WEBP.");
    return;
  }
  if (attachment.size > 8 * 1024 * 1024) {
    await message.reply("⚠️ הקובץ גדול מדי (מקסימום 8MB).");
    return;
  }

  try {
    await message.reply("⏳ מעלה את התמונה לבדיקה...");

    const imgBuffer  = await downloadBuffer(attachment.url);
    const ext        = attachment.contentType === "image/png" ? "png" : attachment.contentType === "image/webp" ? "webp" : "jpg";
    const storagePath = `verifications/${reqDoc.id}/screenshot.${ext}`;
    const fileRef    = bucket.file(storagePath);

    await fileRef.save(imgBuffer, {
      metadata: {
        contentType: attachment.contentType,
        metadata: { uploadedBy: discordId, requestId: reqDoc.id, charName: req.charName },
      },
    });

    const [signedUrl] = await fileRef.getSignedUrl({
      action: "read",
      expires: Date.now() + 7 * 24 * 60 * 60 * 1000,
    });

    await reqDoc.ref.update({
      status: "pending",
      screenshotPath: storagePath,
      screenshotUrl: signedUrl,
      screenshotUploadedAt: new Date(),
    });

    await message.reply(`✅ התמונה התקבלה! הבקשה לדמות **${req.charName}** ממתינה לאישור מנהל.`);

    // שלח לצ'אנל האדמין
    if (ADMIN_CHANNEL_ID) {
      try {
        const adminChannel = await client.channels.fetch(ADMIN_CHANNEL_ID);
        const adminEmbed = new EmbedBuilder()
          .setColor(0xf59e0b)
          .setTitle("📋 בקשת דמות חדשה לאישור")
          .addFields(
            { name: "דמות",        value: req.charName,              inline: true },
            { name: "עולם",        value: req.world,                 inline: true },
            { name: "משתמש",       value: `<@${discordId}>`,         inline: true },
            { name: "קוד אימות",   value: `\`${req.verificationCode}\``, inline: true },
          )
          .setImage(signedUrl)
          .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`approve_${reqDoc.id}`).setLabel("✅ אשר").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`reject_${reqDoc.id}`).setLabel("❌ דחה").setStyle(ButtonStyle.Danger),
        );

        await adminChannel.send({ embeds: [adminEmbed], components: [row] });
      } catch (err) {
        console.error("❌ שליחה לצ'אנל אדמין נכשלה:", err.message);
      }
    }
  } catch (err) {
    console.error("❌ שגיאה בהעלאת Screenshot:", err.message, err.stack);
    await message.reply("❌ שגיאה בהעלאת התמונה. נסה שוב.");
  }
});

// ─── Interactions ──────────────────────────────────────────────────────────────
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;

  // ── כפתור הדירוג שלי ──────────────────────────────────────────────────────
  if (interaction.customId === "my_rank") {
    try { await interaction.deferReply({ flags: 64 }); } catch { return; }
    try {
      const characters = await getUserCharacters(interaction.user.id);
      if (!characters) {
        return interaction.editReply({ content: `❌ לא מצאתי חשבון מקושר. היכנס לאתר: **${WEBSITE_RANKINGS_URL}**` });
      }
      const row = new ActionRowBuilder().addComponents(
        characters.map(c =>
          new ButtonBuilder()
            .setCustomId(`rank_char_${c.id}`)
            .setLabel(`${jobIcon(c.job)} ${c.name} (${c.level})`)
            .setStyle(ButtonStyle.Secondary)
        )
      );
      await interaction.editReply({ content: "בחר דמות להצגת הדירוג:", components: [row] });
      setTimeout(async () => { try { await interaction.deleteReply(); } catch {} }, 60_000);
    } catch (err) {
      console.error("שגיאה ב-my_rank:", err);
      await interaction.editReply({ content: "❌ אירעה שגיאה, נסה שוב מאוחר יותר." });
    }
    return;
  }

  // ── כפתור בחירת דמות ─────────────────────────────────────────────────────
  if (interaction.customId.startsWith("rank_char_")) {
    try { await interaction.deferReply({ flags: 64 }); } catch { return; }
    try {
      const charId  = interaction.customId.replace("rank_char_", "");
      const charDoc = await db.collection("characters").doc(charId).get();
      if (!charDoc.exists) return interaction.editReply({ content: "❌ דמות לא נמצאה." });
      const charData = charDoc.data();
      const rank     = await getCharacterRank(charData);
      const embed = new EmbedBuilder()
        .setColor(0x00ccff)
        .setTitle("📊 הדירוג שלך")
        .setDescription(
          `🍁 **${charData.name}**\n\n` +
          `🏆 מיקום כללי: **#${rank}**\n` +
          `⭐ רמה: **${charData.level}**\n` +
          `${worldIcon(charData.world)} עולם: **${charData.world || "—"}**\n` +
          `${jobIcon(charData.job)} עבודה: **${charData.job || "—"}**`
        )
        .setFooter({ text: "MapleStory Community Israel" });
      await interaction.editReply({ embeds: [embed], components: [] });
      setTimeout(async () => { try { await interaction.deleteReply(); } catch {} }, 60_000);
    } catch (err) {
      console.error("שגיאה ב-rank_char:", err);
      await interaction.editReply({ content: "❌ אירעה שגיאה, נסה שוב מאוחר יותר." });
    }
    return;
  }

  // ── כפתורי אשר/דחה בקשת דמות ────────────────────────────────────────────
  if (interaction.customId.startsWith("approve_") || interaction.customId.startsWith("reject_")) {
    const isApprove = interaction.customId.startsWith("approve_");
    const reqId     = interaction.customId.replace(isApprove ? "approve_" : "reject_", "");

    try { await interaction.deferUpdate(); } catch { return; }

    const reqRef  = db.collection("pendingCharacters").doc(reqId);
    const reqSnap = await reqRef.get();

    if (!reqSnap.exists) {
      return interaction.followUp({ content: "❌ הבקשה לא נמצאה.", ephemeral: true });
    }

    const req = reqSnap.data();
    if (req.status !== "pending") {
      return interaction.followUp({ content: "הבקשה כבר טופלה.", ephemeral: true });
    }

    if (isApprove) {
      // צור דמות
      const charRef = await db.collection("characters").add({
        name: req.charName, world: req.world, job: req.job || "",
        user: req.uid, level: 1, fame: 0, exp: 0, createdAt: new Date(),
      });
      // הוסף ל-characterIds
      await db.collection("users").doc(req.uid).update({
        characterIds: admin.firestore.FieldValue.arrayUnion(charRef.id),
      });
      await reqRef.update({ status: "approved", handledBy: interaction.user.id, handledAt: new Date() });

      const approvedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
        .setColor(0x22c55e)
        .setTitle("✅ בקשת דמות — אושרה")
        .addFields({ name: "אושר על ידי", value: `<@${interaction.user.id}>` });
      await interaction.editReply({ embeds: [approvedEmbed], components: [] });

      try {
        const u = await client.users.fetch(req.discordId);
        await u.send(`✅ הדמות **${req.charName}** אושרה ונוספה לחשבון שלך באתר MSC Israel!`);
      } catch {}
    } else {
      await reqRef.update({ status: "rejected", handledBy: interaction.user.id, handledAt: new Date() });

      const rejectedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
        .setColor(0xef4444)
        .setTitle("❌ בקשת דמות — נדחתה")
        .addFields({ name: "נדחה על ידי", value: `<@${interaction.user.id}>` });
      await interaction.editReply({ embeds: [rejectedEmbed], components: [] });

      try {
        const u = await client.users.fetch(req.discordId);
        await u.send(`❌ הבקשה לדמות **${req.charName}** נדחתה. פנה למנהל לפרטים נוספים.`);
      } catch {}
    }
    return;
  }
});

// ─── Ready ─────────────────────────────────────────────────────────────────────
client.once("ready", async () => {
  console.log(`✅ בוט מחובר כ: ${client.user.tag}`);
  await updateLeaderboard();
  setInterval(updateLeaderboard, UPDATE_INTERVAL_HOURS * 60 * 60 * 1000);
  watchPendingCharacters();
});

client.login(DISCORD_TOKEN);