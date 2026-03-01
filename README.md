# psika-url-summarizer

הפרויקט אופס למצב תשתית בלבד, כדי לאפשר בנייה מחדש מאפס.

## מה נשאר

- מאגר GitHub (היסטוריה/ענפים/CI אם קיים).
- תצורת Firebase בסיסית (`firebase.json`).
- חוקי Firestore (`firestore.rules`).
- שלד Functions מינימלי תחת `functions/`.
- דף Hosting מינימלי תחת `public/`.

## התחלה מחדש

1. התקנת תלויות לפונקציות:
   ```bash
   npm --prefix functions install
   ```
2. הרצה מקומית:
   ```bash
   firebase emulators:start
   ```
3. בנייה מחדש של היישום לפי הצורך.
