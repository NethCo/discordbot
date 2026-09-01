require("dotenv").config();
const { REST, Routes } = require("discord.js");
const { DISCORD_TOKEN } = require("./config");

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

  console.log("🔄 מנקה פקודות slash...");
  await rest.put(Routes.applicationCommands(clientId), { body: [] });
  console.log("✅ הפקודות נוקו.");
}

registerCommands().catch((err) => {
  console.error("❌ רישום פקודות נכשל:", err);
  process.exit(1);
});
