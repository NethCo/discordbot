const { CLASSIC_JOB_ALIASES, CLASSICRANK_URL } = require("./constants");

function normalizeClassicJob(job) {
  return CLASSIC_JOB_ALIASES[job] ?? job;
}

const CLASSICRANK_ORIGIN = new URL(CLASSICRANK_URL).origin;

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: `${CLASSICRANK_ORIGIN}/`,
};

function decodeEntities(text) {
  return text
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function textOf(html) {
  return decodeEntities(html.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
}

function parseUtcTitle(raw) {
  const trimmed = decodeEntities(raw).trim();
  const d = new Date(trimmed.endsWith("UTC") ? trimmed.replace("UTC", "Z").replace(" ", "T") : trimmed);
  return Number.isNaN(d.getTime()) ? null : d;
}

function worldSlug(world) {
  return String(world || "").trim().toLowerCase();
}

function parseCiVal(section, label) {
  const re = new RegExp(
    `<span class="ci-label">\\s*${label}\\s*<\\/span>\\s*<span class="ci-val">([\\s\\S]*?)<\\/span>`,
    "i",
  );
  const m = section.match(re);
  return m ? textOf(m[1]) : null;
}

function parseProfile(html) {
  const section =
    html.match(/<section[^>]*class="[^"]*\bciwin\b[^"]*"[^>]*>([\s\S]*?)<\/section>/i)?.[1] ?? html;

  const name = textOf(section.match(/<div class="ci-nametag">\s*<h1>([\s\S]*?)<\/h1>/i)?.[1] ?? "");
  if (!name) return null;

  const lvlRaw = section.match(/<b class="cilvl">([\s\S]*?)<\/b>/i)?.[1] ?? parseCiVal(section, "Level");
  const lvl = lvlRaw ? parseInt(textOf(lvlRaw).replace(/[^\d]/g, ""), 10) || 0 : 0;

  const jobHtml =
    section.match(/<span class="jobname">([\s\S]*?)<\/span>/i)?.[1] ??
    parseCiVal(section, "Job") ??
    "";
  const job = normalizeClassicJob(textOf(jobHtml).replace(/\s*2nd Job\s*$/i, "").trim());

  const fameRaw = parseCiVal(section, "Fame") ?? "";
  const fame = parseInt(fameRaw.replace(/[^\d]/g, ""), 10) || 0;

  const avatar = section.match(/<div class="ci-avatar">[\s\S]*?<img[^>]*class="avatar"[^>]*src="([^"]+)"/i);
  let img = "";
  if (avatar) {
    const url = new URL(decodeEntities(avatar[1]), CLASSICRANK_ORIGIN);
    // Drop ?v= stamp so stored URLs stay stable between scans.
    img = `${url.origin}${url.pathname}`;
  }

  const lastCheckedMatch =
    section.match(/Last checked\s*<span[^>]*title="([^"]+)"/i) ??
    html.match(/Last checked\s*<span[^>]*title="([^"]+)"/i);
  const lastCheckedAt = lastCheckedMatch ? parseUtcTitle(lastCheckedMatch[1]) : null;

  return {
    name,
    lvl,
    fame,
    img,
    job,
    ...(lastCheckedAt ? { lastCheckedAt } : {}),
  };
}

/** Returns null when ClassicRank has no character with this exact name on the world. */
async function fetchClassicRankCharacter(characterName, world) {
  const url = `${CLASSICRANK_ORIGIN}/user/${encodeURIComponent(worldSlug(world))}/${encodeURIComponent(characterName)}`;
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(10_000) });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`ClassicRank responded ${res.status}`);
  }

  const parsed = parseProfile(await res.text());
  if (!parsed) return null;

  if (parsed.name.toLowerCase() !== String(characterName).toLowerCase()) return null;

  return {
    ...parsed,
    exp: 0,
  };
}

module.exports = { fetchClassicRankCharacter };
