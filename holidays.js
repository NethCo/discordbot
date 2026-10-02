const HOLIDAYS = [
  { id: "hanukkah",     name: "חנוכה",        emoji: "🕎", status: "🕎 !חג חנוכה שמח",
    ranges: [{ s: [2026,12,4], e: [2026,12,12] }] },
  { id: "purim",        name: "פורים",         emoji: "🎭", status: "🎭 !חג פורים שמח",
    ranges: [{ s: [2027,3,22], e: [2027,3,23] }] },
  { id: "passover",     name: "פסח",           emoji: "🍷", status: "🍷 !חג פסח כשר ושמח",
    ranges: [{ s: [2027,4,21], e: [2027,4,29] }] },
  { id: "shavuot",      name: "שבועות",        emoji: "🌸", status: "🌸 !חג שבועות שמח",
    ranges: [{ s: [2027,6,9], e: [2027,6,11] }] },
  { id: "independence", name: "יום העצמאות",   emoji: "🇮🇱", status: "🇮🇱 !יום העצמאות שמח",
    ranges: [{ s: [2027,5,9], e: [2027,5,10] }] },
  { id: "roshHashana",  name: "ראש השנה",       emoji: "🍎", status: "🍎 !שנה טובה ומתוקה",
    ranges: [{ s: [2027,10,1], e: [2027,10,3] }] },
  { id: "yomKippur",    name: "יום כיפור",      emoji: "🤍", status: "🤍 !גמר חתימה טובה",
    ranges: [{ s: [2027,10,10], e: [2027,10,11] }] },
  { id: "sukkot",       name: "סוכות",          emoji: "🌿", status: "🌿 !חג סוכות שמח",
    ranges: [{ s: [2026,9,25], e: [2026,10,2] }, { s: [2027,10,15], e: [2027,10,22] }] },
];

function israelYmd(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return {
    y: Number(byType.year),
    m: Number(byType.month),
    d: Number(byType.day),
  };
}

function ymdKey({ y, m, d }) {
  return y * 10_000 + m * 100 + d;
}

function getCurrentHoliday(date = new Date()) {
  const today = ymdKey(israelYmd(date));
  for (const h of HOLIDAYS) {
    for (const r of h.ranges) {
      const start = ymdKey({ y: r.s[0], m: r.s[1], d: r.s[2] });
      const end = ymdKey({ y: r.e[0], m: r.e[1], d: r.e[2] });
      if (today >= start && today <= end) return h;
    }
  }
  return null;
}

function getShabbatStatus(date = new Date()) {
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jerusalem",
    weekday: "short",
  }).format(date);
  if (day === "Fri" || day === "Sat") return "✡️ שבת שלום";
  return null;
}

module.exports = { getCurrentHoliday, getShabbatStatus, HOLIDAYS };
