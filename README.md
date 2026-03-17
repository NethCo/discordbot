# 🍁 בוט דיסקורד — MapleStory ישראל

## תכונות
- **לוח טופ 10** — מתעדכן אוטומטית כל 3 שעות בערוץ ייעודי
- **כפתור "הדירוג שלי"** — כל משתמש יכול לראות את המיקום שלו (פרטי, רק לו)
- **כפתור "רשימה מלאה"** — קישור ישיר לעמוד הדירוגים באתר

---

## הגדרה מהירה

### 1. יצירת בוט בדיסקורד
1. כנס ל־ https://discord.com/developers/applications
2. **New Application** → תן שם לבוט
3. לשונית **Bot** → **Add Bot** → העתק את ה־**Token**
4. לשונית **OAuth2 → URL Generator**:
   - סמן: `bot` + `applications.commands`
   - Permissions: `Send Messages`, `Embed Links`, `Read Message History`
5. הכנס את הבוט לשרת שלך דרך הקישור שנוצר

### 2. התקנת הפרויקט
```bash
npm install
```

### 3. הגדרת משתני סביבה
```bash
cp .env.example .env
```
ערוך את `.env` עם הפרטים שלך:
- `DISCORD_TOKEN` — הטוקן מה־Developer Portal
- `CLIENT_ID` — ה-Application ID
- `GUILD_ID` — ה-ID של השרת שלך (לחץ ימני על השרת → Copy Server ID)
- `LEADERBOARD_CHANNEL_ID` — ID של הערוץ שיציג את הלוח
- `WEBSITE_RANKINGS_URL` — הקישור לעמוד הדירוגים באתר שלך

### 4. הגדרת Firebase
הכנס את קובץ `serviceAccountKey.json` לתיקיית הבוט.  
לקבל אותו: Firebase Console → Project Settings → Service Accounts → Generate new private key

### 5. קישור חשבון דיסקורד לפרופיל באתר
כדי שהכפתור "הדירוג שלי" יעבוד, כל משתמש צריך שבמסמך שלו ב-Firestore יהיה שדה `discordId` עם ה-Discord User ID שלו.  
זה אמור כבר לעבוד דרך חיבור הדיסקורד באתר שלך.

### 6. הפעלה
```bash
npm start
```

---

## מבנה Firestore מצופה
```
users/
  {userId}/
    username: "MapleUser123"
    score: 95000
    discordId: "123456789012345678"   ← Discord User ID
```
> ניתן לשנות את שמות השדות ב-.env

---

## הרחבות עתידיות
- `/rank @user` — slash command לדירוג שרשות
- התראות כשמישהו עולה לטופ 10
- ערוץ לייב-אקשן לאירועים
- תזכורות לאירועים קהילתיים
# discordbot
