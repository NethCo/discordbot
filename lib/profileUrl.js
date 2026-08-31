const { WEBSITE_URL } = require("../config");

function buildProfileUrl(discordId) {
  const id = String(discordId || "").trim();
  if (!id) return null;
  const base = (WEBSITE_URL || "https://msisrael.gg").replace(/\/$/, "");
  return `${base}/profile/${id}`;
}

module.exports = { buildProfileUrl };
