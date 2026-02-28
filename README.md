# psika-url-summarizer

שירות Firebase קטן שמטרתו:

1. לקלוט URL חיצוני, למשוך תוכן בצורה בטוחה יחסית, לנקות אותו לטקסט ולשמור ב־Firestore.
2. להריץ חיפוש Preset באתר בית המשפט העליון (שבוע אחרון + החלטות) ולשמור גם את התוצאה.

## מה כבר קיים במערכת

### Backend (Cloud Functions)

- `createSummaryFromUrl`:
  - מקבל `POST` עם שדה `url`.
  - מבצע ולידציה לפרוטוקול (`http/https`) ואורך URL.
  - חוסם hosts פנימיים/לוקאליים בסיסיים (הגנת SSRF בסיסית).
  - מושך תוכן עם timeout ומגבלת גודל תגובה.
  - תומך ב־`text/html` ו־`text/plain`, מחלץ טקסט ושומר מסמך ב־`summaries`.

- `searchSupremeLastWeekDecisions`:
  - טוען את עמוד החיפוש של העליון, אוסף hidden fields, ושולח בקשת חיפוש עם preset.
  - מחלץ טקסט מהתוצאות ושומר מסמך ב־`summaries`.

### Frontend לבדיקה ידנית

- עמוד סטטי ב־`public/index.html` עם:
  - טופס שליחת URL ל־`/createSummaryFromUrl`.
  - כפתור להפעלת preset של העליון (`/searchSupremeLastWeekDecisions`).
  - תצוגת סטטוס ו־JSON response.

## סטטוס נוכחי (חשוב)

- חוקי Firestore כרגע פתוחים (`allow read, write: if true`) — מתאים רק לפיתוח/ניסוי.
- אין כרגע סט בדיקות אוטומטיות בפועל.

## איך להריץ מקומית

### דרישות

- Node.js 20
- Firebase CLI

### התקנה

```bash
cd functions
npm install
```

### הרצה עם אמולטור פונקציות

```bash
cd functions
npm run serve
```

## תוכנית המשך (השלבים הבאים)

1. **אבטחה**: הקשחת חוקי Firestore לפי auth/roles.
2. **אמינות**: הוספת בדיקות unit עם mocking ל־fetch.
3. **תחזוקה**: פיצול `functions/index.js` למודולים לפי דומיין.
4. **תפעול**: שיפור לוגים/metrics (latency, סוג שגיאה, מקור).
5. **UX**: שיפור דף הבדיקה (ולידציה, טעינה, היסטוריה קצרה).

## מבנה תיקיות

```text
.
├── firebase.json
├── firestore.rules
├── functions/
│   ├── index.js
│   └── package.json
└── public/
    └── index.html
```
