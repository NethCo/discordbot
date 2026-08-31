const CHARACTER_AVATAR_BASE = "https://msavatar1.nexon.net/Character/";

function isFullUrl(value) {
  return /^https?:\/\//i.test(value);
}

function extractCharacterImg(url) {
  if (!url) return null;
  const m = String(url).match(/\/Character\/([^/?#]+)/i);
  const id = m ? m[1] : url;
  return id.replace(/\.(png|webp|jpg|jpeg|gif)$/i, "");
}

/** Same logic as MSIsraelnext — img may be a Nexon id or a full Character URL. */
function characterAvatarUrl(img) {
  if (!img) return null;
  const id = extractCharacterImg(img);
  if (!id) return null;
  return `${CHARACTER_AVATAR_BASE}${id}.png`;
}

module.exports = { characterAvatarUrl, extractCharacterImg };
