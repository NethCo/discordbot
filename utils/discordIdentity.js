function isDiscordSnowflake(value) {
  return typeof value === "string" && /^[0-9]{15,20}$/.test(value);
}

async function resolveDiscordUserIdFromRequest(request, userModel) {
  if (!request?.uid || !userModel) return null;

  try {
    const userDoc = await userModel.findById(request.uid).lean();
    const discordId = userDoc?.auth?.discord?.id || userDoc?.discordId;
    return isDiscordSnowflake(discordId) ? discordId : null;
  } catch {
    return null;
  }
}

/** `handledBy` is a Discord snowflake (bot button) or a website user uid. */
async function resolveHandlerMention(handledBy, userModel) {
  if (isDiscordSnowflake(handledBy)) return `<@${handledBy}>`;
  if (!handledBy || !userModel) return "אתר האדמין";

  try {
    const userDoc = await userModel.findById(handledBy).lean();
    const discordId = userDoc?.auth?.discord?.id || userDoc?.discordId;
    if (isDiscordSnowflake(discordId)) return `<@${discordId}>`;
    if (userDoc?.auth?.discord?.dName) return userDoc.auth.discord.dName;
  } catch {}

  return "אתר האדמין";
}

module.exports = { isDiscordSnowflake, resolveDiscordUserIdFromRequest, resolveHandlerMention };