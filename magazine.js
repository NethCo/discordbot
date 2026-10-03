const { EmbedBuilder } = require("discord.js");
const Magazine = require("./models/Magazine");
const { WEBSITE_URL } = require("./config");
const { getGuildsWithMagazine } = require("./lib/guildConfig");

const MAGAZINE_EMBED_COLOR = 0xd95000;
const RLM = "\u200F";

function siteBase() {
  return (WEBSITE_URL || "https://msisrael.gg").replace(/\/$/, "");
}

function articleUrl(doc) {
  const slug = typeof doc.slug === "string" ? doc.slug.trim() : "";
  const path = slug || String(doc._id);
  return `${siteBase()}/magazine/${path}`;
}

function isPublished(doc) {
  return doc?.draft !== true;
}

/**
 * Right-align a line in Discord embeds (same trick as lib/embedUpdatedLine.js).
 * Must use figure space \u2007 (bidi WS/neutral). Braille blank \u2800 is strong LTR
 * and pins Hebrew to the left — that was why the title stayed left-aligned.
 */
function rtlLine(text, width = 72) {
  return `${RLM}${text}`.padEnd(width, "\u2007");
}

function buildMagazineEmbed(doc, { botIcon } = {}) {
  const url = articleUrl(doc);
  const title = String(doc.title || "כתבה חדשה").slice(0, 250);
  const summ = typeof doc.summ === "string" ? doc.summ.trim().slice(0, 400) : "";
  const img = typeof doc.img === "string" ? doc.img.trim() : "";
  const author = typeof doc.author === "string" ? doc.author.trim() : "";

  const description = [rtlLine(`📰  **[${title}](${url})**  📰`)];
  if (summ) description.push(rtlLine(summ));

  const embed = new EmbedBuilder()
    .setColor(MAGAZINE_EMBED_COLOR)
    .setDescription(description.join("\n\n"))
    .setFooter({
      text: "MSIsrael.gg • קהילת מייפל סטורי ישראל",
      ...(botIcon ? { iconURL: botIcon } : {}),
    });

  if (img) embed.setImage(img);

  const fields = [];
  if (author) {
    fields.push({ name: "\u200b", value: rtlLine(`מחבר: ${author.slice(0, 100)}`), inline: false });
  }
  fields.push({ name: "\u200b", value: rtlLine(`**[לקריאה באתר](${url})**`), inline: false });
  embed.addFields(fields);

  return embed;
}

async function postMagazineArticle(client, doc) {
  const guilds = await getGuildsWithMagazine();
  if (!guilds.length) {
    console.warn("⚠️ אין ערוץ מגזין מוגדר — דילוג על פרסום כתבה");
    return 0;
  }

  const botIcon = client.user?.displayAvatarURL({ dynamic: true });
  const embed = buildMagazineEmbed(doc, { botIcon });
  let posted = 0;

  for (const cfg of guilds) {
    try {
      const channel = await client.channels.fetch(cfg.magazineChannelId);
      if (!channel?.isTextBased?.()) {
        console.error(`❌ ערוץ מגזין לא תקין: ${cfg.magazineChannelId} (guild ${cfg.guildId})`);
        continue;
      }
      await channel.send({ embeds: [embed] });
      posted += 1;
    } catch (err) {
      console.error(
        `❌ פרסום כתבה לערוץ מגזין נכשל (${cfg.guildId}/${cfg.magazineChannelId}):`,
        err.message,
      );
    }
  }

  return posted;
}

/**
 * Claim + post a magazine article that the site flagged via discordNotifyAt.
 * Idempotent: stamps discordSentAt so retries / cover re-uploads don't double-post.
 */
async function processMagazineNotify(client, articleId) {
  if (!articleId) return false;

  const claimed = await Magazine.findOneAndUpdate(
    {
      _id: articleId,
      draft: { $ne: true },
      discordNotifyAt: { $type: "date" },
      discordSentAt: { $exists: false },
    },
    { $set: { discordSendingAt: new Date() } },
    { new: true },
  ).lean();

  if (!claimed || !isPublished(claimed)) return false;

  try {
    const posted = await postMagazineArticle(client, claimed);
    if (posted <= 0) {
      await Magazine.updateOne(
        { _id: articleId },
        { $unset: { discordSendingAt: "" } },
      );
      return false;
    }

    await Magazine.updateOne(
      { _id: articleId },
      {
        $set: { discordSentAt: new Date(), discordSentCount: posted },
        $unset: { discordNotifyAt: "", discordSendingAt: "" },
      },
    );
    console.log(`✅ כתבת מגזין פורסמה בדיסקורד: ${claimed.title} (${posted} שרתים)`);
    return true;
  } catch (err) {
    console.error("❌ processMagazineNotify failed:", err.message);
    await Magazine.updateOne(
      { _id: articleId },
      { $unset: { discordSendingAt: "" } },
    );
    return false;
  }
}

async function drainPendingMagazineNotifies(client) {
  const pending = await Magazine.find({
    draft: { $ne: true },
    discordNotifyAt: { $type: "date" },
    discordSentAt: { $exists: false },
  })
    .select("_id")
    .lean();

  for (const doc of pending) {
    await processMagazineNotify(client, doc._id);
  }
}

function watchMagazinePublishes(client) {
  console.log("🚀 Starting magazine watcher");

  const stream = Magazine.watch(
    [{ $match: { operationType: { $in: ["insert", "update", "replace"] } } }],
    { fullDocument: "updateLookup" },
  );

  stream.on("change", async (change) => {
    try {
      const doc = change.fullDocument;
      if (!doc || !isPublished(doc) || doc.discordSentAt || !doc.discordNotifyAt) return;

      if (change.operationType === "insert") {
        await processMagazineNotify(client, doc._id);
        return;
      }

      if (change.operationType !== "update" && change.operationType !== "replace") return;

      const fields = change.updateDescription?.updatedFields || {};
      if (
        fields.discordNotifyAt ||
        (change.operationType === "replace" && doc.discordNotifyAt)
      ) {
        await processMagazineNotify(client, doc._id);
      }
    } catch (err) {
      console.error("Magazine ChangeStream error:", err);
    }
  });

  stream.on("error", (err) => {
    console.error("Magazine stream crashed:", err);
    setTimeout(() => watchMagazinePublishes(client), 5000);
  });

  console.log("✅ Watching magazines for Discord notifies");
}

module.exports = {
  watchMagazinePublishes,
  drainPendingMagazineNotifies,
  processMagazineNotify,
  postMagazineArticle,
};
