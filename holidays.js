const HOLIDAYS = [
  { id: "hanukkah",     name: "חנוכה",        emoji: "🕎", status: "🕎 חג חנוכה שמח! מדליקים נרות",
    ranges: [{ s: [2024,12,25], e: [2025,1,2] }, { s: [2025,12,14], e: [2025,12,22] }, { s: [2026,12,4], e: [2026,12,12] }] },
  { id: "purim",        name: "פורים",         emoji: "🎭", status: "🎭 פורים שמח! משתה ושמחה",
    ranges: [{ s: [2025,3,13], e: [2025,3,14] }, { s: [2026,3,2], e: [2026,3,3] }, { s: [2027,3,22], e: [2027,3,23] }] },
  { id: "passover",     name: "פסח",           emoji: "🫓", status: "🫓 חג פסח שמח! חג החירות",
    ranges: [{ s: [2025,4,12], e: [2025,4,20] }, { s: [2026,4,1], e: [2026,4,9] }, { s: [2027,4,21], e: [2027,4,29] }] },
  { id: "shavuot",      name: "שבועות",        emoji: "🌸", status: "🌸 חג שבועות שמח!",
    ranges: [{ s: [2025,6,1], e: [2025,6,3] }, { s: [2026,5,21], e: [2026,5,23] }, { s: [2027,6,9], e: [2027,6,11] }] },
  { id: "independence", name: "יום העצמאות",   emoji: "🇮🇱", status: "🇮🇱 יום העצמאות שמח!",
    ranges: [{ s: [2025,4,30], e: [2025,5,1] }, { s: [2026,4,20], e: [2026,4,21] }, { s: [2027,5,9], e: [2027,5,10] }] },
  { id: "roshHashana",  name: "ראש השנה",       emoji: "🍎", status: "🍎 שנה טובה ומתוקה!",
    ranges: [{ s: [2025,9,22], e: [2025,9,24] }, { s: [2026,9,11], e: [2026,9,13] }, { s: [2027,10,1], e: [2027,10,3] }] },
  { id: "yomKippur",    name: "יום כיפור",      emoji: "🤍", status: "🤍 גמר חתימה טובה!",
    ranges: [{ s: [2025,10,1], e: [2025,10,2] }, { s: [2026,9,20], e: [2026,9,21] }, { s: [2027,10,10], e: [2027,10,11] }] },
  { id: "sukkot",       name: "סוכות",          emoji: "🌿", status: "🌿 חג סוכות שמח!",
    ranges: [{ s: [2025,10,6], e: [2025,10,13] }, { s: [2026,9,25], e: [2026,10,2] }, { s: [2027,10,15], e: [2027,10,22] }] },
];

function getCurrentHoliday(date = new Date()) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  for (const h of HOLIDAYS) {
    for (const r of h.ranges) {
      const s = new Date(r.s[0], r.s[1] - 1, r.s[2]);
      const e = new Date(r.e[0], r.e[1] - 1, r.e[2]);
      if (d >= s && d <= e) return h;
    }
  }
  return null;
}

module.exports = { getCurrentHoliday, HOLIDAYS };
