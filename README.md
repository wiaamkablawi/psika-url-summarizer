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

- `listLatestSummaries`:
  - מקבל `GET` עם `limit` אופציונלי.
  - מחזיר את הסיכומים האחרונים מ־Firestore (כולל `status`, `source`, ו־`fetchedAt`).

### Frontend לבדיקה ידנית

- עמוד סטטי ב־`public/index.html` עם:
  - טופס שליחת URL ל־`/createSummaryFromUrl`.
  - כפתור להפעלת preset של העליון (`/searchSupremeLastWeekDecisions`).
  - כפתור לרענון רשימת סיכומים אחרונים (`/listLatestSummaries`).
  - תצוגת סטטוס ו־JSON response.

## סטטוס נוכחי (חשוב)

- חוקי Firestore הוקשחו: גישת Client SDK חסומה כברירת־מחדל (קריאה/כתיבה נחסמות), והכתיבה מתבצעת דרך Cloud Functions (Admin SDK).
- נוספו בדיקות unit בסיסיות ל־helpers הקריטיים בצד ה־Functions.
- נוסף hardening ל־request handler: אם `writeSummaryDoc` לא מוזרק כראוי, מוחזרת שגיאת קונפיגורציה ברורה (500).

## איך להריץ מקומית

### דרישות

- Node.js 20
- Firebase CLI (או הרצה דרך `npx firebase-tools`)

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

### בדיקת חוקי Firestore באמולטור

```bash
firebase emulators:start --only firestore,functions
```

> הערה: גם כשהחוקים חוסמים גישת לקוח, Cloud Functions שמריצות Admin SDK עדיין יכולות לכתוב ל־Firestore.

### התנסות מלאה במערכת (MVP local)

```bash
firebase emulators:start --only hosting,functions,firestore
```

לאחר שהאמולטורים עולים:

1. לפתוח דפדפן ב־`http://127.0.0.1:5000`.
2. לשלוח URL דרך הטופס (`createSummaryFromUrl`) או להריץ חיפוש Preset.
3. ללחוץ על "רענון סיכומים אחרונים" כדי לראות את הרשומות האחרונות מהשרת.
4. לראות תוצאה מיידית ב־UI וגם במסמכי `summaries` באמולטור Firestore.

### הרצת בדיקות

```bash
npm --prefix functions run test
```

### הרצת בדיקות Integration מול אמולטורים

```bash
cd functions
npm run test:emulator
```

הסקריפט משתמש ב־`npx firebase-tools`, כך שלא חייבת להיות התקנת Firebase CLI גלובלית מראש.

הפקודה מריצה את אמולטור Functions + Firestore ובודקת end-to-end את המסלול:
HTTP request -> function -> write/read מול Firestore.

## תוכנית המשך (השלבים הבאים)

1. **אבטחה (שלב הבא)**: לפתוח גישה מינימלית לפי auth/roles רק אם יידרש Client SDK.
2. **אמינות (שלב הבא)**: הרחבת הבדיקות ל־integration/emulator (כעת יש גם unit למסלול Supreme preset).
3. **תחזוקה**: פיצול `functions/index.js` למודולים לפי דומיין.
4. **תפעול**: שיפור לוגים/metrics (latency, סוג שגיאה, מקור).
5. **UX**: שיפור דף הבדיקה (ולידציה, טעינה, היסטוריה קצרה).

## מבנה תיקיות

```text
.
├── firebase.json
├── firestore.rules
├── functions/
│   ├── core.js
│   ├── index.test.js
│   ├── integration.emulator.test.js
│   ├── index.js
│   └── package.json
└── public/
    └── index.html
```
