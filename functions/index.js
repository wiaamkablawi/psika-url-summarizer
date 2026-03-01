const functions = require("firebase-functions");

const SUPREME_COURT_SEARCH_URL = "https://supreme.court.gov.il/Pages/fullsearch.aspx";

function extractHiddenFields(html) {
  const hidden = {};
  const re = /<input[^>]*type=["']hidden["'][^>]*>/gi;
  const items = html.match(re) || [];

  for (const item of items) {
    const name = item.match(/name=["']([^"']+)["']/i)?.[1];
    const value = item.match(/value=["']([^"']*)["']/i)?.[1] || "";
    if (name) hidden[name] = value;
  }

  return hidden;
}

function formatDateDdMmYyyy(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

exports.health = functions.https.onRequest((_req, res) => {
  res.status(200).json({ok: true, message: "Project scaffold is ready for rebuild."});
});

exports.autoSupremeSearch = functions.https.onRequest(async (req, res) => {
  if (req.method !== "GET") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  try {
    const landingRes = await fetch(SUPREME_COURT_SEARCH_URL, {method: "GET", redirect: "follow"});
    if (!landingRes.ok) {
      res.status(502).send(`Supreme landing failed with status ${landingRes.status}`);
      return;
    }

    const landingHtml = await landingRes.text();
    const hidden = extractHiddenFields(landingHtml);
    const payload = new URLSearchParams({...hidden});

    const lastWeek = formatDateDdMmYyyy(7);
    const today = formatDateDdMmYyyy(0);

    const dateFromCandidates = ["ctl00$ContentPlaceHolder1$txtDateFrom", "ctl00$MainContent$txtDateFrom", "txtDateFrom"];
    const dateToCandidates = ["ctl00$ContentPlaceHolder1$txtDateTo", "ctl00$MainContent$txtDateTo", "txtDateTo"];
    const minPagesCandidates = ["ctl00$ContentPlaceHolder1$txtPagesFrom", "ctl00$MainContent$txtPagesFrom", "txtPagesFrom"];

    const essentialOnlyCandidates = [
      "ctl00$ContentPlaceHolder1$ddlMahutiTechni",
      "ctl00$MainContent$ddlMahutiTechni",
      "ddlMahutiTechni",
    ];

    const sectionCandidates = [
      "ctl00$ContentPlaceHolder1$ddlSection",
      "ctl00$MainContent$ddlSection",
      "ddlSection",
      "ctl00$ContentPlaceHolder1$ddlMador",
      "ctl00$MainContent$ddlMador",
      "ddlMador",
    ];

    const searchButtonCandidates = ["ctl00$ContentPlaceHolder1$btnSearch", "ctl00$MainContent$btnSearch", "btnSearch"];

    for (const key of dateFromCandidates) payload.set(key, lastWeek);
    for (const key of dateToCandidates) payload.set(key, today);
    for (const key of minPagesCandidates) payload.set(key, "2");

    for (const key of essentialOnlyCandidates) {
      payload.set(key, "מהותיות בלבד");
    }

    for (const key of sectionCandidates) {
      payload.set(key, "פלילי");
    }

    for (const key of searchButtonCandidates) {
      payload.set(key, "חפש");
    }

    const searchRes = await fetch(SUPREME_COURT_SEARCH_URL, {
      method: "POST",
      redirect: "follow",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "https://supreme.court.gov.il",
        Referer: SUPREME_COURT_SEARCH_URL,
      },
      body: payload.toString(),
    });

    const resultHtml = await searchRes.text();
    res.set("Content-Type", "text/html; charset=utf-8");
    res.status(searchRes.ok ? 200 : 502).send(resultHtml);
  } catch (error) {
    console.error("autoSupremeSearch failed", error);
    res.status(500).send("Failed to run automated Supreme Court search.");
  }
});

exports.autoSupremeSearchAgent = functions.https.onRequest(async (req, res) => {
  if (req.method !== "GET") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  try {
    const landingRes = await fetch(SUPREME_COURT_SEARCH_URL, {method: "GET", redirect: "follow"});
    if (!landingRes.ok) {
      res.status(502).send(`Supreme landing failed with status ${landingRes.status}`);
      return;
    }

    const landingHtml = await landingRes.text();
    const hidden = extractHiddenFields(landingHtml);
    const postFields = {...hidden};

    const lastWeek = formatDateDdMmYyyy(7);
    const today = formatDateDdMmYyyy(0);

    const dateFromCandidates = ["ctl00$ContentPlaceHolder1$txtDateFrom", "ctl00$MainContent$txtDateFrom", "txtDateFrom"];
    const dateToCandidates = ["ctl00$ContentPlaceHolder1$txtDateTo", "ctl00$MainContent$txtDateTo", "txtDateTo"];
    const minPagesCandidates = ["ctl00$ContentPlaceHolder1$txtPagesFrom", "ctl00$MainContent$txtPagesFrom", "txtPagesFrom"];

    const essentialOnlyCandidates = [
      "ctl00$ContentPlaceHolder1$ddlMahutiTechni",
      "ctl00$MainContent$ddlMahutiTechni",
      "ddlMahutiTechni",
    ];

    const sectionCandidates = [
      "ctl00$ContentPlaceHolder1$ddlSection",
      "ctl00$MainContent$ddlSection",
      "ddlSection",
      "ctl00$ContentPlaceHolder1$ddlMador",
      "ctl00$MainContent$ddlMador",
      "ddlMador",
    ];

    const searchButtonCandidates = ["ctl00$ContentPlaceHolder1$btnSearch", "ctl00$MainContent$btnSearch", "btnSearch"];

    for (const key of dateFromCandidates) postFields[key] = lastWeek;
    for (const key of dateToCandidates) postFields[key] = today;
    for (const key of minPagesCandidates) postFields[key] = "2";
    for (const key of essentialOnlyCandidates) postFields[key] = "מהותיות בלבד";
    for (const key of sectionCandidates) postFields[key] = "פלילי";
    for (const key of searchButtonCandidates) postFields[key] = "חפש";

    const escapedFields = Object.entries(postFields)
      .map(([name, value]) => {
        const safeName = String(name)
          .replaceAll("&", "&amp;")
          .replaceAll("\"", "&quot;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;");
        const safeValue = String(value)
          .replaceAll("&", "&amp;")
          .replaceAll("\"", "&quot;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;");
        return `<input type="hidden" name="${safeName}" value="${safeValue}" />`;
      })
      .join("\n");

    res.status(200).send(`<!doctype html>
<html lang="he" dir="rtl">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>סוכן חיפוש אוטומטי</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 0; padding: 2rem; background: #f8fafc; color: #0f172a; }
      main { max-width: 560px; margin: 0 auto; background: #fff; border-radius: 12px; padding: 1.5rem; box-shadow: 0 10px 24px rgba(15, 23, 42, 0.08); }
      h1 { margin-top: 0; font-size: 1.3rem; }
      p { line-height: 1.6; }
    </style>
  </head>
  <body>
    <main>
      <h1>הסוכן עובד בשבילך…</h1>
      <p>פותח את מסך החיפוש, ממלא את כל השדות שנבחרו ולוחץ על חיפוש אוטומטית.</p>
      <p>אם לא עבר אוטומטית תוך רגע, אפשר ללחוץ על הכפתור:</p>
      <form id="agent-form" method="POST" action="${SUPREME_COURT_SEARCH_URL}">
        ${escapedFields}
        <button type="submit">המשך לתוצאות</button>
      </form>
    </main>
    <script>
      window.setTimeout(() => {
        const form = document.getElementById("agent-form");
        if (form) form.submit();
      }, 150);
    </script>
  </body>
</html>`);
  } catch (error) {
    console.error("autoSupremeSearchAgent failed", error);
    res.status(500).send("Failed to run automated Supreme Court search agent.");
  }
});
