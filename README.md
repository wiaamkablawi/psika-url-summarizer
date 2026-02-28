# psika-url-summarizer

שירות Firebase קטן שמטרתו:

1. לקלוט URL חיצוני, למשוך תוכן בצורה בטוחה יחסית, לנקות אותו לטקסט ולשמור ב־Firestore.
2. להריץ חיפוש Preset באתר בית המשפט העליון (שבוע אחרון + החלטות) ולשמור גם את התוצאה.

## MVP Done Checklist (Production-Ready בסיסי)

### ✅ מה הושלם

- [x] `createSummaryFromUrl` ו־`searchSupremeLastWeekDecisions` שומרים `done/failed` עם `durationMs` עקבי.
- [x] `searchSupremeLastWeekDecisions` מכוסה ב־integration tests (מסלול הצלחה + מסלול כשל) כולל assertions על `source/status/error/durationMs`.
- [x] `listLatestSummaries` הוקשח:
  - ולידציית `limit` קפדנית (1..50 בלבד).
  - שגיאות query מול Firestore ממופות ל־`FirestoreQueryError` ברור.
- [x] `functions/index.js` פוצל למודולים פנימיים (`writers/queries/services`) בלי לשבור API חיצוני.
- [x] לוגים מובנים אחידים לכל endpoints עם השדות: `endpoint`, `status`, `durationMs`, `errorType`.
- [x] UI מקומי שופר:
  - אינדיקציית טעינה,
  - שגיאות ידידותיות,
  - רענון אוטומטי לרשימת הסיכומים אחרי ingest/search.

### ✅ קריטריוני Done

MVP נחשב Done כאשר:

1. כל בדיקות unit עוברות (`npm --prefix functions test`).
2. בדיקות emulator עוברות או מדווחות עם סיבת חסימה סביבתית ברורה.
3. אפשר להריץ מקומית `hosting + functions + firestore` ולבצע ingest/search/list מקצה לקצה.
4. כל endpoint מחזיר payload יציב הכולל `ok`, `status`, ו־`durationMs`; ובמקרי כשל גם `errorType`.

## Endpoints

### `POST /createSummaryFromUrl`

- קלט: `{ "url": "https://..." }`
- פלט הצלחה: `{ ok: true, id, status: "done", chars, durationMs }`
- פלט כשל: `{ ok: false, status: "failed", error, errorType, id, durationMs }`

### `POST /searchSupremeLastWeekDecisions`

- מריץ preset: שבוע אחרון + החלטות מעל 2 עמודים.
- פלט הצלחה/כשל זהה במבנה ל־`createSummaryFromUrl`.

### `GET /listLatestSummaries?limit=10`

- `limit` אופציונלי אך אם נשלח חייב להיות מספר שלם בטווח 1..50.
- פלט הצלחה: `{ ok: true, count, summaries, durationMs }`
- פלט כשל: `{ ok: false, error, errorType, durationMs }`

## איך מריצים מקומית

### דרישות

- Node.js 20
- Firebase CLI (מקומי או גלובלי)

### התקנה

```bash
cd functions
npm install
```

### הרצת אמולטורים מלאים (הדרך המומלצת)

```bash
firebase emulators:start --only hosting,functions,firestore
```

לאחר עליית האמולטורים:

1. פותחים `http://127.0.0.1:5000`.
2. שולחים URL דרך הטופס או מריצים preset של העליון.
3. בודקים שהרשימה מתרעננת אוטומטית ושמוחזר JSON מלא.

## בדיקות

### Unit + module tests

```bash
npm --prefix functions test
```

### Integration tests על האמולטור

```bash
npm --prefix functions run test:emulator
```

הסקריפט משתמש ב־`npx firebase-tools`. אם הסביבה חוסמת גישה ל־npm registry, זו חסימה סביבתית ולא כשל קוד.

## מבנה תיקיות

```text
.
├── firebase.json
├── firestore.rules
├── functions/
│   ├── core.js
│   ├── index.js
│   ├── index.test.js
│   ├── integration.emulator.test.js
│   ├── modules.test.js
│   ├── queries/
│   │   └── listLatestSummaries.js
│   ├── services/
│   │   └── supremeSearchRunner.js
│   └── writers/
│       └── summaryWriter.js
└── public/
    └── index.html
```
