/** Try message IDs in order; return null if none work. */
async function fetchMessageByIds(channel, client, ids = []) {
  for (const id of ids.filter(Boolean)) {
    try {
      const msg = await channel.messages.fetch(id);
      if (msg.author?.id === client.user.id) return msg;
    } catch {}
  }
  return null;
}

module.exports = { fetchMessageByIds };
