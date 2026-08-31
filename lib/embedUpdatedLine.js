function buildUpdatedLine(updatedAt, intervalText) {
  const ts = Math.floor(updatedAt / 1000);
  const line = `\u200F🔄\u0020עודכן: <t:${ts}:f> | ${intervalText}`;
  return line.padEnd(72, "\u2007");
}

function buildUpdatedField(updatedAt, intervalText) {
  return { name: "\u200b", value: buildUpdatedLine(updatedAt, intervalText), inline: false };
}

function isUpdatedField(field) {
  return field.name === "\u200b" || String(field.value || "").includes("עודכן:");
}

function applyUpdatedLine(embed, updatedAt, intervalText) {
  const fields = (embed.data.fields || []).filter((f) => !isUpdatedField(f));
  fields.push(buildUpdatedField(updatedAt, intervalText));
  return embed.setFields(fields).setFooter(null);
}

function parseUpdatedAtFromLine(text) {
  const match = String(text || "").match(/<t:(\d+):/);
  return match ? Number(match[1]) * 1000 : null;
}

function readUpdatedLineFromEmbed(embed) {
  const field = (embed?.fields || []).find(isUpdatedField);
  return field?.value || null;
}

module.exports = {
  buildUpdatedLine,
  buildUpdatedField,
  isUpdatedField,
  applyUpdatedLine,
  parseUpdatedAtFromLine,
  readUpdatedLineFromEmbed,
};
