/** Find the bot's embed message: try saved IDs, then scan the channel. */
async function findBotEmbedMessage(channel, client, { ids = [], matchEmbed }) {
  for (const id of ids.filter(Boolean)) {
    try {
      const msg = await channel.messages.fetch(id);
      if (msg.author?.id === client.user.id && msg.embeds[0]) return msg;
    } catch {}
  }

  try {
    const messages = await channel.messages.fetch({ limit: 50 });
    return messages.find(
      (m) => m.author?.id === client.user.id
        && m.embeds[0]
        && (!matchEmbed || matchEmbed(m.embeds[0])),
    ) || null;
  } catch {
    return null;
  }
}

module.exports = { findBotEmbedMessage };
