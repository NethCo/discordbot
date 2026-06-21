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

module.exports = { isDiscordSnowflake, resolveDiscordUserIdFromRequest };