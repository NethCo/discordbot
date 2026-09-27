require("dotenv").config();
const { Client, GatewayIntentBits, REST, Routes } = require("discord.js");
const { DISCORD_TOKEN } = require("./config");
const { msilCommands } = require("./msil");

function getClientIdFromToken(token) {
  const part = token.split(".")[0];
  return Buffer.from(part, "base64url").toString("utf8");
}

async function registerCommands() {
  if (!DISCORD_TOKEN) {
    console.error("❌ DISCORD_TOKEN חסר ב-.env");
    process.exit(1);
  }

  const clientId = getClientIdFromToken(DISCORD_TOKEN);
  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);

  // One global copy only (avoids duplicate /msil entries)
  console.log("🔄 רושם פקודות גלובליות (/msil)...");
  await rest.put(Routes.applicationCommands(clientId), { body: msilCommands });
  console.log("✅ נרשמו גלובלית.");

  // Remove per-guild copies left from earlier register (they duplicate the global ones)
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  await client.login(DISCORD_TOKEN);
  await new Promise((resolve) => client.once("clientReady", resolve));

  const guilds = [...client.guilds.cache.values()];
  console.log(`🔄 מנקה פקודות כפולות מ־${guilds.length} שרתים...`);

  for (const guild of guilds) {
    try {
      await rest.put(Routes.applicationGuildCommands(clientId, guild.id), { body: [] });
      console.log(`  ✅ נוקו: ${guild.name}`);
    } catch (err) {
      console.error(`  ❌ ${guild.name}: ${err.message}`);
    }
  }

  client.destroy();
  console.log("✅ מוכן — אמור להופיע /msil פעם אחת בלבד.");
}

registerCommands().catch((err) => {
  console.error("❌ רישום פקודות נכשל:", err);
  process.exit(1);
});
